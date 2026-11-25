/**
 * Lista de metas: consejos para ir cumpliendo y tachando (p. ej. los de un video).
 * Todo se guarda en el teléfono y entra en las copias de seguridad.
 */
import { getDb } from './db';
import { newId, ValidationError } from './repo';
import { firstIssue, goalSchema } from './schemas';
import type { Goal, GoalCategory } from '@/domain/types';

export interface GoalInput {
  source: string;
  sourceUrl?: string;
  text: string;
  detail?: string;
  caution?: string;
  category?: GoalCategory;
}

const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

function validate(g: Goal): Goal {
  const r = goalSchema.safeParse(g);
  if (!r.success) throw new ValidationError(firstIssue(r.error));
  return r.data as Goal;
}

/** Metas ordenadas: por fuente (en orden de creación) y luego por orden. */
export async function listGoals(): Promise<Goal[]> {
  return sortGoals(await getDb().goals.toArray());
}

export function sortGoals(goals: Goal[]): Goal[] {
  const firstOf = new Map<string, number>();
  for (const g of goals) firstOf.set(g.source, Math.min(firstOf.get(g.source) ?? Infinity, g.createdAt));
  return [...goals].sort((a, b) => (firstOf.get(a.source)! - firstOf.get(b.source)!) || a.source.localeCompare(b.source) || a.order - b.order);
}

/** Agrega varias metas al final de su fuente. */
export async function addGoals(inputs: GoalInput[]): Promise<Goal[]> {
  const db = getDb();
  const now = Date.now();
  const existing = await db.goals.toArray();
  const maxOrder = existing.reduce((m, g) => Math.max(m, g.order), 0);
  const out = inputs
    .filter((i) => i.text.trim())
    .map((i, n) =>
      validate({
        id: newId(),
        source: i.source.trim() || 'Mis metas',
        sourceUrl: clean(i.sourceUrl),
        text: i.text.trim(),
        detail: clean(i.detail),
        caution: clean(i.caution),
        category: i.category,
        done: false,
        order: maxOrder + n + 1,
        createdAt: now + n,
        updatedAt: now + n,
      }),
    );
  await db.goals.bulkPut(out);
  return out;
}

/**
 * Agrega una lista completa. Si una meta igual ya existe en otro grupo (p. ej.
 * «Comprar el péptido pinealon»), se mueve a este grupo conservando si ya
 * estaba cumplida, en vez de duplicarla.
 */
export async function addPreset(source: string, sourceUrl: string, items: Omit<GoalInput, 'source' | 'sourceUrl'>[]): Promise<number> {
  const db = getDb();
  const norm = (t: string) => t.trim().toLowerCase();
  const existing = await db.goals.toArray();
  const fresh: GoalInput[] = [];
  for (const i of items) {
    const same = existing.find((g) => norm(g.text) === norm(i.text));
    if (same) await updateGoal(same.id, { ...i, source, sourceUrl });
    else fresh.push({ ...i, source, sourceUrl });
  }
  await addGoals(fresh);
  return items.length;
}

export async function updateGoal(id: string, patch: Partial<GoalInput> & { done?: boolean }): Promise<Goal> {
  const db = getDb();
  const prev = await db.goals.get(id);
  if (!prev) throw new ValidationError('Esa meta ya no existe');
  const now = Date.now();
  const next: Goal = {
    ...prev,
    ...(patch.source !== undefined && { source: patch.source.trim() || 'Mis metas' }),
    ...(patch.text !== undefined && { text: patch.text.trim() }),
    ...('sourceUrl' in patch && { sourceUrl: clean(patch.sourceUrl) }),
    ...('detail' in patch && { detail: clean(patch.detail) }),
    ...('caution' in patch && { caution: clean(patch.caution) }),
    ...('category' in patch && { category: patch.category }),
    updatedAt: now,
  };
  if (patch.done !== undefined && patch.done !== prev.done) {
    next.done = patch.done;
    next.doneAt = patch.done ? now : undefined;
  }
  const v = validate(next);
  await db.goals.put(v);
  return v;
}

export const toggleGoal = (g: Goal) => updateGoal(g.id, { done: !g.done });

export async function deleteGoal(id: string) {
  await getDb().goals.delete(id);
}

/** Cambia el nombre (y enlace) de una fuente en todas sus metas. */
export async function renameSource(from: string, to: string, url?: string) {
  const db = getDb();
  const now = Date.now();
  const rows = await db.goals.where('source').equals(from).toArray();
  await db.goals.bulkPut(rows.map((g) => validate({ ...g, source: to.trim() || 'Mis metas', sourceUrl: clean(url), updatedAt: now })));
}

export async function deleteSource(source: string) {
  await getDb().goals.where('source').equals(source).delete();
}

/** Primera meta pedida al crear la lista (sólo una vez). */
const SEEDED_KEY = 'digesta:metas-iniciadas';
export const PINEALON_CAUTION =
  'El pinealon no está aprobado como medicamento: se vende como «producto de investigación», sin dosis establecida ni estudios sólidos en personas, y la pureza depende del vendedor. Antes de usarlo, consúltalo con un médico, sobre todo si tomas otros medicamentos.';

export async function seedGoalsOnce() {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return;
    localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    return;
  }
  if ((await getDb().goals.count()) > 0) return;
  await addGoals([{ source: 'Videos de YouTube', text: 'Comprar el péptido pinealon', caution: PINEALON_CAUTION }]);
}

/**
 * Agrega solas, una sola vez, las listas incluidas en la app (los videos que
 * la persona pidió seguir). Si después borra una lista, no vuelve a aparecer
 * sola: queda la tarjeta para agregarla con un toque.
 */
export async function seedPresetsOnce() {
  const { GOAL_PRESETS } = await import('@/domain/goalPresets');
  await seedGoalsOnce();
  for (const p of GOAL_PRESETS) {
    const key = `digesta:lista:${p.sourceUrl}`;
    try {
      if (localStorage.getItem(key)) continue;
      localStorage.setItem(key, '1');
    } catch {
      return;
    }
    const goals = await getDb().goals.toArray();
    if (goals.some((g) => g.source === p.source || g.sourceUrl === p.sourceUrl)) continue;
    await addPreset(p.source, p.sourceUrl, p.items);
  }
  await backfillCategories();
}

/** Pone el tema a las metas de las listas incluidas que se agregaron antes de que existieran los temas. */
export async function backfillCategories() {
  const { GOAL_PRESETS } = await import('@/domain/goalPresets');
  const norm = (t: string) => t.trim().toLowerCase();
  const byText = new Map(GOAL_PRESETS.flatMap((p) => p.items.map((i) => [norm(i.text), i.category] as const)));
  const db = getDb();
  const missing = (await db.goals.toArray()).filter((g) => !g.category && byText.get(norm(g.text)));
  if (missing.length) await db.goals.bulkPut(missing.map((g) => ({ ...g, category: byText.get(norm(g.text)) })));
}
