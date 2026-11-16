/**
 * Corrige la hora de alimentos ya guardados: "el batido que registraste me lo
 * tomé a las 4". Busca la comida más reciente (últimas 48 h) que los contiene;
 * si eran toda la comida le cambia la hora, si no, los separa en una comida nueva.
 */
import { getDb } from '@/db/db';
import { keysOfItems, saveMeal } from '@/db/repo';
import { deriveFlags } from '@/domain/foods';
import { suggestMealType } from '@/domain/labels';
import type { Meal } from '@/domain/types';
import { isBeverage } from './nlu';

export async function moveSavedFoods(ref: { keys: string[]; at: number }, now = Date.now()): Promise<{ names: string[]; split: boolean } | undefined> {
  const recent = await getDb().meals.where('at').above(now - 48 * 3600_000).reverse().sortBy('at');
  const meal = recent.find((m: Meal) => m.items.some((i) => ref.keys.includes(i.key)));
  if (!meal) return undefined;
  const moving = meal.items.filter((i) => ref.keys.includes(i.key));
  const staying = meal.items.filter((i) => !ref.keys.includes(i.key));
  const typeFor = (items: Meal['items']) => (items.every((i) => isBeverage(i.key)) ? 'bebida' : suggestMealType(new Date(ref.at)));
  if (!staying.length) {
    await saveMeal({ ...meal, at: ref.at, mealType: typeFor(moving) });
    return { names: moving.map((i) => i.name), split: false };
  }
  await saveMeal({ ...meal, items: staying, flags: deriveFlags(keysOfItems(staying)) });
  await saveMeal({ at: ref.at, mealType: typeFor(moving), items: moving, flags: deriveFlags(keysOfItems(moving)), supplements: [], notes: 'Hora corregida por voz' });
  return { names: moving.map((i) => i.name), split: true };
}
