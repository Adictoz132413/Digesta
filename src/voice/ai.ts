/**
 * Interpretación con una IA real (Claude, de Anthropic) — opcional.
 *
 * Sólo se envía la frase que dictaste o escribiste, la fecha y hora actuales,
 * el borrador de esta conversación y la pregunta pendiente. Nunca se envía tu
 * diario guardado: las consultas («¿qué cené ayer?») se responden en el
 * teléfono con los datos locales. Si no hay internet, no hay clave o la IA
 * falla, el asistente usa las reglas locales de siempre.
 */
import { addDays, dayKey, dayStart } from '@/domain/dates';
import { catalogFood, foodKey, prettyName } from '@/domain/foods';
import type { AiOutput } from './aiClient';
import type { DigestionRating, FeelingAfter, HydrationLevel, MealType, Preparation, QuantityLevel, SymptomType } from '@/domain/types';
import { isBeverage, matchFoods, TYPICAL_HOUR, type DraftItem, type DraftMeal, type DraftStool, type DraftSymptom, type ParseResult } from './nlu';
import { dayPhrase, type QueryIntent, type QueryKind, type Range, type ReminderIntent } from './query';

// ───────── Preferencias (sólo en este dispositivo; no van en las copias de seguridad) ─────────

export type AiModel = 'claude-opus-5-5' | 'claude-haiku-5-5';

export interface AiPrefs {
  enabled: boolean;
  apiKey: string;
  model: AiModel;
}

export const AI_MODELS: { value: AiModel; label: string; description: string }[] = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'La más precisa. Cada frase cuesta aprox. 2 a 5 centavos de dólar (unos 100 a 200 pesos).' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Más rápida y mucho más barata (menos de 1 centavo de dólar por frase); algo menos fina con frases enredadas.' },
];

const AI_KEY = 'digesta:ia';
export const DEFAULT_AI_PREFS: AiPrefs = { enabled: false, apiKey: '', model: 'claude-opus-5-5' };

export function readAiPrefs(): AiPrefs {
  try {
    const p = { ...DEFAULT_AI_PREFS, ...JSON.parse(localStorage.getItem(AI_KEY) ?? '{}') } as AiPrefs;
    if (!AI_MODELS.some((m) => m.value === p.model)) p.model = DEFAULT_AI_PREFS.model;
    return p;
  } catch {
    return DEFAULT_AI_PREFS;
  }
}

export function writeAiPrefs(p: AiPrefs) {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento */
  }
}

export function aiReady(p: AiPrefs = readAiPrefs()): boolean {
  return p.enabled && p.apiKey.trim().length > 20;
}

export type { AiOutput } from './aiClient';

// ───────── Llamada ─────────

export interface AiContext {
  now: number;
  /** Líneas del borrador actual ("Almuerzo a las 12:30 p. m.: arroz, pollo"). */
  draft: string[];
  /** Pregunta pendiente del asistente, si hay. */
  pending?: string;
  bottleMl: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: 'clave' | 'saldo' | 'limite' | 'red' | 'rechazo' | 'formato' | 'otro',
  ) {
    super(message);
  }
}

/** Pide a Claude que interprete la frase. Lanza AiError si no se pudo. */
export async function interpretWithAi(raw: string, c: AiContext, prefs: AiPrefs = readAiPrefs()): Promise<AiOutput> {
  let mod: typeof import('./aiClient');
  try {
    mod = await import('./aiClient');
  } catch {
    throw new AiError('Sin conexión con la IA.', 'red');
  }
  return mod.callClaude(raw, c, prefs);
}

/** Saca de un texto (transcripción de un video) la lista de acciones para cumplir. */
export async function extractGoalsWithAi(source: string, text: string, prefs: AiPrefs = readAiPrefs()) {
  let mod: typeof import('./aiClient');
  try {
    mod = await import('./aiClient');
  } catch {
    throw new AiError('Sin conexión con la IA.', 'red');
  }
  return mod.callClaudeGoals(source, text, prefs);
}

/** Prueba la clave con una frase corta. */
export async function testAi(prefs: AiPrefs): Promise<string> {
  const out = await interpretWithAi('desayuné arepa con queso', { now: Date.now(), draft: [], bottleMl: 600 }, prefs);
  const n = out.meals.flatMap((m) => m.items.map((i) => i.name)).join(', ');
  return n ? `Funciona. Entendí: ${n}.` : 'Funciona.';
}

// ───────── Conversión al formato del asistente ─────────

export interface AiTurn {
  parse: ParseResult;
  query?: QueryIntent;
  reminder?: ReminderIntent;
  /** Respuesta breve de la IA (sólo cuando no hay nada que registrar). */
  reply?: string;
}

