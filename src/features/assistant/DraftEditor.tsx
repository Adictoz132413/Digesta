/**
 * Corrección manual de la ficha en borrador del asistente: cambiar el nombre,
 * la cantidad o la preparación de un alimento, quitar ingredientes o alimentos,
 * agregar otros y ajustar tipo y hora de la comida, síntomas y deposiciones.
 */
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { BRISTOL, MEAL_TYPES, PREPARATIONS, QUANTITIES, symptomLabel } from '@/domain/labels';
import { fromDateTimeInputs, toDateInput, toTimeInput } from '@/domain/dates';
import { formatMl, glassesToMl, HYDRATION_LEVELS } from '@/domain/hydration';
import type { BristolType, MealType, Preparation } from '@/domain/types';
import { mealTimeOf, mealTypeOf, type DraftEdit, type Session } from '@/voice/dialog';
import { Badge, Button, Chip, IconButton, IntensitySlider, Sheet, cx, inputClass } from '@/components/ui';

export function DraftEditor({
  open,
  onClose,
  session,
  onEdit,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  session: Session;
  onEdit: (e: DraftEdit) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const now = Date.now();
  const empty = !session.meals.length && !session.symptoms.length && !session.stools.length && !session.water && !session.hydration;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Corregir la ficha"
      description="Toca lo que quieras cambiar. Los cambios quedan en el borrador hasta que guardes."
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            Listo
          </Button>
          <Button block onClick={onSave} disabled={saving || empty}>
            {saving ? 'Guardando…' : 'Guardar ahora'}
          </Button>
        </div>
      }
    >
      {empty && <p className="py-8 text-center text-muted">El borrador está vacío.</p>}

      {session.meals.map((m) => {
        const type = mealTypeOf(m, now);
        const at = mealTimeOf(m, now);
        return (
          <section key={m.id} className="mb-4 rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <select
                aria-label="Tipo de comida"
                className={cx(inputClass, 'min-h-10 min-w-0 flex-1 py-1 text-sm font-semibold')}
                value={type}
                onChange={(e) => onEdit({ kind: 'meal', mealId: m.id, patch: { mealType: e.target.value as MealType } })}
              >
                {MEAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Hora de la comida"
                type="time"
                className={cx(inputClass, 'min-h-10 !w-36 shrink-0 py-1 text-sm')}
                value={toTimeInput(at)}
                onChange={(e) => e.target.value && onEdit({ kind: 'meal', mealId: m.id, patch: { at: fromDateTimeInputs(toDateInput(at), e.target.value) } })}
              />
              <IconButton label="Quitar esta comida" onClick={() => onEdit({ kind: 'removeMeal', mealId: m.id })} className="size-10 text-bad">
                <Trash2 size={18} />
              </IconButton>
            </div>

            <ul className="mt-3 space-y-3">
              {m.items.map((it, idx) => (
                <ItemEditor key={`${it.key}-${idx}`} mealId={m.id} index={idx} item={it} unknown={!it.known && !m.accepted.includes(it.key)} onEdit={onEdit} />
              ))}
            </ul>
            <AddItem onAdd={(name) => onEdit({ kind: 'addItem', mealId: m.id, name })} />
          </section>
        );
      })}

      {session.symptoms.length > 0 && (
        <section className="mb-4 rounded-2xl border border-border bg-surface p-3">
          <p className="mb-2 text-sm font-bold">Síntomas</p>
          {session.symptoms.map((x) => (
            <div key={x.id} className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">{symptomLabel(x.type, x.customName)}</span>
                <IconButton label="Quitar síntoma" onClick={() => onEdit({ kind: 'removeSymptom', id: x.id })} className="size-9 text-bad">
                  <X size={18} />
                </IconButton>
              </div>
              <IntensitySlider label="Intensidad" value={x.intensity ?? 4} onChange={(v) => onEdit({ kind: 'symptom', id: x.id, intensity: v })} />
            </div>
          ))}
        </section>
      )}

      {session.stools.length > 0 && (
        <section className="mb-4 rounded-2xl border border-border bg-surface p-3">
          <p className="mb-2 text-sm font-bold">Deposiciones</p>
          {session.stools.map((st) => (
            <div key={st.id} className="mb-2 flex items-center gap-2">
              <select
                aria-label="Tipo de Bristol"
                className={cx(inputClass, 'min-h-10 flex-1 py-1 text-sm')}
                value={st.bristol ?? ''}
                onChange={(e) => e.target.value && onEdit({ kind: 'stool', id: st.id, bristol: Number(e.target.value) as BristolType })}
              >
                <option value="">Tipo de Bristol…</option>
                {BRISTOL.map((b) => (
                  <option key={b.type} value={b.type}>
                    {b.title}: {b.description.split('.')[0]}
                  </option>
                ))}
              </select>
              <IconButton label="Quitar deposición" onClick={() => onEdit({ kind: 'removeStool', id: st.id })} className="size-10 text-bad">
                <Trash2 size={18} />
              </IconButton>
            </div>
          ))}
        </section>
      )}

      {(session.water > 0 || session.hydration) && (
        <section className="mb-4 rounded-2xl border border-border bg-surface p-3">
          <p className="mb-2 text-sm font-bold">Agua</p>
          {session.water > 0 && (
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>≈ {formatMl(glassesToMl(session.water))}</span>
              <IconButton label="Quitar agua" onClick={() => onEdit({ kind: 'water', value: 0 })} className="size-9 text-bad">
                <X size={18} />
              </IconButton>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {HYDRATION_LEVELS.map((h) => (
              <Chip key={h.value} size="sm" selected={session.hydration === h.value} onClick={() => onEdit({ kind: 'water', value: session.water, hydration: session.hydration === h.value ? null : h.value })}>
                {h.label}
              </Chip>
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}

function ItemEditor({
  mealId,
  index,
  item,
  unknown,
  onEdit,
}: {
  mealId: string;
  index: number;
  item: Session['meals'][number]['items'][number];
  unknown: boolean;
  onEdit: (e: DraftEdit) => void;
}) {
  const [name, setName] = useState(item.name);
  const commitName = () => {
    if (name.trim() && name.trim() !== item.name) onEdit({ kind: 'item', mealId, index, patch: { name } });
    else setName(item.name);
  };
  return (
    <li className="rounded-xl bg-surface-2 p-2.5">
      <div className="flex items-center gap-2">
        <input
          aria-label={`Nombre de ${item.name}`}
          className={cx(inputClass, 'min-h-10 flex-1 py-1 font-semibold')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
        <IconButton label={`Quitar ${item.name}`} onClick={() => onEdit({ kind: 'removeItem', mealId, index })} className="size-10 text-bad">
          <Trash2 size={18} />
        </IconButton>
      </div>
      {unknown && (
        <p className="mt-1 text-xs">
          <Badge tone="mid">No reconocido</Badge> <span className="text-muted">Corrige el nombre si me equivoqué, o quítalo.</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Cantidad de ${item.name}`}>
        {QUANTITIES.map((q) => (
          <Chip key={q.value} size="sm" role="radio" aria-checked={item.quantity === q.value} selected={item.quantity === q.value} onClick={() => onEdit({ kind: 'item', mealId, index, patch: { quantity: q.value } })}>
            {q.label}
          </Chip>
        ))}
      </div>
      {item.quantity === 'personalizada' && (
        <input
          aria-label={`Cantidad de ${item.name}`}
          className={cx(inputClass, 'mt-2 min-h-10 py-1 text-sm')}
          defaultValue={item.customQuantity ?? ''}
          placeholder="p. ej. 3, 2 rodajas, 1 taza"
          onBlur={(e) => onEdit({ kind: 'item', mealId, index, patch: { customQuantity: e.target.value } })}
        />
      )}
      <select
        aria-label={`Preparación de ${item.name}`}
        className={cx(inputClass, 'mt-2 min-h-10 py-1 text-sm')}
        value={item.preparation ?? ''}
        onChange={(e) => onEdit({ kind: 'item', mealId, index, patch: { preparation: (e.target.value || null) as Preparation | null } })}
      >
        <option value="">Preparación: sin especificar</option>
        {PREPARATIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {item.ingredients && item.ingredients.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-semibold text-muted">Ingredientes (toca para quitar)</p>
          <div className="flex flex-wrap gap-1.5">
            {item.ingredients.map((ing) => (
              <Chip key={ing} size="sm" selected onClick={() => onEdit({ kind: 'removeIngredient', mealId, index, ingredient: ing })} aria-label={`Quitar ingrediente ${ing}`}>
                {ing} <X size={12} />
              </Chip>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function AddItem({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v);
        setV('');
      }}
    >
      <input aria-label="Agregar alimento" className={cx(inputClass, 'min-h-10 py-1 text-sm')} placeholder="Agregar alimento" value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" size="sm" variant="soft" disabled={!v.trim()}>
        <Plus size={16} /> Agregar
      </Button>
    </form>
  );
}
