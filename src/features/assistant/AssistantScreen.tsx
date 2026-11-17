/**
 * ASISTENTE DE VOZ
 * Conversación para registrar comidas, síntomas y deposiciones hablando.
 * El asistente organiza la ficha y pregunta sólo lo necesario para completarla.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Keyboard, Mic, Pencil, Send, ShieldCheck, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDb } from '@/db/db';
import { foodHistory, getDailyLog, getSettings, loadAll, patchDailyLog, saveMeal, saveStool, saveSymptom } from '@/db/repo';
import { dayKey, formatDuration, formatTime } from '@/domain/dates';
import { endFast, maybeEndFastWithMeal, openFast, startFast } from '@/db/fasting';
import { addCustomReminder } from '@/db/customReminders';
import { answerQuery, dayPhrase, type QueryIntent } from '@/voice/query';
import { notificationPermission } from '@/lib/reminders';
import { targetHoursFor } from '@/domain/fasting';
import { stoolAlerts, symptomAlerts, type MedicalAlert } from '@/domain/alerts';
import type { Meal } from '@/domain/types';
import { addRefMeal, editDraft, emptySession, handleChip, handleUtterance, isEmpty, summaryLines, toRecords, type Chip, type Question, type Session } from '@/voice/dialog';
import { DraftEditor } from './DraftEditor';
import { AiError, aiReady, aiToTurn, interpretWithAi, readAiPrefs, type AiTurn } from '@/voice/ai';
import { findSavedMealCandidates, moveSavedFoods } from '@/voice/moveSaved';
import { mealTypeLabel } from '@/domain/labels';
import {
  createRecognizer,
  installOnDevice,
  onDeviceStatus,
  readVoicePrefs,
  recognitionSupported,
  speak,
  stopSpeaking,
  ttsSupported,
  writeVoicePrefs,
  type OnDeviceStatus,
  type Recognizer,
  type VoicePrefs,
} from '@/voice/speech';
import { useEntry } from '@/features/entries/EntryProvider';
import { Button, IconButton, cx, errorMessage, inputClass, useToast } from '@/components/ui';
import { navigate } from '@/lib/router';
import { useSettings } from '@/lib/hooks';
import { formatMl, glassesToMl } from '@/domain/hydration';

interface Msg {
  id: number;
  role: 'user' | 'bot';
  text: string;
  /** Opciones rápidas (sólo las del último mensaje están activas). */
  question?: Question;
  /** Comidas guardadas en este turno, para editarlas. */
  saved?: Meal[];
}

const EXAMPLES = [
  'Almorcé arroz, fríjoles bastantes y carne asada',
  'Hace una hora me dio agrieras fuerte',
  'Recuérdame si ayer comí salchipapa',
  'Recuérdame en 2 horas tomar la creatina',
];

/** "la cena de las 6:16 p. m. (leche, suero)" */
function describeMeal(meal: Meal): string {
  const art = meal.mealType === 'bebida' ? 'la bebida' : `${meal.mealType === 'cena' || meal.mealType === 'merienda' ? 'la' : 'el'} ${mealTypeLabel(meal.mealType).toLowerCase()}`;
  return `${art} de las ${formatTime(meal.at)} (${meal.items.map((i) => i.name.toLowerCase()).join(', ')})`;
}

const INTRO =
  'Hola. Cuéntame qué comiste, cómo te sientes o si fuiste al baño, y yo organizo la ficha. También puedes preguntarme por tu diario («¿qué cené ayer?», «¿cuándo comí leche?») o pedirme que te recuerde algo.';