function at(time: string | null, dayOffset: number, now: number): number | undefined {
  const m = time?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return dayStart(addDays(dayKey(now), dayOffset)) + h * 3600_000 + min * 60_000;
}

/** Hora de un hecho pasado: si quedó en el futuro, se asume que fue el día anterior. */
function pastAt(time: string | null, dayOffset: number, now: number): number | undefined {
  const t = at(time, Math.min(0, dayOffset), now);
  if (t === undefined) return undefined;
  return t > now + 10 * 60_000 ? t - 24 * 3600_000 : t;
}

function toItem(it: AiOutput['meals'][number]['items'][number], extraFoods: { name: string; key: string }[]): DraftItem | undefined {
  const raw = it.name.trim();
  if (!raw) return undefined;
  const hits = matchFoods(raw, extraFoods);
  const exact = hits.find((h) => foodKey(h.name) === foodKey(raw)) ?? (hits.length === 1 ? hits[0] : undefined);
  const key = exact?.key ?? foodKey(raw);
  const name = exact?.name ?? prettyName(raw);
  const ingredients = it.ingredients.length ? it.ingredients.map(prettyName) : catalogFood(key)?.ingredients ? [...catalogFood(key)!.ingredients!] : undefined;
  const custom = it.quantity === 'personalizada' && it.custom_quantity?.trim() ? it.custom_quantity.trim() : undefined;
  return {
    name,
    key,
    quantity: (it.quantity === 'personalizada' && !custom ? 'normal' : it.quantity) as QuantityLevel,
    customQuantity: custom,
    preparation: (it.preparation ?? undefined) as Preparation | undefined,
    ingredients,
    known: true,
    explicitQty: it.quantity !== 'normal',
  };
}

function rangeFrom(from: number | null, to: number | null, now: number): Range | undefined {
  if (from === null && to === null) return undefined;
  const today = dayKey(now);
  const a = Math.min(from ?? to!, to ?? from!, 0);
  const b = Math.min(Math.max(from ?? to!, to ?? from!), 0);
  const start = dayStart(addDays(today, a));
  const end = Math.min(dayStart(addDays(today, b + 1)), now + 1);
  const single = a === b;
  const label = single ? dayPhrase(start, now) : b === 0 ? `en los últimos ${b - a + 1} días` : `entre ${dayPhrase(start, now)} y ${dayPhrase(dayStart(addDays(today, b)), now)}`;
  return { from: start, to: end, label, single };
}

const HYDRATION: Record<string, HydrationLevel> = { poca: 1, normal: 2, bastante: 3 };

