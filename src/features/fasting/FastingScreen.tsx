/**
 * AYUNO INTERMITENTE
 * Planear un día de ayuno, seguirlo con un temporizador, terminarlo y ver
 * cómo responde tu digestión. Incluye precauciones y lo que dice la evidencia.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, BookOpen, ChevronDown, Clock, Dumbbell, Droplets, Play, Square, Trash2, Utensils } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { getDb } from '@/db/db';
import { deleteFast, endFast, openFast, startFast, updateFast } from '@/db/fasting';
import { loadAll, updateSettings } from '@/db/repo';
import { formatDateTime, formatDuration, formatTime, fromDateTimeInputs, HOUR, relativeDayLabel, dayKey, toDateInput, toTimeInput } from '@/domain/dates';
import {
  ALLOWED_DURING_FAST,
  BREAK_FAST_TIPS,
  DIGESTIVE_NOTE,
  NOT_WITHOUT_PROFESSIONAL,
  PHASE_NOTE,
  PHASES,
  PROTOCOLS,
  SIDE_EFFECTS,
  STOP_SIGNS,
  TRAINING_TIPS,
  elapsedHours,
  fastState,
  phaseAt,
  planFrom,
  protocolInfo,
  targetHoursFor,
} from '@/domain/fasting';
import type { Fast, FastProtocol } from '@/domain/types';
import { analyzeFasting } from '@/analysis/fasting';
import { useEntry } from '@/features/entries/EntryProvider';
import { TimeField } from '@/components/TimeField';
import { Badge, Button, Card, Chip, EmptyState, Field, IconButton, IntensitySlider, SectionTitle, Segmented, Sheet, Stepper, TextArea, cx, errorMessage, inputClass, useConfirm, useToast } from '@/components/ui';
import { useNow, useSettings } from '@/lib/hooks';

const hm = (hours: number) => formatDuration(Math.round(hours * 60));

export function FastingScreen() {
  const settings = useSettings();
  const now = useNow(30_000);
  const current = useLiveQuery(() => openFast(), []);
  const [ending, setEnding] = useState<Fast | null>(null);

  return (
    <div className="pt-2">
      <h1 className="text-[28px] font-extrabold tracking-tight">Ayuno intermitente</h1>
      <p className="text-sm text-muted">Planea un día de ayuno, síguelo y mira cómo responde tu digestión.</p>

      {!settings.fastingAck ? (
        <Precautions onAccept={() => updateSettings({ fastingAck: true })} />
      ) : (
        <>
          {current ? <ActiveFast fast={current} now={now} onEnd={() => setEnding(current)} /> : <Planner protocol={settings.fastingProtocol} customHours={settings.fastingCustomHours} />}
          <Guide />
          <DigestionCard />
          <History now={now} />
        </>
      )}
      <EndFastSheet fast={ending} onClose={() => setEnding(null)} />
    </div>
  );
}

// ───────── Precauciones (primera vez) ─────────

function Precautions({ onAccept }: { onAccept: () => void }) {
  const [applies, setApplies] = useState(false);
  return (
    <Card className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-mid">
        <AlertTriangle size={22} />
        <p className="font-extrabold text-text">Antes de empezar</p>
      </div>
      <p className="text-sm leading-relaxed text-muted">El ayuno intermitente puede ser seguro para muchos adultos sanos, pero no es para todos. No lo hagas sin orientación de un profesional de la salud si tienes:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {NOT_WITHOUT_PROFESSIONAL.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="mt-3 rounded-2xl bg-bad-soft p-3 text-sm text-bad">{STOP_SIGNS}</p>
      <p className="mt-3 text-sm text-muted">DIGESTA sólo acompaña ayunos de 8 a 24 horas y no recomienda dejar de comer grupos de alimentos.</p>
      {applies ? (
        <p className="mt-4 rounded-2xl bg-mid-soft p-3 text-sm font-semibold text-mid">
          Gracias por contarlo. Habla primero con tu médico o nutricionista; si te autoriza, puedes volver y continuar.
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <Button block onClick={onAccept}>
          Ninguna aplica, continuar
        </Button>
        <Button variant="secondary" block onClick={() => setApplies(true)}>
          Alguna aplica para mí
        </Button>
      </div>
    </Card>
  );
}

// ───────── Planificador ─────────

function Planner({ protocol, customHours }: { protocol: FastProtocol; customHours: number }) {
  const toast = useToast();
  const [p, setP] = useState<FastProtocol>(protocol);
  const [hours, setHours] = useState(customHours);
  const [startAt, setStartAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const target = targetHoursFor(p, hours);
  const plan = planFrom(startAt, target);
  const future = startAt > Date.now() + 5 * 60_000;
  const info = protocolInfo(p);

  const begin = async () => {
    setBusy(true);
    try {
      await updateSettings({ fastingProtocol: p, fastingCustomHours: hours });
      await startFast({ startAt, targetHours: target, protocol: p });
      toast(future ? `Ayuno programado para las ${formatTime(startAt)}` : 'Ayuno iniciado. ¡Ánimo!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const evening = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    if (d.getTime() < Date.now() - 5 * 60_000) d.setDate(d.getDate() + 1);
    setStartAt(d.getTime());
  };

  return (
    <>
      <SectionTitle>Planea tu ayuno</SectionTitle>
      <Card>
        <p className="mb-2 text-sm font-semibold">Elige un esquema</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Esquema de ayuno">
          {PROTOCOLS.map((x) => (
            <button
              key={x.value}
              type="button"
              role="radio"
              aria-checked={p === x.value}
              onClick={() => setP(x.value)}
              className={cx('rounded-2xl border p-3 text-left transition', p === x.value ? 'border-primary bg-primary-soft ring-2 ring-primary/30' : 'border-border bg-surface')}
            >
              <span className="block text-lg font-extrabold">{x.label}</span>
              <span className="text-xs font-semibold text-muted">{x.level}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">{info.description}</p>
        {p === 'personalizado' && (
          <div className="mt-3">
            <Stepper label="Horas de ayuno" value={hours} onChange={setHours} min={8} max={24} unit="h" />
          </div>
        )}

        <div className="mt-5">
          <TimeField label="Última comida (inicio del ayuno)" value={startAt} onChange={setStartAt} />
          <div className="-mt-2 mb-2 flex flex-wrap gap-2">
            <Chip size="sm" onClick={() => evening(19)}>
              Esta noche 7:00 p. m.
            </Chip>
            <Chip size="sm" onClick={() => evening(20)}>
              Esta noche 8:00 p. m.
            </Chip>
            <Chip size="sm" onClick={() => evening(21)}>
              Esta noche 9:00 p. m.
            </Chip>
          </div>
        </div>

        <ol className="mt-3 space-y-3 rounded-2xl bg-surface-2 p-4" aria-label="Plan del día">
          <TimelineRow icon={<Utensils size={16} />} title="Último bocado" when={plan.startAt} />
          <TimelineRow icon={<Clock size={16} />} title={`Ayuno de ${target} horas`} detail="Agua, tinto o aromática sin azúcar" />
          <TimelineRow icon={<Utensils size={16} />} title="Primera comida" when={plan.endAt} highlight />
          <TimelineRow icon={<Clock size={16} />} title={`Ventana de comida (${24 - target} h)`} detail={`Hasta las ${formatTime(plan.windowEndAt)}`} />
        </ol>

        <Button size="lg" block className="mt-4" onClick={begin} disabled={busy}>
          <Play size={18} /> {future ? 'Programar ayuno' : 'Empezar ayuno'}
        </Button>
      </Card>
    </>
  );
}

function TimelineRow({ icon, title, when, detail, highlight }: { icon: ReactNode; title: string; when?: number; detail?: string; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', highlight ? 'bg-primary text-on-primary' : 'bg-surface text-primary')}>{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{when !== undefined ? `${relativeDayLabel(dayKey(when))} · ${formatTime(when)}` : detail}</span>
      </span>
    </li>
  );
}

// ───────── Ayuno en curso o programado ─────────

function ActiveFast({ fast, now, onEnd }: { fast: Fast; now: number; onEnd: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const state = fastState(fast, now);
  const elapsed = elapsedHours(fast, now);
  const progress = Math.min(1, elapsed / fast.targetHours);
  const goalAt = fast.startAt + fast.targetHours * HOUR;
  const phase = phaseAt(elapsed);
  const R = 88;
  const C = 2 * Math.PI * R;

  const cancel = async () => {
    if (await confirm({ title: 'Cancelar ayuno', message: 'Se eliminará este ayuno de tu historial.', confirmLabel: 'Cancelar ayuno', danger: true })) {
      await deleteFast(fast.id);
      toast('Ayuno cancelado');
    }
  };

  if (state === 'programado') {
    return (
      <>
        <SectionTitle>Ayuno programado</SectionTitle>
        <Card>
          <p className="text-lg font-extrabold">
            Empieza {relativeDayLabel(dayKey(fast.startAt)).toLowerCase()} a las {formatTime(fast.startAt)}
          </p>
          <p className="text-sm text-muted">
            {protocolInfo(fast.protocol).label} · meta de {fast.targetHours} h · podrás comer a las {formatTime(goalAt)} ({relativeDayLabel(dayKey(goalAt)).toLowerCase()}).
          </p>
          <p className="mt-2 text-sm text-muted">Faltan {hm((fast.startAt - now) / HOUR)}. Haz tu última comida antes de esa hora.</p>
          <div className="mt-4 flex gap-2">
            <Button block onClick={() => updateFast(fast.id, { startAt: Date.now() })}>
              <Play size={18} /> Empezar ahora
            </Button>
            <Button variant="secondary" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <SectionTitle>Ayuno en curso</SectionTitle>
      <Card>
        <div className="flex flex-col items-center">
          <div className="relative size-52">
            <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
              <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="14" />
              <circle cx="100" cy="100" r={R} fill="none" stroke={progress >= 1 ? 'var(--good)' : 'var(--primary)'} strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center" role="timer" aria-label={`Llevas ${hm(elapsed)} de ${fast.targetHours} horas`}>
              <span className="text-xs font-semibold text-muted">Llevas</span>
              <span className="tabular text-3xl font-extrabold">{hm(elapsed)}</span>
              <span className="text-xs text-muted">de {fast.targetHours} h · {Math.round(progress * 100)} %</span>
            </div>
          </div>
          {progress >= 1 ? (
            <Badge tone="good" className="mt-2">
              ¡Meta cumplida!
            </Badge>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Podrás comer a las <strong className="text-text">{formatTime(goalAt)}</strong> ({relativeDayLabel(dayKey(goalAt)).toLowerCase()})
            </p>
          )}
        </div>

        <div className="mt-4 rounded-2xl bg-surface-2 p-3">
          <p className="text-sm font-bold">{phase.title}</p>
          <p className="text-sm text-muted">{phase.description}</p>
          <div className="mt-2 flex gap-1" aria-hidden>
            {PHASES.filter((ph) => ph.from < Math.max(fast.targetHours, 12)).map((ph) => (
              <span key={ph.title} className={cx('h-1.5 flex-1 rounded-full', elapsed >= ph.from ? 'bg-primary' : 'bg-surface-3')} />
            ))}
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">
          Inició {formatDateTime(fast.startAt)} ·{' '}
          <button type="button" className="font-semibold text-primary underline" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Cerrar' : 'Corregir hora de inicio'}
          </button>
        </p>
        {editing && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input aria-label="Fecha de inicio" type="date" className={inputClass} value={toDateInput(fast.startAt)} onChange={(e) => e.target.value && void updateFast(fast.id, { startAt: fromDateTimeInputs(e.target.value, toTimeInput(fast.startAt)) }).catch((er) => toast(errorMessage(er), { tone: 'error' }))} />
            <input aria-label="Hora de inicio" type="time" className={inputClass} value={toTimeInput(fast.startAt)} onChange={(e) => e.target.value && void updateFast(fast.id, { startAt: fromDateTimeInputs(toDateInput(fast.startAt), e.target.value) }).catch((er) => toast(errorMessage(er), { tone: 'error' }))} />
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button size="lg" block onClick={onEnd} variant={progress >= 1 ? 'primary' : 'secondary'}>
            <Square size={16} /> Terminar ayuno
          </Button>
          <IconButton label="Cancelar ayuno" onClick={cancel} className="border border-border text-bad">
            <Trash2 size={18} />
          </IconButton>
        </div>
        <p className="mt-3 text-xs text-muted">Al registrar una comida que rompe el ayuno, DIGESTA lo termina solo a la hora de esa comida.</p>
        <p className="mt-2 rounded-xl bg-bad-soft p-2.5 text-xs text-bad">{STOP_SIGNS}</p>
      </Card>
    </>
  );
}

// ───────── Terminar ayuno ─────────

function EndFastSheet({ fast, onClose }: { fast: Fast | null; onClose: () => void }) {
  const toast = useToast();
  const entry = useEntry();
  const [at, setAt] = useState(Date.now());
  const [hunger, setHunger] = useState(5);
  const [energy, setEnergy] = useState<1 | 2 | 3>(2);
  const [effects, setEffects] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [openId, setOpenId] = useState<string>();
  if (fast && fast.id !== openId) {
    setOpenId(fast.id);
    setAt(Date.now());
    setHunger(5);
    setEnergy(2);
    setEffects([]);
    setNotes('');
  }
  const save = async () => {
    if (!fast) return;
    try {
      const f = await endFast(fast.id, at, { hunger, energy, sideEffects: effects, notes: notes.trim() || undefined });
      const h = (f.endAt! - f.startAt) / HOUR;
      onClose();
      toast(`Ayuno de ${hm(h)} registrado`, { action: { label: 'Registrar comida', onClick: () => entry.openMeal() } });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    }
  };
  return (
    <Sheet
      open={!!fast}
      onOpenChange={(o) => !o && onClose()}
      title="Terminar ayuno"
      description={fast ? `Inició ${formatDateTime(fast.startAt)} · meta ${fast.targetHours} h` : ''}
      footer={
        <Button size="lg" block onClick={save}>
          Guardar
        </Button>
      }
    >
      <TimeField label="¿Cuándo terminaste?" value={at} onChange={setAt} />
      {fast && <p className="-mt-2 mb-4 text-sm font-semibold text-primary">Duración: {hm(Math.max(0, (at - fast.startAt) / HOUR))}</p>}
      <div className="mb-4">
        <IntensitySlider label="Hambre al terminar" value={hunger} onChange={setHunger} word={hunger <= 3 ? 'Poca' : hunger <= 6 ? 'Moderada' : 'Mucha'} />
      </div>
      <Field label="Energía">
        <Segmented
          label="Energía"
          value={energy}
          onChange={setEnergy}
          options={[
            { value: 1, label: 'Baja' },
            { value: 2, label: 'Normal' },
            { value: 3, label: 'Alta' },
          ]}
        />
      </Field>
      <Field label="¿Cómo te fue? (opcional)">
        <div className="flex flex-wrap gap-2">
          {SIDE_EFFECTS.map((s) => (
            <Chip key={s} size="sm" selected={effects.includes(s)} onClick={() => setEffects((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>
              {s}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="Notas" htmlFor="fast-notes">
        <TextArea id="fast-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Cómo te sentiste, si entrenaste, qué comiste al romperlo…" />
      </Field>
      <p className="text-xs text-muted">Si tuviste molestias digestivas, regístralas también como síntoma para que entren en el análisis.</p>
    </Sheet>
  );
}

// ───────── Guía ─────────

function Collapsible({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="text-primary">{icon}</span>
        <span className="flex-1 font-semibold">{title}</span>
        <ChevronDown size={18} className={cx('text-muted transition', open && 'rotate-180')} />
      </button>
      {open && <div className="animate-fade px-4 pb-4 text-sm leading-relaxed">{children}</div>}
    </div>
  );
}

function Guide() {
  return (
    <>
      <SectionTitle>Guía rápida</SectionTitle>
      <div className="space-y-2">
        <Collapsible icon={<Droplets size={20} />} title="Qué puedes tomar durante el ayuno">
          <ul className="list-disc space-y-1 pl-5">
            {ALLOWED_DURING_FAST.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="mt-2 text-muted">La leche, el azúcar, los jugos, las bebidas con edulcorantes y el alcohol rompen el ayuno.</p>
        </Collapsible>
        <Collapsible icon={<Utensils size={20} />} title="Cómo romper el ayuno sin molestias">
          <ul className="list-disc space-y-1 pl-5">
            {BREAK_FAST_TIPS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Collapsible>
        <Collapsible icon={<Dumbbell size={20} />} title="Si entrenas">
          <ul className="list-disc space-y-1 pl-5">
            {TRAINING_TIPS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Collapsible>
        <Collapsible icon={<AlertTriangle size={20} />} title="Cuándo no ayunar y cuándo parar">
          <ul className="list-disc space-y-1 pl-5">
            {NOT_WITHOUT_PROFESSIONAL.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="mt-2 font-semibold text-bad">{STOP_SIGNS}</p>
        </Collapsible>
        <Collapsible icon={<BookOpen size={20} />} title="Lo que dice la evidencia">
          <ul className="list-disc space-y-2 pl-5">
            <li>Para bajar de peso, el ayuno intermitente funciona en general igual que reducir calorías sin horario. No es mágico: lo que más pesa es cuánto comes en total (metaanálisis de 99 estudios, BMJ 2025).</li>
            <li>Entre 12 y 36 horas de ayuno el cuerpo pasa a usar más grasa y cetonas; el momento exacto varía entre personas (Anton y col., Obesity 2018).</li>
            <li>{PHASE_NOTE}</li>
            <li>En personas que entrenan, el 16:8 con entrenamiento de fuerza y proteína suficiente mantuvo la ganancia de músculo (JISSN 2025).</li>
            <li>Un resumen de congreso de 2024 que relacionó ventanas de 8 horas con más muerte cardiovascular fue muy criticado (datos de sólo 2 días, posible causalidad inversa) y no demuestra daño.</li>
            <li>{DIGESTIVE_NOTE}</li>
          </ul>
        </Collapsible>
      </div>
    </>
  );
}

// ───────── Digestión y ayuno ─────────

function DigestionCard() {
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const [all, fasts] = await Promise.all([loadAll(), getDb().fasts.toArray()]);
    return analyzeFasting({ ...all, fasts, threshold: settings.analysisThreshold });
  }, [settings.analysisThreshold]);
  if (!data) return null;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return (
    <>
      <SectionTitle>Tu digestión y el ayuno</SectionTitle>
      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="tabular text-2xl font-extrabold">{data.fasts}</p>
            <p className="text-xs text-muted">ayunos</p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">{data.completed}</p>
            <p className="text-xs text-muted">con meta cumplida</p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">{data.fasts ? hm(data.avgHours) : '—'}</p>
            <p className="text-xs text-muted">duración media</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed">{data.message}</p>
        {data.enough && (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-semibold" />
                <th className="py-1 font-semibold">Días con ayuno</th>
                <th className="py-1 font-semibold">Sin ayuno</th>
              </tr>
            </thead>
            <tbody className="tabular">
              <tr className="border-t border-border">
                <td className="py-1.5">Días</td>
                <td>{data.withFast.days}</td>
                <td>{data.withoutFast.days}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1.5">Con síntomas</td>
                <td>{pct(data.withFast.symptomDayRate)}</td>
                <td>{pct(data.withoutFast.symptomDayRate)}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1.5">Digestión media</td>
                <td>{data.withFast.avgDigestion?.toFixed(1) ?? '—'}</td>
                <td>{data.withoutFast.avgDigestion?.toFixed(1) ?? '—'}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1.5">Heces blandas</td>
                <td>{pct(data.withFast.softStoolDayRate)}</td>
                <td>{pct(data.withoutFast.softStoolDayRate)}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1.5">Heces duras</td>
                <td>{pct(data.withFast.hardStoolDayRate)}</td>
                <td>{pct(data.withoutFast.hardStoolDayRate)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {data.breakSymptoms.length > 0 && (
          <p className="mt-3 text-sm text-muted">Tras romper el ayuno, lo más frecuente: {data.breakSymptoms.map((s) => `${s.label.toLowerCase()} (${s.count})`).join(', ')}.</p>
        )}
        <p className="mt-3 text-xs text-muted">Asociaciones observadas en tus registros; no son diagnósticos.</p>
      </Card>
    </>
  );
}

// ───────── Historial ─────────

function History({ now }: { now: number }) {
  const confirm = useConfirm();
  const fasts = useLiveQuery(() => getDb().fasts.orderBy('startAt').reverse().limit(60).toArray(), []);
  const done = (fasts ?? []).filter((f) => f.endAt !== undefined);
  return (
    <>
      <SectionTitle>Historial</SectionTitle>
      {!done.length ? (
        <EmptyState title="Aún no hay ayunos terminados">Tus ayunos aparecerán aquí con su duración y cómo te sentiste.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {done.map((f) => {
            const st = fastState(f, now);
            const h = elapsedHours(f, now);
            return (
              <li key={f.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">
                    {hm(h)}
                    <Badge tone={st === 'completado' ? 'good' : 'mid'}>{st === 'completado' ? 'Meta cumplida' : `Meta ${f.targetHours} h`}</Badge>
                  </p>
                  <p className="text-[13px] text-muted">
                    {formatDateTime(f.startAt)} → {formatTime(f.endAt!)}
                    {f.hunger !== undefined ? ` · hambre ${f.hunger}/10` : ''}
                    {f.energy ? ` · energía ${['', 'baja', 'normal', 'alta'][f.energy]}` : ''}
                  </p>
                  {f.sideEffects && f.sideEffects.length > 0 && <p className="text-[13px] text-muted">{f.sideEffects.join(', ')}</p>}
                </div>
                <IconButton
                  label="Eliminar ayuno"
                  onClick={async () => {
                    if (await confirm({ title: 'Eliminar ayuno', message: 'Se quitará de tu historial.', confirmLabel: 'Eliminar', danger: true })) await deleteFast(f.id);
                  }}
                >
                  <Trash2 size={18} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
