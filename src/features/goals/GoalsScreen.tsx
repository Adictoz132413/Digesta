/**
 * MIS METAS
 * Lista de consejos para ir cumpliendo y tachando (p. ej. los de un video).
 * Se llenan a mano o pegando la transcripción para que la IA saque las acciones.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Check, ExternalLink, ListChecks, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addGoals, deleteGoal, deleteSource, listGoals, renameSource, seedGoalsOnce, toggleGoal, updateGoal, type GoalInput } from '@/db/goals';
import { dayKey, formatShortDate } from '@/domain/dates';
import type { Goal } from '@/domain/types';
import { AiError, aiReady, extractGoalsWithAi } from '@/voice/ai';
import { navigate } from '@/lib/router';
import { Button, Card, EmptyState, Field, IconButton, Sheet, TextArea, cx, errorMessage, inputClass, useConfirm, useToast } from '@/components/ui';

export function GoalsScreen() {
  const goals = useLiveQuery(() => listGoals(), [], undefined);
  const toast = useToast();
  const [editing, setEditing] = useState<Goal | 'new' | undefined>();
  const [importing, setImporting] = useState(false);
  const [editSource, setEditSource] = useState<{ name: string; url?: string }>();
  const [hideDone, setHideDone] = useState(false);

  useEffect(() => {
    void seedGoalsOnce();
  }, []);

  if (!goals) return null;
  const done = goals.filter((g) => g.done).length;
  const groups = [...new Set(goals.map((g) => g.source))].map((source) => ({ source, url: goals.find((g) => g.source === source && g.sourceUrl)?.sourceUrl, items: goals.filter((g) => g.source === source) }));
  const sources = groups.map((g) => g.source);

  const toggle = async (g: Goal) => {
    try {
      const r = await toggleGoal(g);
      if (r.done && done + 1 === goals.length) toast('¡Cumpliste todas tus metas!');
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    }
  };

  return (
    <div className="pt-1">
      <h1 className="text-2xl font-extrabold tracking-tight">Mis metas</h1>
      <p className="text-sm text-muted">Consejos para ir cumpliendo. Tócalos para tacharlos.</p>

      {goals.length > 0 && (
        <Card className="mt-4">
          <div className="flex items-baseline justify-between">
            <p className="font-bold">
              {done} de {goals.length} cumplidas
            </p>
            <span className="text-sm font-semibold text-primary">{Math.round((done / goals.length) * 100)}%</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={goals.length} aria-valuenow={done} aria-label="Metas cumplidas">
            <div className={cx('h-full rounded-full transition-all', done === goals.length ? 'bg-good' : 'bg-primary')} style={{ width: `${(done / goals.length) * 100}%` }} />
          </div>
          {done > 0 && (
            <button type="button" className="mt-2 text-xs font-semibold text-muted underline" onClick={() => setHideDone(!hideDone)}>
              {hideDone ? 'Mostrar las cumplidas' : 'Ocultar las cumplidas'}
            </button>
          )}
        </Card>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={() => setImporting(true)}>
          <Sparkles size={17} /> Sacar de un video
        </Button>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus size={17} /> Agregar meta
        </Button>
      </div>

      {goals.length === 0 && (
        <div className="mt-6">
          <EmptyState icon={<ListChecks size={28} />} title="Aún no tienes metas">
            Pega la transcripción de un video para que la IA saque todo lo que recomienda, o agrega tus metas a mano.
          </EmptyState>
        </div>
      )}

      {groups.map((grp) => {
        const visible = hideDone ? grp.items.filter((g) => !g.done) : grp.items;
        const gDone = grp.items.filter((g) => g.done).length;
        return (
          <section key={grp.source} className="mt-6">
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold uppercase tracking-wider text-muted">{grp.source}</h2>
                <p className="text-xs text-muted">
                  {gDone}/{grp.items.length} cumplidas
                  {grp.url && (
                    <>
                      {' · '}
                      <a href={grp.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-semibold text-primary underline">
                        Ver fuente <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </p>
              </div>
              <IconButton label={`Editar el grupo ${grp.source}`} onClick={() => setEditSource({ name: grp.source, url: grp.url })} className="size-9 text-muted">
                <Pencil size={16} />
              </IconButton>
            </div>
            {visible.length === 0 ? (
              <p className="px-1 text-sm text-muted">Todo cumplido aquí.</p>
            ) : (
              <ul className="space-y-2">
                {visible.map((g) => (
                  <GoalRow key={g.id} goal={g} onToggle={() => void toggle(g)} onEdit={() => setEditing(g)} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <GoalEditor goal={editing} sources={sources} onClose={() => setEditing(undefined)} />
      <ImportSheet open={importing} sources={sources} onClose={() => setImporting(false)} />
      <SourceEditor source={editSource} onClose={() => setEditSource(undefined)} />
    </div>
  );
}

function GoalRow({ goal: g, onToggle, onEdit }: { goal: Goal; onToggle: () => void; onEdit: () => void }) {
  return (
    <li className={cx('flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card', g.done && 'opacity-70')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={g.done}
        aria-label={`${g.done ? 'Desmarcar' : 'Tachar'}: ${g.text}`}
        onClick={onToggle}
        className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border-2 transition active:scale-90', g.done ? 'border-good bg-good text-white' : 'border-border bg-surface')}
      >
        {g.done && <Check size={18} strokeWidth={3} />}
      </button>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left" aria-label={`Ver o editar: ${g.text}`}>
        <span className={cx('block font-semibold leading-snug', g.done && 'text-muted line-through')}>{g.text}</span>
        {g.detail && <span className={cx('mt-0.5 block text-sm text-muted', g.done && 'line-through')}>{g.detail}</span>}
        {g.caution && !g.done && (
          <span className="mt-1.5 flex gap-1.5 rounded-xl bg-mid-soft px-2 py-1.5 text-xs leading-snug text-text">
            <AlertTriangle size={14} className="mt-px shrink-0 text-mid" />
            <span>{g.caution}</span>
          </span>
        )}
        {g.done && g.doneAt && <span className="mt-0.5 block text-xs text-good">Cumplida el {formatShortDate(dayKey(g.doneAt))}</span>}
      </button>
    </li>
  );
}

function GoalEditor({ goal, sources, onClose }: { goal: Goal | 'new' | undefined; sources: string[]; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = goal === 'new';
  const g = goal && goal !== 'new' ? goal : undefined;
  const [form, setForm] = useState<GoalInput>({ source: '', text: '' });
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!goal) return;
    setError(undefined);
    setForm(g ? { source: g.source, sourceUrl: g.sourceUrl, text: g.text, detail: g.detail, caution: g.caution } : { source: sources[0] ?? 'Mis metas', text: '' });
  }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      if (g) await updateGoal(g.id, form);
      else await addGoals([form]);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Sheet
      open={!!goal}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Agregar meta' : 'Editar meta'}
      footer={
        <div className="flex gap-2">
          {g && (
            <IconButton
              label="Borrar meta"
              className="size-12 text-bad"
              onClick={async () => {
                if (!(await confirm({ title: '¿Borrar esta meta?', message: g.text, confirmLabel: 'Borrar', danger: true }))) return;
                await deleteGoal(g.id);
                toast('Meta borrada');
                onClose();
              }}
            >
              <Trash2 size={20} />
            </IconButton>
          )}
          <Button block onClick={() => void save()} disabled={!form.text.trim()}>
            Guardar
          </Button>
        </div>
      }
    >
      <Field label="Meta" htmlFor="goal-text" error={error}>
        <TextArea id="goal-text" rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="p. ej. Caminar 10 minutos después de cada comida" />
      </Field>
      <Field label="Detalle (opcional)" htmlFor="goal-detail" hint="Cantidad, horario o cómo hacerlo.">
        <TextArea id="goal-detail" rows={2} value={form.detail ?? ''} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
      </Field>
      <Field label="Grupo o fuente" htmlFor="goal-source" hint="El video o la persona de donde sale el consejo.">
        <input id="goal-source" list="goal-sources" className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        <datalist id="goal-sources">
          {sources.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      {form.caution && (
        <div className="mb-4 flex gap-2 rounded-2xl bg-mid-soft p-3 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-mid" />
          <span>{form.caution}</span>
        </div>
      )}
    </Sheet>
  );
}

function SourceEditor({ source, onClose }: { source?: { name: string; url?: string }; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!source) return;
    setName(source.name);
    setUrl(source.url ?? '');
    setError(undefined);
  }, [source]);
  if (!source) return null;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Editar grupo"
      footer={
        <div className="flex gap-2">
          <IconButton
            label="Borrar el grupo y sus metas"
            className="size-12 text-bad"
            onClick={async () => {
              if (!(await confirm({ title: `¿Borrar «${source.name}»?`, message: 'Se borran todas las metas de este grupo.', confirmLabel: 'Borrar todo', danger: true }))) return;
              await deleteSource(source.name);
              toast('Grupo borrado');
              onClose();
            }}
          >
            <Trash2 size={20} />
          </IconButton>
          <Button
            block
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await renameSource(source.name, name, url);
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Guardar
          </Button>
        </div>
      }
    >
      <Field label="Nombre" htmlFor="src-name">
        <input id="src-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Enlace (opcional)" htmlFor="src-url" error={error}>
        <input id="src-url" type="url" inputMode="url" className={inputClass} placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function ImportSheet({ open, sources, onClose }: { open: boolean; sources: string[]; onClose: () => void }) {
  const toast = useToast();
  const [source, setSource] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [found, setFound] = useState<(GoalInput & { keep: boolean })[]>();
  const ready = aiReady();

  useEffect(() => {
    if (!open) return;
    setFound(undefined);
    setError(undefined);
  }, [open]);

  const extract = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const items = await extractGoalsWithAi(source, text);
      if (!items.length) setError('No encontré consejos concretos en ese texto.');
      setFound(items.map((i) => ({ ...i, source, sourceUrl: url, keep: true })));
    } catch (e) {
      setError(e instanceof AiError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addAll = async () => {
    try {
      const keep = found!.filter((f) => f.keep);
      await addGoals(keep.map(({ keep: _k, ...g }) => ({ ...g, source: source.trim() || 'Video', sourceUrl: url.trim() || undefined })));
      toast(`Agregué ${keep.length} ${keep.length === 1 ? 'meta' : 'metas'}`);
      setText('');
      setUrl('');
      setSource('');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Sacar metas de un video"
      description="Pega la transcripción y la IA arma la lista de todo lo que recomienda."
      footer={
        found ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setFound(undefined)}>
              Atrás
            </Button>
            <Button block disabled={!found.some((f) => f.keep)} onClick={() => void addAll()}>
              Agregar {found.filter((f) => f.keep).length} metas
            </Button>
          </div>
        ) : (
          <Button block disabled={!ready || busy || text.trim().length < 40} onClick={() => void extract()}>
            {busy ? 'Leyendo el texto…' : 'Sacar los consejos'}
          </Button>
        )
      }
    >
      {!ready && (
        <div className="mb-4 rounded-2xl bg-mid-soft p-3 text-sm">
          Para esto necesitas la IA activada.{' '}
          <button type="button" className="font-semibold underline" onClick={() => navigate('/ajustes')}>
            Actívala en Ajustes
          </button>
          , o agrega las metas a mano.
        </div>
      )}

      {!found ? (
        <>
          <Field label="Nombre del video" htmlFor="imp-src" hint="Para agruparlas: p. ej. «Video 1: rutina de la mañana».">
            <input id="imp-src" list="imp-sources" className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Video 1" />
            <datalist id="imp-sources">
              {sources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Enlace del video (opcional)" htmlFor="imp-url">
            <input id="imp-url" type="url" inputMode="url" className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </Field>
          <Field
            label="Transcripción o lo que dice el video"
            htmlFor="imp-text"
            error={error}
            hint="En YouTube (computador): debajo del video, «…más» → «Mostrar transcripción»; selecciona el texto, cópialo y pégalo aquí. También sirve escribir un resumen."
          >
            <TextArea id="imp-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pega aquí el texto…" />
          </Field>
          <p className="text-xs leading-relaxed text-muted">
            Sólo se envía este texto a Anthropic (Claude) con tu clave. Un video de 15 minutos cuesta aprox. 5 a 15 centavos de dólar con Opus, mucho menos con Haiku.
          </p>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">Revisa la lista. Quita la marca de lo que no quieras agregar.</p>
          <ul className="space-y-2">
            {found.map((f, i) => (
              <li key={i}>
                <label className={cx('flex gap-3 rounded-2xl border border-border p-3', f.keep ? 'bg-surface' : 'bg-surface-2 opacity-60')}>
                  <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" checked={f.keep} onChange={(e) => setFound(found.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{f.text}</span>
                    {f.detail && <span className="block text-sm text-muted">{f.detail}</span>}
                    {f.caution && (
                      <span className="mt-1 flex gap-1.5 text-xs text-text">
                        <AlertTriangle size={13} className="mt-px shrink-0 text-mid" /> {f.caution}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