export function AssistantScreen() {
  const toast = useToast();
  const entry = useEntry();
  const [session, setSession] = useState<Session>(emptySession);
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: 'bot', text: INTRO }]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [prefs, setPrefs] = useState<VoicePrefs>(readVoicePrefs);
  const [device, setDevice] = useState<OnDeviceStatus>('unsupported');
  const deviceChecked = useRef(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [aiOn, setAiOn] = useState(() => aiReady());
  const aiWarned = useRef(false);
  const recRef = useRef<Recognizer>(undefined);
  const lastWasVoice = useRef(false);
  const seq = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const history = useLiveQuery(() => foodHistory(), [], []);
  const custom = useLiveQuery(() => getDb().customFoods.toArray(), [], []);
  const extraFoods = [...history.map((h) => ({ name: h.name, key: h.key })), ...custom.map((c) => ({ name: c.name, key: c.key }))];
  const settings = useSettings();
  const bottleRef = useRef(settings.bottleMl);
  bottleRef.current = settings.bottleMl;
  const extraRef = useRef(extraFoods);
  extraRef.current = extraFoods;

  const supported = recognitionSupported();

  useEffect(() => {
    return () => {
      recRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, partial, thinking]);

  const updatePrefs = (p: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    writeVoicePrefs(next);
    if (p.tts === false) stopSpeaking();
  };

  const push = (m: Omit<Msg, 'id'>) => setMsgs((x) => [...x, { ...m, id: seq.current++ }]);

  // ───────── Escuchar ─────────

  const startListening = useCallback(async () => {
    // La disponibilidad en el dispositivo se consulta sólo al usar el micrófono
    let dev = device;
    if (!deviceChecked.current) {
      deviceChecked.current = true;
      dev = await onDeviceStatus();
      setDevice(dev);
    }
    const onDevice = dev === 'available';
    if (!onDevice && !readVoicePrefs().cloudConsent) {
      setConsentOpen(true);
      return;
    }
    stopSpeaking();
    recRef.current?.abort();
    const pause = readVoicePrefs().pauseSeconds;
    const rec = createRecognizer({
      onDevice,
      silenceMs: pause > 0 ? pause * 1000 : null,
      onStart: () => setListening(true),
      onPartial: setPartial,
      onFinal: (t) => {
        lastWasVoice.current = true;
        void submitRef.current(t);
      },
      onError: (m, code) => {
        if (code !== 'no-speech') toast(m, { tone: 'error' });
        if (code === 'not-allowed' || code === 'network' || code === 'service-not-allowed') lastWasVoice.current = false;
      },
      onEnd: () => {
        setListening(false);
        setPartial('');
      },
    });
    if (!rec) return;
    recRef.current = rec;
    rec.start();
  }, [device, toast]);

  const stopListening = () => recRef.current?.stop();
  const cancelListening = () => {
    recRef.current?.abort();
    lastWasVoice.current = false;
  };

  /** Responde en pantalla (y en voz alta) y, si corresponde, vuelve a escuchar. */
  const respond = useCallback(
    (raw: string, question?: Question, extra?: Partial<Msg>) => {
      // "p. m." ya termina en punto: evitar "p. m.."
      const text = raw.replace(/\.\.(?=\s|$)/g, '.');
      push({ role: 'bot', text, question, ...extra });
      const p = readVoicePrefs();
      const relisten = () => {
        if (p.autoListen && lastWasVoice.current && question && supported) setTimeout(() => void startListening(), 250);
      };
      if (p.tts && ttsSupported()) speak(text, relisten);
      else relisten();
    },
    [startListening, supported],
  );

  // ───────── Guardar ─────────

  const save = useCallback(
    async (s: Session) => {
      setSaving(true);
      const now = Date.now();
      try {
        const rec = toRecords(s, now);
        const alerts: MedicalAlert[] = [];
        const savedMeals: Meal[] = [];
        for (const m of rec.meals) savedMeals.push(await saveMeal(m));
        let endedFast: number | undefined;
        for (const m of [...savedMeals].sort((a, b) => a.at - b.at)) {
          const f = await maybeEndFastWithMeal(m);
          if (f) endedFast = (f.endAt! - f.startAt) / 3600_000;
        }
        for (const x of rec.symptoms) alerts.push(...symptomAlerts(await saveSymptom(x)));
        for (const x of rec.stools) alerts.push(...stoolAlerts(await saveStool(x)));
        const day = dayKey(now);
        if (rec.water) {
          const log = await getDailyLog(day);
          await patchDailyLog(day, { water: Math.min(40, Math.round(((log?.water ?? 0) + rec.water) * 100) / 100) });
        }
        if (rec.hydration) await patchDailyLog(day, { hydration: rec.hydration });
        if (rec.digestion) await patchDailyLog(day, { digestion: rec.digestion });
        const parts = [
          rec.meals.length && `${rec.meals.length} ${rec.meals.length === 1 ? 'comida' : 'comidas'}`,
          rec.symptoms.length && `${rec.symptoms.length} ${rec.symptoms.length === 1 ? 'síntoma' : 'síntomas'}`,
          rec.stools.length && `${rec.stools.length} ${rec.stools.length === 1 ? 'deposición' : 'deposiciones'}`,
          rec.water && `≈ ${formatMl(glassesToMl(rec.water))} de agua`,
          rec.hydration && 'tu estimado de agua',
          rec.digestion && 'tu valoración del día',
        ].filter(Boolean);
        setSession(emptySession());
        lastWasVoice.current = false;
        const fastNote = endedFast !== undefined ? ` Con esa comida terminaste tu ayuno de ${formatDuration(Math.round(endedFast * 60))}.` : '';
        respond(`Listo, guardé ${parts.join(', ')}.${fastNote} ¿Algo más?`, undefined, { saved: savedMeals });
        toast('Guardado en tu diario');
        if (alerts.length) entry.showAlerts(alerts);
      } catch (e) {
        respond(`No pude guardar: ${errorMessage(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [entry, respond, toast],
  );

  // ───────── Turnos ─────────

  /** Pide a la IA que interprete la frase; si no se puede, devuelve undefined (se usan las reglas locales). */
  const askAi = useCallback(
    async (t: string): Promise<AiTurn | undefined> => {
      const prefs = readAiPrefs();
      setAiOn(aiReady(prefs));
      if (!aiReady(prefs)) return undefined;
      const s = sessionRef.current;
      // Respuestas cortas a una pregunta ("sí", "a las 8", "7") y la hora de un recordatorio: bastan las reglas locales
      if (s.pending && (s.pending.kind === 'reminder_time' || t.split(/\s+/).length <= 3)) return undefined;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
      setThinking(true);
      try {
        const now = Date.now();
        const out = await interpretWithAi(t, { now, draft: isEmpty(s) ? [] : summaryLines(s, now), pending: s.pending?.text, bottleMl: bottleRef.current }, prefs);
        const draftNames = s.meals.flatMap((m) => m.items.map((i) => ({ name: i.name, key: i.key })));
        return aiToTurn(out, now, extraRef.current, draftNames);
      } catch (e) {
        if (!aiWarned.current || (e instanceof AiError && e.code !== 'red')) {
          aiWarned.current = true;
          toast(`${e instanceof AiError ? e.message : 'No pude usar la IA.'} Uso el modo sin conexión.`, { tone: 'info' });
        }
        return undefined;
      } finally {
        setThinking(false);
      }
    },
    [toast],
  );

  const submit = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      push({ role: 'user', text: t });
      const ai = await askAi(t);
      const r = handleUtterance(sessionRef.current, t, { now: Date.now(), extraFoods: extraRef.current, bottleMl: bottleRef.current, ai });
      setSession(r.session);
      if (r.fast) {
        void runFast(r.fast).then((msg) => respond(`${msg}${r.text ? ` ${r.text}` : ''}`, r.question));
        return;
      }
      if (r.query) {
        const pendingText = r.question ? ` Volviendo a lo anterior: ${r.question.text}` : '';
        void answerFromDiary(r.query).then((msg) => respond(`${msg}${pendingText}`, r.question));
        return;
      }
      if (r.reminder) {
        void createReminder(r.reminder).then((msg) => respond(`${msg}${r.question ? ` ${r.question.text}` : ''}`, r.question));
        return;
      }
      if (r.editRequest) {
        const er = r.editRequest;
        if (er.inDraft) {
          respond('Te abro la ficha en borrador para que la corrijas.', r.question);
          setEditorOpen(true);
          return;
        }
        void findSavedMealCandidates(er)
          .then(({ meal, recent }) => {
            const what = er.mealType ? `${er.mealType === 'cena' || er.mealType === 'merienda' || er.mealType === 'bebida' ? 'la' : 'el'} ${mealTypeLabel(er.mealType).toLowerCase()}` : 'esa comida';
            if (meal) {
              respond(`Te abrí ${describeMeal(meal)}. Corrige lo que necesites y toca «Guardar cambios».`, r.question);
              entry.openMeal({ meal });
              return;
            }
            if (!recent.length) {
              respond(`No encontré ${what} ni otras comidas guardadas en los últimos días. Puedes buscarla en Diario → Comidas.`, r.question);
              return;
            }
            // Ofrecer las últimas comidas guardadas para que elija cuál corregir
            const choose: Question = {
              id: `choose-${Date.now()}`,
              kind: 'choose_meal',
              target: '',
              text: '',
              chips: recent.map((m) => ({ label: `${mealTypeLabel(m.mealType)} ${formatTime(m.at)}: ${m.items.slice(0, 3).map((i) => i.name.toLowerCase()).join(', ')}${m.items.length > 3 ? '…' : ''}`, answer: { kind: 'openMeal', id: m.id } })),
            };
            respond(`No encontré exactamente ${er.keys.length ? 'ese alimento' : what}. ¿Cuál de tus últimas comidas guardadas quieres corregir?`, choose);
          })
          .catch((e) => respond(`No pude abrir esa comida: ${errorMessage(e)}`, r.question));
        return;
      }
      if (r.moveSaved) {
        const ref = r.moveSaved;
        void moveSavedFoods(ref)
          .then((res) => {
            if (res) {
              respond(`Listo, en tu diario pasé ${res.names.map((n) => n.toLowerCase()).join(' y ')} a las ${formatTime(ref.at)}${res.split ? ' como un registro aparte' : ''}.${r.question ? ` ${r.question.text}` : ''}`, r.question);
            } else {
              const rr = addRefMeal(sessionRef.current, ref, Date.now());
              setSession(rr.session);
              respond(rr.text, rr.question);
            }
          })
          .catch((e) => respond(`No pude cambiar la hora: ${errorMessage(e)}`, r.question));
        return;
      }
      if (r.save) {
        void save(r.session);
        return;
      }
      respond(r.text, r.question);
    },
    [askAi, respond, save],
  );
  /** Responde una pregunta con los datos del diario (todo en el teléfono). */
  async function answerFromDiary(q: QueryIntent): Promise<string> {
    try {
      const [all, fasts] = await Promise.all([loadAll(), getDb().fasts.toArray()]);
      const draftNote = !isEmpty(sessionRef.current) ? ' Ojo: lo que me contaste hace un momento sigue en el borrador y aún no está guardado.' : '';
      return answerQuery(q, { ...all, fasts }, Date.now()) + draftNote;
    } catch (e) {
      return `No pude consultar tu diario: ${errorMessage(e)}`;
    }
  }

  /** Programa un recordatorio pedido por voz o texto. */
  async function createReminder(r: { at: number; text: string; daily: boolean }): Promise<string> {
    try {
      await addCustomReminder(r);
      const when = r.daily ? `todos los días a las ${formatTime(r.at)}` : `${dayPhrase(r.at, Date.now())} a las ${formatTime(r.at)}`;
      const how =
        notificationPermission() === 'granted'
          ? 'Te llegará una notificación si la app está abierta o en segundo plano.'
          : 'Para recibirlo como notificación, permite las notificaciones en Ajustes → Recordatorios; si no, te lo muestro al abrir la app.';
      return `Listo, te recuerdo «${r.text.toLowerCase()}» ${when}. ${how}`;
    } catch (e) {
      return `No pude crear el recordatorio: ${errorMessage(e)}`;
    }
  }

  /** Empieza o termina un ayuno desde la conversación. */
  async function runFast(f: { kind: 'start' | 'end'; at: number }): Promise<string> {
    try {
      const open = await openFast();
      if (f.kind === 'start') {
        if (open) return 'Ya tienes un ayuno en curso. Puedes verlo en la sección de ayuno.';
        const st = await getSettings();
        if (!st.fastingAck) return 'Antes de tu primer ayuno, revisa las precauciones en la sección de ayuno intermitente (desde Hoy).';
        const target = targetHoursFor(st.fastingProtocol, st.fastingCustomHours);
        const fast = await startFast({ startAt: f.at, targetHours: target, protocol: st.fastingProtocol });
        return `Listo, empezó tu ayuno de ${target} horas a las ${formatTime(fast.startAt)}. Podrás comer desde las ${formatTime(fast.startAt + target * 3600_000)}`;
      }
      if (!open) return 'No tienes un ayuno en curso.';
      const ended = await endFast(open.id, f.at);
      return `Terminaste tu ayuno de ${formatDuration(Math.round(((ended.endAt! - ended.startAt) / 3600_000) * 60))}.`;
    } catch (e) {
      return `No pude registrar el ayuno: ${errorMessage(e)}`;
    }
  }

  const submitRef = useRef(submit);
  submitRef.current = submit;

  const onChip = (c: Chip, from?: Question) => {
    if (c.answer.kind === 'openMeal') {
      const id = c.answer.id;
      push({ role: 'user', text: c.label });
      void getDb()
        .meals.get(id)
        .then((meal) => {
          if (!meal) return respond('Esa comida ya no existe.');
          respond(`Te abrí ${describeMeal(meal)}. Corrige lo que necesites y toca «Guardar cambios».`, sessionRef.current.pending);
          entry.openMeal({ meal });
        });
      return;
    }
    // Opción de una pregunta que ya no aplica (p. ej. se corrigió a mano el borrador)
    if (from && from.id !== sessionRef.current.pending?.id && c.answer.kind !== 'save' && c.answer.kind !== 'cancel') {
      toast('Esa pregunta ya no aplica.', { tone: 'info' });
      return;
    }
    lastWasVoice.current = false;
    stopSpeaking();
    push({ role: 'user', text: c.label });
    const r = handleChip(sessionRef.current, c, Date.now());
    setSession(r.session);
    if (r.reminder) {
      void createReminder(r.reminder).then((msg) => respond(`${msg}${r.question ? ` ${r.question.text}` : ''}`, r.question));
      return;
    }
    if (r.save) {
      void save(r.session);
      return;
    }
    respond(r.text, r.question);
  };

  const sendTyped = () => {
    if (thinking) return;
    lastWasVoice.current = false;
    void submit(input);
    setInput('');
  };

  const lastBot = [...msgs].reverse().find((m) => m.role === 'bot');

  /** Al cerrar el editor: si cambió la pregunta pendiente, el asistente sigue con la nueva. */
  const closeEditor = () => {
    setEditorOpen(false);
    const pending = sessionRef.current.pending;
    if (pending?.id !== lastBot?.question?.id) {
      if (pending) push({ role: 'bot', text: pending.kind === 'confirm' ? `Corregido. ${summaryLines(sessionRef.current, Date.now()).join('. ')}. ${pending.text}` : `Corregido. ${pending.text}`, question: pending });
      else if (!isEmpty(sessionRef.current)) push({ role: 'bot', text: 'Corregido.' });
    }
  };
  const draft = !isEmpty(session) ? summaryLines(session, Date.now()) : [];

  return (
    <div className="flex h-[calc(100dvh-8.75rem-env(safe-area-inset-bottom))] flex-col pt-1">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">Asistente de voz</h1>
          <p className="flex items-center gap-1 text-xs text-muted">
            {aiOn ? (
              <>
                <Sparkles size={13} className="text-primary" />
                Con IA (Claude): sólo se envía lo que dices
              </>
            ) : (
              <>
                <ShieldCheck size={13} className="text-good" />
                {device === 'available' ? 'Voz reconocida en tu teléfono' : 'La ficha se organiza en tu teléfono'}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0">
          {ttsSupported() && (
            <IconButton label={prefs.tts ? 'Silenciar respuestas habladas' : 'Leer respuestas en voz alta'} onClick={() => updatePrefs({ tts: !prefs.tts })}>
              {prefs.tts ? <Volume2 size={21} /> : <VolumeX size={21} />}
            </IconButton>
          )}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-1 pb-3" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[88%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed', m.role === 'user' ? 'rounded-br-lg bg-primary text-on-primary' : 'rounded-bl-lg border border-border bg-surface')}>
              {m.role === 'bot' && m.id === 0 && <Sparkles size={16} className="mb-1 text-primary" aria-hidden />}
              <p className="whitespace-pre-line">{m.text}</p>
              {m.question && m === lastBot && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.question.chips.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => onChip(c, m.question)}
                      disabled={saving}
                      className={cx(
                        'min-h-10 rounded-full border px-3.5 text-sm font-semibold transition active:scale-95',
                        c.answer.kind === 'save' ? 'border-transparent bg-primary text-on-primary' : c.answer.kind === 'cancel' ? 'border-border text-bad' : 'border-border bg-surface-2',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {m.saved && m.saved.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.saved.map((meal) => (
                    <button key={meal.id} type="button" onClick={() => entry.openMeal({ meal })} className="min-h-9 rounded-full bg-surface-2 px-3 text-sm font-semibold">
                      Revisar {meal.items[0]?.name.toLowerCase()}
                      {meal.items.length > 1 ? '…' : ''}
                    </button>
                  ))}
                  <button type="button" onClick={() => navigate('/hoy')} className="min-h-9 rounded-full bg-surface-2 px-3 text-sm font-semibold">
                    Ver Hoy
                  </button>
                </div>
              )}
              {m.id === 0 && msgs.length === 1 && (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs font-semibold text-muted">Prueba con algo como:</p>
                  {EXAMPLES.map((e) => (
                    <button key={e} type="button" disabled={thinking} onClick={() => void submit(e)} className="rounded-2xl bg-surface-2 px-3 py-2 text-left text-sm">
                      «{e}»
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-3xl rounded-bl-lg border border-border bg-surface px-4 py-3 text-[15px] text-muted" role="status">
              <Sparkles size={16} className="animate-pulse text-primary" aria-hidden /> Pensando…
            </div>
          </div>
        )}
        {(listening || partial) && (
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-3xl rounded-br-lg border-2 border-dashed border-primary px-4 py-3 text-[15px]">
              <p className={partial ? 'text-text' : 'text-muted'}>{partial || 'Te escucho… habla con calma, puedes hacer pausas.'}</p>
              {listening && (
                <>
                  <p className="mt-2 text-xs text-muted">
                    {prefs.pauseSeconds > 0 ? `Toca «Listo» cuando termines, o se envía solo tras ${prefs.pauseSeconds} s de silencio.` : 'Toca «Listo» cuando termines.'}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={stopListening} className="min-h-10 flex-1 rounded-full bg-primary px-4 text-sm font-bold text-on-primary">
                      Listo, enviar
                    </button>
                    <button type="button" onClick={cancelListening} className="min-h-10 rounded-full border border-border px-4 text-sm font-semibold">
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {draft.length > 0 && (
        <div className="mb-2 rounded-3xl border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Ficha en borrador</p>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold text-muted"
              onClick={() => {
                setSession(emptySession());
                push({ role: 'bot', text: 'Descarté el borrador.' });
              }}
            >
              <X size={14} /> Descartar
            </button>
          </div>
          <button type="button" onClick={() => setEditorOpen(true)} className="mt-1 w-full text-left" aria-label="Corregir la ficha en borrador">
            <ul className="space-y-0.5 text-sm">
              {draft.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
          </button>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => setEditorOpen(true)}>
              <Pencil size={15} /> Corregir
            </Button>
            <Button size="sm" block disabled={saving} onClick={() => onChip({ label: 'Guardar', answer: { kind: 'save' } })}>
              {saving ? 'Guardando…' : 'Guardar ahora'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 pb-1">
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            sendTyped();
          }}
        >
          <input
            ref={inputRef}
            className={cx(inputClass, 'min-h-14 pr-12')}
            placeholder={supported ? 'Escribe o toca el micrófono…' : 'Escribe o usa el micrófono del teclado…'}
            aria-label="Mensaje para el asistente"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            enterKeyHint="send"
            autoComplete="off"
          />
          <button type="submit" aria-label="Enviar" disabled={!input.trim() || thinking} className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-primary disabled:opacity-30">
            <Send size={20} />
          </button>
        </form>
        {supported ? (
          <button
            type="button"
            onClick={() => (listening ? stopListening() : void startListening())}
            aria-label={listening ? 'Listo, enviar lo dictado' : 'Hablar'}
            aria-pressed={listening}
            className={cx('relative flex size-16 shrink-0 items-center justify-center rounded-full shadow-card transition active:scale-95', listening ? 'bg-good text-white' : 'bg-primary text-on-primary')}
          >
            {listening && <span className="absolute inset-0 animate-ping rounded-full bg-good/40" aria-hidden />}
            {listening ? <Check size={30} /> : <Mic size={28} />}
          </button>
        ) : (
          <button type="button" onClick={() => inputRef.current?.focus()} aria-label="Usar el teclado" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Keyboard size={26} />
          </button>
        )}
      </div>
      {supported && (
        <label className="flex items-center justify-center gap-2 pb-1 text-xs text-muted">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={prefs.autoListen} onChange={(e) => updatePrefs({ autoListen: e.target.checked })} />
          Conversación continua: escuchar de nuevo después de cada pregunta
        </label>
      )}

      <DraftEditor
        open={editorOpen}
        session={session}
        saving={saving}
        onEdit={(e) => setSession((prev) => editDraft(prev, e, Date.now()))}
        onClose={closeEditor}
        onSave={() => {
          setEditorOpen(false);
          onChip({ label: 'Guardar', answer: { kind: 'save' } });
        }}
      />

      <ConsentDialog
        open={consentOpen}
        device={device}
        onClose={() => setConsentOpen(false)}
        onAccept={() => {
          updatePrefs({ cloudConsent: true });
          setConsentOpen(false);
          setTimeout(() => void startListening(), 100);
        }}
        onKeyboard={() => {
          setConsentOpen(false);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        onInstall={async () => {
          const ok = await installOnDevice();
          const st = await onDeviceStatus();
          setDevice(st);
          toast(ok || st === 'available' || st === 'downloading' ? 'Descargando el español para reconocimiento sin conexión…' : 'Este teléfono no permite reconocimiento sin conexión desde el navegador', { tone: ok ? 'ok' : 'info' });
          setConsentOpen(false);
        }}
      />
    </div>
  );
}

function ConsentDialog({ open, device, onClose, onAccept, onKeyboard, onInstall }: { open: boolean; device: OnDeviceStatus; onClose: () => void; onAccept: () => void; onKeyboard: () => void; onInstall: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-[60] bg-black/45" />
        <Dialog.Content className="animate-pop fixed left-1/2 top-1/2 z-[61] max-h-[88dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-2xl">
          <Dialog.Title className="text-lg font-extrabold">Antes de usar el micrófono</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
              <p>
                DIGESTA <strong className="text-text">entiende y organiza tu ficha dentro del teléfono</strong>, sin enviar nada.
              </p>
              <p>
                Pero convertir tu <strong className="text-text">voz en texto</strong> lo hace Chrome. En este teléfono, Chrome puede enviar el audio a los servidores de Google para transcribirlo (como al dictar en el buscador). DIGESTA no recibe ni guarda el audio.
              </p>
              <p>Alternativas 100 % locales:</p>
              <ul className="list-disc pl-5">
                <li>Usar el micrófono del teclado (Gboard) con el dictado sin conexión activado.</li>
                {(device === 'downloadable' || device === 'downloading') && <li>Descargar el español para que Chrome reconozca la voz en el teléfono.</li>}
              </ul>
            </div>
          </Dialog.Description>
          <div className="mt-5 flex flex-col gap-2">
            {(device === 'downloadable' || device === 'downloading') && (
              <Button variant="soft" block onClick={onInstall}>
                Descargar español sin conexión
              </Button>
            )}
            <Button block onClick={onAccept}>
              <Mic size={18} /> Usar el dictado de Chrome
            </Button>
            <Button variant="secondary" block onClick={onKeyboard}>
              <Keyboard size={18} /> Usar el teclado
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
