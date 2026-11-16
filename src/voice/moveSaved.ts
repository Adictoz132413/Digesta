/**
 * Corrige la hora de alimentos ya guardados: "el batido que registraste me lo
 * tomé a las 4". Busca la comida más reciente (últimas 48 h) que los contiene;
 * si eran toda la comida le cambia la hora, si no, los separa en una comida nueva.
 */
import { getDb } from '@/db/db';
import { keysOfItems, saveMeal } from '@/db/repo';
import { catalogFood, deriveFlags, foodKey } from '@/domain/foods';
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

/** Palabras con las que se puede haber guardado un alimento (nombre, alias del catálogo, ingredientes). */
function wordsFor(key: string): string[] {
  const cat = catalogFood(key);
  const phrases = [key, ...(cat ? [foodKey(cat.name), ...(cat.aliases ?? []).map(foodKey)] : [])];
  const stop = new Set(['de', 'con', 'la', 'el', 'en', 'y', 'del']);
  const self = cat ? foodKey(cat.name) : key;
  // Sin palabras que son otro alimento ("leche" no sirve para encontrar un batido)
  const isOther = (w: string) => {
    const c = catalogFood(w);
    return !!c && foodKey(c.name) !== self;
  };
  return [...new Set(phrases.flatMap((p) => p.split(' ')).filter((w) => w.length >= 4 && !stop.has(w) && !isOther(w)))];
}

/**
 * Busca la comida guardada a la que se refiere un pedido de corrección.
 *  1. La más reciente del tipo y con los alimentos mencionados (72 h o el día indicado).
 *  2. Si no, por nombres parecidos ("batido de proteína" ↔ "suero", "whey").
 *  3. Si dijo "el último", la última comida guardada.
 * Devuelve también las comidas recientes para ofrecerlas como opciones.
 */
export async function findSavedMealCandidates(
  req: { mealType?: Meal['mealType']; keys: string[]; dayOffset?: number; last?: boolean },
  now = Date.now(),
): Promise<{ meal?: Meal; recent: Meal[] }> {
  let from = now - 72 * 3600_000;
  let to = now + 60_000;
  if (req.dayOffset !== undefined) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + req.dayOffset);
    from = d.getTime();
    to = from + 24 * 3600_000;
  }
  const list: Meal[] = await getDb().meals.where('at').between(from, to, true, false).reverse().sortBy('at');
  const typeOk = (m: Meal) => !req.mealType || m.mealType === req.mealType;
  const exact = (m: Meal) => !req.keys.length || m.items.some((i) => req.keys.includes(i.key) || (i.ingredients ?? []).some((x) => req.keys.includes(foodKey(x))));
  const words = req.keys.flatMap(wordsFor);
  const fuzzy = (m: Meal) => words.length > 0 && m.items.some((i) => words.some((w) => i.key.split(' ').includes(w) || (i.ingredients ?? []).some((x) => foodKey(x).split(' ').includes(w))));
  const meal =
    list.find((m) => typeOk(m) && exact(m)) ??
    (req.keys.length ? list.find((m) => typeOk(m) && fuzzy(m)) ?? list.find(fuzzy) : undefined) ??
    (req.last ? list.find(typeOk) ?? list[0] : undefined) ??
    (!req.keys.length && req.mealType ? list.find(typeOk) : undefined);
  return { meal, recent: list.slice(0, 4) };
}

/** Compatibilidad: sólo la comida encontrada. */
export async function findSavedMeal(req: { mealType?: Meal['mealType']; keys: string[]; dayOffset?: number; last?: boolean }, now = Date.now()): Promise<Meal | undefined> {
  return (await findSavedMealCandidates(req, now)).meal;
}
