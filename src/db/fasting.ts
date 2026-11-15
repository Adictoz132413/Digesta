/** Persistencia de ayunos (validada con zod). */
import { getDb } from './db';
import { fastSchema, firstIssue } from './schemas';
import { newId, ValidationError } from './repo';
import { HOUR } from '@/domain/dates';
import { mealBreaksFast } from '@/domain/fasting';
import type { Fast, FastProtocol, Meal } from '@/domain/types';

function validate(f: unknown): Fast {
  const r = fastSchema.safeParse(f);
  if (!r.success) throw new ValidationError(firstIssue(r.error));
  return r.data as Fast;
}

/** Ayuno sin terminar (en curso o programado). Sólo puede haber uno. */
export async function openFast(): Promise<Fast | undefined> {
  const list = await getDb().fasts.filter((f) => f.endAt === undefined).toArray();
  return list.sort((a, b) => b.startAt - a.startAt)[0];
}

export async function startFast(input: { startAt: number; targetHours: number; protocol: FastProtocol }): Promise<Fast> {
  const db = getDb();
  if (await openFast()) throw new ValidationError('Ya tienes un ayuno en curso o programado. Termínalo o cancélalo primero.');
  if (input.startAt > Date.now() + 48 * HOUR) throw new ValidationError('Sólo puedes programar un ayuno en las próximas 48 horas.');
  const now = Date.now();
  const f = validate({ id: newId(), ...input, createdAt: now, updatedAt: now });
  await db.fasts.put(f);
  return f;
}

export async function updateFast(id: string, patch: Partial<Omit<Fast, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Fast> {
  const db = getDb();
  const prev = await db.fasts.get(id);
  if (!prev) throw new ValidationError('El ayuno ya no existe');
  const merged: Record<string, unknown> = { ...prev, ...patch, updatedAt: Date.now() };
  for (const k of Object.keys(patch)) if ((patch as Record<string, unknown>)[k] === undefined) delete merged[k];
  const f = validate(merged);
  await db.fasts.put(f);
  return f;
}

export async function endFast(id: string, at = Date.now(), extra: Partial<Pick<Fast, 'brokenByMealId' | 'hunger' | 'energy' | 'sideEffects' | 'notes'>> = {}): Promise<Fast> {
  const prev = await getDb().fasts.get(id);
  if (!prev) throw new ValidationError('El ayuno ya no existe');
  return updateFast(id, { ...extra, endAt: Math.max(prev.startAt, at) });
}

export async function deleteFast(id: string) {
  await getDb().fasts.delete(id);
}

/**
 * Si hay un ayuno en curso y se registra una comida que lo rompe (posterior al
 * inicio), lo termina a la hora de esa comida. Devuelve el ayuno terminado.
 * Las bebidas permitidas (agua, tinto, aromática sin azúcar) no lo rompen.
 */
export async function maybeEndFastWithMeal(meal: Meal): Promise<Fast | undefined> {
  const f = await openFast();
  if (!f || meal.at <= f.startAt || meal.at > Date.now() + 5 * 60_000) return undefined;
  if (!mealBreaksFast(meal)) return undefined;
  return endFast(f.id, meal.at, { brokenByMealId: meal.id });
}

/** Deshace el cierre automático (si la comida no rompía el ayuno). */
export async function reopenFast(id: string): Promise<void> {
  await updateFast(id, { endAt: undefined, brokenByMealId: undefined });
}