/** Convierte la respuesta de la IA en lo que entiende el diálogo. */
export function aiToTurn(o: AiOutput, now: number, extraFoods: { name: string; key: string }[] = [], draftNames: { name: string; key: string }[] = []): AiTurn {
  const foodsOf = (names: string[]) =>
    names
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const hit = matchFoods(n, extraFoods)[0];
        return hit ?? { name: prettyName(n), key: foodKey(n) };
      });

  const meals: DraftMeal[] = [];
  for (const m of o.meals) {
    const items = m.items.map((i) => toItem(i, extraFoods)).filter((x): x is DraftItem => !!x);
    if (!items.length && !m.supplements.length) continue;
    let t = pastAt(m.time, m.day_offset, now);
    let timeExplicit = t !== undefined;
    if (t === undefined && m.day_offset < 0) {
      // "Ayer almorcé…" sin hora: se ubica a la hora típica de esa comida ese día
      const type = m.meal_type ?? 'almuerzo';
      t = dayStart(addDays(dayKey(now), m.day_offset)) + TYPICAL_HOUR[type] * 3600_000;
      timeExplicit = true;
    }
    const mealType: MealType | undefined = m.meal_type ?? (items.length && items.every((x) => isBeverage(x.key)) ? 'bebida' : undefined);
    meals.push({
      mealType,
      mealTypeExplicit: !!m.meal_type,
      at: t,
      timeExplicit,
      items,
      supplements: m.supplements.map(prettyName),
      feelingAfter: (m.feeling_after ?? undefined) as FeelingAfter | undefined,
    });
  }

  const symptoms: DraftSymptom[] = o.symptoms.map((x) => {
    const t = pastAt(x.time, x.day_offset, now);
    return {
      type: x.type as SymptomType,
      customName: x.type === 'otro' ? (x.custom_name ?? undefined) : undefined,
      intensity: x.intensity === null ? undefined : Math.max(0, Math.min(10, x.intensity)),
      at: t,
      timeExplicit: t !== undefined,
      status: x.status,
      durationMin: x.duration_min ?? undefined,
    };
  });

  const stools: DraftStool[] = o.stools.map((x) => {
    const t = pastAt(x.time, x.day_offset, now);
    const b = x.bristol !== null && x.bristol >= 1 && x.bristol <= 7 ? (x.bristol as DraftStool['bristol']) : undefined;
    return {
      at: t,
      timeExplicit: t !== undefined,
      bristol: b,
      blood: x.blood ?? undefined,
      pain: x.pain || undefined,
      mucus: x.mucus || undefined,
      incomplete: x.incomplete || undefined,
    };
  });

  // Quitar del borrador: se usa la clave del alimento que ya está ahí
  const removals = o.remove_from_draft
    .map((n) => {
      const k = foodKey(n);
      const inDraft = draftNames.find((d) => d.key === k || foodKey(d.name) === k) ?? draftNames.find((d) => d.key.startsWith(k) || k.startsWith(d.key));
      return inDraft?.key ?? k;
    })
    .filter(Boolean);

  const a = o.answer;
  const p: ParseResult = {
    meals,
    symptoms,
    stools,
    water: o.water_ml && o.water_ml > 0 ? Math.round((o.water_ml / 250) * 100) / 100 : undefined,
    hydration: o.hydration ? HYDRATION[o.hydration] : undefined,
    waterVague: o.water_vague && !o.water_ml && !o.hydration ? true : undefined,
    digestion: o.digestion && o.digestion >= 1 && o.digestion <= 5 ? (o.digestion as DigestionRating) : undefined,
    removals,
    intent: a.intent ?? undefined,
    mealTypeOnly: !meals.length ? (a.meal_type ?? undefined) : undefined,
    timeOnly: !meals.length && !symptoms.length && !stools.length ? pastAt(a.time, a.day_offset, now) : undefined,
    feelingOnly: !meals.length ? (a.feeling ?? undefined) : undefined,
    quantityOnly: !meals.length ? (a.quantity ?? undefined) : undefined,
    number: a.number ?? undefined,
    empty: false,
  };

  if (o.kind === 'ayuno_inicio' || o.kind === 'ayuno_fin') {
    p.fast = { kind: o.kind === 'ayuno_inicio' ? 'start' : 'end', at: pastAt(o.fast_time, 0, now) ?? now };
  }

  const ref = o.saved_ref;
  if (o.kind === 'corregir_guardado' && ref) {
    p.editRequest = { mealType: ref.meal_type ?? undefined, keys: foodsOf(ref.foods).map((f) => f.key), dayOffset: ref.day_offset ?? undefined, last: ref.last || undefined };
  }
  if (o.kind === 'mover_guardado' && ref) {
    const t = pastAt(ref.new_time, ref.new_day_offset, now);
    const foods = foodsOf(ref.foods);
    if (t !== undefined && foods.length) p.moveRef = { keys: foods.map((f) => f.key), names: foods.map((f) => f.name), at: t };
    else if (foods.length) p.editRequest = { keys: foods.map((f) => f.key), last: true };
  }

  p.empty =
    !p.meals.length &&
    !p.symptoms.length &&
    !p.stools.length &&
    !p.water &&
    !p.hydration &&
    !p.waterVague &&
    !p.digestion &&
    !p.removals.length &&
    !p.intent &&
    !p.mealTypeOnly &&
    p.timeOnly === undefined &&
    !p.feelingOnly &&
    !p.quantityOnly &&
    p.number === undefined &&
    !p.fast &&
    !p.editRequest &&
    !p.moveRef;

  const turn: AiTurn = { parse: p };

  if (o.kind === 'consulta' && o.query) {
    const q = o.query;
    const foods = foodsOf(q.foods);
    turn.query = {
      kind: q.kind as QueryKind,
      foods,
      freeText: foods.length ? undefined : q.foods.join(' ') || undefined,
      mealType: q.meal_type ?? undefined,
      symptomTypes: q.symptom_types as SymptomType[],
      range: rangeFrom(q.from_day_offset, q.to_day_offset, now),
    };
  }

  if (o.kind === 'recordatorio' && o.reminder) {
    const r = o.reminder;
    let t = r.in_minutes && r.in_minutes > 0 ? now + r.in_minutes * 60_000 : at(r.time, Math.max(0, r.day_offset), now);
    // "a las 6" ya pasada hoy → mañana (o +12 h si era la tarde)
    if (t !== undefined && t <= now) t = t + 12 * 3600_000 > now && new Date(t).getHours() < 12 && !r.daily ? t + 12 * 3600_000 : t + 24 * 3600_000;
    turn.reminder = { text: r.text.trim() || 'Recordatorio', at: t, daily: r.daily };
  }

  if (o.kind === 'otro' && o.reply.trim()) turn.reply = o.reply.trim();
  return turn;
}
