/**
 * Motor de diálogo del asistente de voz (funciones puras, sin React ni base de datos).
 *
 * Mantiene un borrador de la conversación, decide qué preguntar para completar
 * la ficha (sólo lo necesario), interpreta las respuestas —habladas o tocadas—
 * y produce los registros listos para guardar.
 */
import { formatTime, HOUR } from '@/domain/dates';
import { FEELINGS, bristolInfo, mealTypeLabel, preparationLabel, quantityLabel, suggestMealType, symptomLabel } from '@/domain/labels';
import { catalogFood, deriveFlags, foodKey, prettyName } from '@/domain/foods';
import type { BristolType, DigestionRating, FeelingAfter, HydrationLevel, MealType, Preparation, QuantityLevel } from '@/domain/types';
import { HYDRATION_LEVELS, formatMl, glassesToMl, hydrationLabel } from '@/domain/hydration';
import type { MealInput, StoolInput, SymptomInput } from '@/db/repo';
import { detectQuery, detectReminder, parseFutureTime, type QueryIntent } from './query';
import { bristolIn, intensityIn, isBeverage, normalize, parseTime, parseUtterance, TYPICAL_HOUR, type DraftMeal, type DraftStool, type DraftSymptom, type ParseResult } from './nlu';

// ───────────────────────── Estado ─────────────────────────

export interface SMeal extends DraftMeal {
  id: string;
  /** Alimentos desconocidos que la persona confirmó. */
  accepted: string[];
}
export interface SSymptom extends DraftSymptom {
  id: string;
  endedAt?: number;
}
export interface SStool extends DraftStool {
  id: string;
}

export interface Session {
  meals: SMeal[];
  symptoms: SSymptom[];
  stools: SStool[];
  /** Agua sumada en esta conversación, en vasos de 250 ml (con decimales). */
  water: number;
  /** Estimado del agua del día (a sorbos). */
  hydration?: HydrationLevel;
  /** Mencionó agua sin cantidad: preguntar el estimado. */
  waterAsk?: boolean;
  /** Recordatorio pedido sin hora: se pregunta cuándo. */
  pendingReminder?: { text: string; daily: boolean };
  digestion?: DigestionRating;
  /** Preguntas ya hechas (para no repetir las opcionales). */
  asked: string[];
  pending?: Question;
  last?: { kind: 'meal' | 'symptom' | 'stool'; id: string };
  seq: number;
}

export type Answer =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'skip' }
  | { kind: 'mealType'; value: MealType }
  | { kind: 'time'; value: number }
  | { kind: 'quantity'; value: Exclude<QuantityLevel, 'personalizada'> }
  | { kind: 'feeling'; value: FeelingAfter }
  | { kind: 'intensity'; value: number }
  | { kind: 'bristol'; value: BristolType }
  | { kind: 'hydration'; value: HydrationLevel }
  | { kind: 'save' }
  | { kind: 'cancel' }
  | { kind: 'openMeal'; id: string };

export interface Chip {
  label: string;
  answer: Answer;
}

export type QuestionKind = 'unknown_food' | 'meal_type' | 'meal_time' | 'portions' | 'feeling' | 'intensity' | 'symptom_status' | 'symptom_time' | 'bristol' | 'hydration' | 'reminder_time' | 'choose_meal' | 'confirm';

export interface Question {
  id: string;
  kind: QuestionKind;
  /** Registro al que se refiere. */
  target: string;
  /** Clave del alimento (unknown_food). */
  foodKey?: string;
  text: string;
  chips: Chip[];
}

export interface Reply {
  session: Session;
  /** Texto que se muestra y se lee en voz alta. */
  text: string;
  question?: Question;
  /** true si la persona confirmó guardar. */
  save?: boolean;
  /** true si se canceló todo. */
  cancelled?: boolean;
  /** Acción de ayuno a ejecutar (empezar o terminar). */
  fast?: { kind: 'start' | 'end'; at: number };
  /** Consulta sobre el diario: la pantalla la responde con los datos. */
  query?: QueryIntent;
  /** Recordatorio a crear. */
  reminder?: { at: number; text: string; daily: boolean };
  /** Cambiar la hora de alimentos ya guardados (no estaban en el borrador). */
  moveSaved?: { keys: string[]; names: string[]; at: number };
  /** Abrir una comida guardada (o del borrador) para corregirla. */
  editRequest?: { mealType?: MealType; keys: string[]; dayOffset?: number; last?: boolean; inDraft?: boolean };
  /** Abrir una comida guardada elegida en las opciones. */
  openMealId?: string;
}

export function emptySession(): Session {
  return { meals: [], symptoms: [], stools: [], water: 0, asked: [], seq: 0 };
}

export function isEmpty(s: Session): boolean {
  return !s.meals.length && !s.symptoms.length && !s.stools.length && !s.water && s.hydration === undefined && !s.waterAsk && s.digestion === undefined;
}

const clone = (s: Session): Session => structuredClone(s);
const nextId = (s: Session, p: string) => `${p}${++s.seq}`;

// ───────────────────────── Valores efectivos ─────────────────────────

export function mealTimeOf(m: DraftMeal, now: number): number {
  if (m.timeExplicit && m.at !== undefined) return m.at;
  if (m.mealType && m.mealTypeExplicit && m.mealType !== 'bebida' && suggestMealType(new Date(now)) !== m.mealType) {
    const d = new Date(now);
    const h = TYPICAL_HOUR[m.mealType];
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    let t = d.getTime();
    if (t > now) t -= 24 * HOUR;
    return t;
  }
  return now;
}

export function mealTypeOf(m: DraftMeal, now: number): MealType {
  if (m.mealType) return m.mealType;
  if (m.items.length && m.items.every((i) => isBeverage(i.key))) return 'bebida';
  return suggestMealType(new Date(mealTimeOf(m, now)));
}

function symptomTimeOf(s: SSymptom, session: Session, now: number): number {
  if (s.timeExplicit && s.at !== undefined) return s.at;
  if (s.afterMeal) {
    const ref = [...session.meals].reverse().find((m) => s.afterMeal === 'comida' || mealTypeOf(m, now) === s.afterMeal);
    if (ref) return Math.min(now, mealTimeOf(ref, now) + HOUR);
  }
  return now;
}

const SYMPTOM_ARTICLE: Partial<Record<string, string>> = {
  hinchazon: 'es la',
  gases: 'son los',
  dolor: 'es el',
  acidez: 'es la',
  nauseas: 'son las',
  retortijones: 'son los',
  diarrea: 'es la',
  estrenimiento: 'es el',
  pesadez: 'es la',
  eructos: 'son los',
  vomito: 'es el',
  otro: 'es el',
};

const article = (t: MealType) => (t === 'cena' || t === 'merienda' || t === 'bebida' ? 'la' : 'el');

// ───────────────────────── Resumen ─────────────────────────

function itemText(i: SMeal['items'][number]): string {
  const extra: string[] = [];
  if (i.quantity === 'personalizada' && i.customQuantity) extra.push(i.customQuantity);
  else if (i.quantity !== 'normal') extra.push(quantityLabel(i.quantity).toLowerCase());
  if (i.preparation) extra.push(preparationLabel(i.preparation).toLowerCase());
  return extra.length ? `${i.name.toLowerCase()} (${extra.join(', ')})` : i.name.toLowerCase();
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

export function summaryLines(s: Session, now: number): string[] {
  const lines: string[] = [];
  for (const m of s.meals) {
    const t = mealTypeOf(m, now);
    let line = `${mealTypeLabel(t)} a las ${formatTime(mealTimeOf(m, now))}: ${joinList(m.items.map(itemText))}`;
    if (m.supplements.length) line += `; suplementos: ${m.supplements.join(', ').toLowerCase()}`;
    if (m.feelingAfter) line += `; te sentiste ${FEELINGS.find((f) => f.value === m.feelingAfter)!.label.toLowerCase()}`;
    lines.push(line);
  }
  for (const x of s.symptoms) {
    let line = `${symptomLabel(x.type, x.customName)}${x.intensity !== undefined ? ` ${x.intensity}/10` : ''} desde las ${formatTime(symptomTimeOf(x, s, now))}`;
    if (x.status === 'en_curso') line += ', todavía presente';
    if (x.status === 'termino') line += ', ya pasó';
    lines.push(line);
  }
  for (const st of s.stools) {
    let line = `Deposición${st.bristol ? ` tipo ${st.bristol} de Bristol` : ''} a las ${formatTime(st.at ?? now)}`;
    if (st.blood && st.blood !== 'no') line += ', con sangre';
    if (st.color === 'negro') line += ', heces negras';
    if (st.pain) line += ', con dolor';
    lines.push(line);
  }
  if (s.water) lines.push(`≈ ${formatMl(glassesToMl(s.water))} de agua`);
  if (s.hydration) lines.push(`Agua hoy (estimado): ${hydrationLabel(s.hydration).toLowerCase()}`);
  if (s.digestion) lines.push(`Digestión del día: ${['', 'muy mal', 'mal', 'regular', 'bien', 'muy bien'][s.digestion]}`);
  return lines;
}

// ───────────────────────── Próxima pregunta ─────────────────────────

export function nextQuestion(s: Session, now: number): Question | undefined {
  // 1. Alimentos desconocidos
  for (const m of s.meals) {
    const unk = m.items.find((i) => !i.known && !m.accepted.includes(i.key));
    if (unk) {
      return {
        id: `unk:${m.id}:${unk.key}`,
        kind: 'unknown_food',
        target: m.id,
        foodKey: unk.key,
        text: `No tengo «${unk.name.toLowerCase()}» en mi lista. ¿Lo agrego como alimento?`,
        chips: [
          { label: 'Sí, agrégalo', answer: { kind: 'yes' } },
          { label: 'No, quítalo', answer: { kind: 'no' } },
        ],
      };
    }
  }
  for (const m of s.meals) {
    const t = mealTypeOf(m, now);
    // 2. Tipo de comida
    if (!m.mealTypeExplicit && t !== 'bebida' && !s.asked.includes(`type:${m.id}`)) {
      return {
        id: `type:${m.id}`,
        kind: 'meal_type',
        target: m.id,
        text: `¿Lo registro como ${mealTypeLabel(t).toLowerCase()}?`,
        chips: [
          { label: `Sí, ${mealTypeLabel(t).toLowerCase()}`, answer: { kind: 'mealType', value: t } },
          ...(['desayuno', 'almuerzo', 'cena', 'merienda'] as MealType[]).filter((x) => x !== t).map((x) => ({ label: mealTypeLabel(x), answer: { kind: 'mealType', value: x } as Answer })),
        ],
      };
    }
    // 3. Hora (si el tipo no coincide con la hora actual)
    if (m.mealTypeExplicit && !m.timeExplicit && t !== 'bebida' && suggestMealType(new Date(now)) !== t && !s.asked.includes(`time:${m.id}`)) {
      const def = mealTimeOf(m, now);
      return {
        id: `time:${m.id}`,
        kind: 'meal_time',
        target: m.id,
        text: `¿A qué hora fue ${article(t)} ${mealTypeLabel(t).toLowerCase()}?`,
        chips: [
          { label: formatTime(def), answer: { kind: 'time', value: def } },
          { label: 'Hace 1 hora', answer: { kind: 'time', value: now - HOUR } },
          { label: 'Hace 2 horas', answer: { kind: 'time', value: now - 2 * HOUR } },
          { label: 'Ahora', answer: { kind: 'time', value: now } },
        ],
      };
    }
    // 4. Porciones
    if (t !== 'bebida' && !m.items.some((i) => i.explicitQty) && !s.asked.includes(`qty:${m.id}`)) {
      return {
        id: `qty:${m.id}`,
        kind: 'portions',
        target: m.id,
        text: '¿Las porciones fueron normales?',
        chips: [
          { label: 'Normales', answer: { kind: 'quantity', value: 'normal' } },
          { label: 'Pequeñas', answer: { kind: 'quantity', value: 'poca' } },
          { label: 'Abundantes', answer: { kind: 'quantity', value: 'abundante' } },
          { label: 'Omitir', answer: { kind: 'skip' } },
        ],
      };
    }
    // 5. Sensación al terminar (sólo comidas recientes)
    if (!m.feelingAfter && now - mealTimeOf(m, now) < 4 * HOUR && !s.asked.includes(`feel:${m.id}`)) {
      return {
        id: `feel:${m.id}`,
        kind: 'feeling',
        target: m.id,
        text: '¿Cómo te sentiste al terminar?',
        chips: [...FEELINGS.filter((f) => f.value !== 'satisfecho').map((f) => ({ label: f.label, answer: { kind: 'feeling', value: f.value } as Answer })), { label: 'Omitir', answer: { kind: 'skip' } }],
      };
    }
  }
  // 6–8. Síntomas
  for (const x of s.symptoms) {
    const label = symptomLabel(x.type, x.customName).toLowerCase().split(' / ')[0];
    if (x.intensity === undefined) {
      return {
        id: `int:${x.id}`,
        kind: 'intensity',
        target: x.id,
        text: `¿Qué tan ${x.type === 'gases' || x.type === 'retortijones' || x.type === 'eructos' || x.type === 'nauseas' ? 'fuertes' : 'fuerte'} ${SYMPTOM_ARTICLE[x.type] ?? 'el'} ${label}, de 0 a 10?`,
        chips: [
          { label: 'Leve (3)', answer: { kind: 'intensity', value: 3 } },
          { label: 'Moderado (5)', answer: { kind: 'intensity', value: 5 } },
          { label: 'Fuerte (7)', answer: { kind: 'intensity', value: 7 } },
          { label: 'Muy fuerte (9)', answer: { kind: 'intensity', value: 9 } },
        ],
      };
    }
  }
  const noTime = s.symptoms.filter((x) => !x.timeExplicit && !x.afterMeal);
  if (noTime.length && !s.asked.includes(`stime:${noTime.map((x) => x.id).join(',')}`)) {
    return {
      id: `stime:${noTime.map((x) => x.id).join(',')}`,
      kind: 'symptom_time',
      target: noTime.map((x) => x.id).join(','),
      text: noTime.length > 1 ? '¿Cuándo empezaron?' : '¿Cuándo empezó?',
      chips: [
        { label: 'Ahora', answer: { kind: 'time', value: now } },
        { label: 'Hace 30 min', answer: { kind: 'time', value: now - HOUR / 2 } },
        { label: 'Hace 1 hora', answer: { kind: 'time', value: now - HOUR } },
        { label: 'Hace 2 horas', answer: { kind: 'time', value: now - 2 * HOUR } },
        { label: 'Hace 4 horas', answer: { kind: 'time', value: now - 4 * HOUR } },
      ],
    };
  }
  const unknownStatus = s.symptoms.filter((x) => x.status === 'desconocido' && x.durationMin === undefined);
  if (unknownStatus.length) {
    return {
      id: `status:${unknownStatus.map((x) => x.id).join(',')}`,
      kind: 'symptom_status',
      target: unknownStatus.map((x) => x.id).join(','),
      text: unknownStatus.length > 1 ? '¿Todavía los sientes?' : '¿Todavía lo sientes?',
      chips: [
        { label: 'Sí, todavía', answer: { kind: 'yes' } },
        { label: 'Ya se me pasó', answer: { kind: 'no' } },
      ],
    };
  }
  // 9. Bristol
  for (const st of s.stools) {
    if (!st.bristol) {
      return {
        id: `bristol:${st.id}`,
        kind: 'bristol',
        target: st.id,
        text: '¿Cómo era la deposición? Puedes decir: bolitas duras, dura, normal, blanda, pastosa o líquida.',
        chips: ([1, 2, 3, 4, 5, 6, 7] as BristolType[]).map((b) => ({
          label: `${b} · ${['Bolitas duras', 'Dura grumosa', 'Con grietas', 'Normal, lisa', 'Blanda', 'Pastosa', 'Líquida'][b - 1]}`,
          answer: { kind: 'bristol', value: b } as Answer,
        })),
      };
    }
  }
  // 10. Agua mencionada sin cantidad ("tomé agua a sorbos")
  if (s.waterAsk && s.hydration === undefined && !s.water && !s.asked.includes('hydration')) {
    return {
      id: 'hydration',
      kind: 'hydration',
      target: '',
      text: '¿Cuánta agua has tomado hoy en total, más o menos: poca, normal o bastante?',
      chips: [...HYDRATION_LEVELS.map((h) => ({ label: h.label, answer: { kind: 'hydration', value: h.value } as Answer })), { label: 'Omitir', answer: { kind: 'skip' } }],
    };
  }
  if (isEmpty(s)) return undefined;
  return {
    id: 'confirm',
    kind: 'confirm',
    target: '',
    text: '¿Lo guardo así? También puedes seguir contándome o corregir algo.',
    chips: [
      { label: 'Guardar', answer: { kind: 'save' } },
      { label: 'Cancelar', answer: { kind: 'cancel' } },
    ],
  };
}

// ───────────────────────── Interpretar respuestas ─────────────────────────

function feelingFromText(n: string): FeelingAfter | undefined {
  if (/\b(ligero|liviano|ligera|liviana)\b/.test(n)) return 'ligero';
  if (/\b(pesado|pesada|lleno|llena|llenisimo)\b/.test(n)) return 'pesado';
  if (/\b(muy mal|mal|fatal|horrible|maluco|maluca)\b/.test(n)) return 'mal';
  if (/\b(molesto|molesta|molestia|incomodo|incomoda|regular)\b/.test(n)) return 'molesto';
  if (/\b(satisfecho|satisfecha)\b/.test(n)) return 'satisfecho';
  if (/\b(bien|super|rico|normal)\b/.test(n)) return 'bien';
  return undefined;
}

function hydrationFromText(n: string): HydrationLevel | undefined {
  if (/\b(muy poca|poca|poquita|poco|poquito|casi nada|nada)\b/.test(n)) return 1;
  if (/\b(bastante|mucha|mucho|harta|harto|full|un monton|demasiada)\b/.test(n)) return 3;
  if (/\b(normal|regular|lo normal|como siempre|mas o menos|lo de siempre)\b/.test(n)) return 2;
  return undefined;
}

/** Intenta convertir lo dicho en respuesta a la pregunta pendiente. */
export function interpret(q: Question, raw: string, p: ParseResult, now: number, s: Session): Answer | undefined {
  const n = normalize(raw);
  if (p.intent === 'cancel') return { kind: 'cancel' };
  switch (q.kind) {
    case 'unknown_food':
    case 'symptom_status':
      if (p.intent === 'confirm') return { kind: 'yes' };
      if (p.intent === 'no') return { kind: 'no' };
      if (q.kind === 'symptom_status') {
        if (/\b(ya (se me )?(paso|quito|calmo)|se me (paso|quito)|ya no)\b/.test(n)) return { kind: 'no' };
        if (/\b(todavia|aun|sigue|si)\b/.test(n)) return { kind: 'yes' };
      } else {
        if (/^(si|claro|dale|agregalo|agregala|si agregalo|es un alimento|correcto)\b/.test(n)) return { kind: 'yes' };
        if (/^(no|quitalo|quitala|borralo)\b/.test(n)) return { kind: 'no' };
      }
      return p.intent === 'skip' ? { kind: 'skip' } : undefined;
    case 'meal_type': {
      if (p.mealTypeOnly) return { kind: 'mealType', value: p.mealTypeOnly };
      const m = s.meals.find((x) => x.id === q.target);
      if (p.intent === 'confirm' && m) return { kind: 'mealType', value: mealTypeOf(m, now) };
      if (/\b(bebida|solo bebida|algo de tomar)\b/.test(n)) return { kind: 'mealType', value: 'bebida' };
      if (p.intent === 'skip') return { kind: 'skip' };
      return undefined;
    }
    case 'meal_time':
    case 'symptom_time': {
      const m = q.kind === 'meal_time' ? s.meals.find((x) => x.id === q.target) : undefined;
      const t = parseTime(n, now, m ? mealTypeOf(m, now) : undefined);
      if (t !== undefined) return { kind: 'time', value: t };
      if (p.intent === 'confirm' && m) return { kind: 'time', value: mealTimeOf(m, now) };
      if (p.intent === 'skip') return { kind: 'skip' };
      if (p.number !== undefined && p.number <= 23) {
        const tt = parseTime(`a las ${p.number}`, now, m ? mealTypeOf(m, now) : undefined);
        if (tt !== undefined) return { kind: 'time', value: tt };
      }
      return undefined;
    }
    case 'portions':
      if (p.quantityOnly) return { kind: 'quantity', value: p.quantityOnly };
      if (p.intent === 'confirm') return { kind: 'quantity', value: 'normal' };
      if (p.intent === 'skip' || p.intent === 'no') return { kind: 'skip' };
      return undefined;
    case 'feeling': {
      if (p.intent === 'skip' || p.intent === 'no') return { kind: 'skip' };
      const f = p.feelingOnly ?? feelingFromText(n);
      return f ? { kind: 'feeling', value: f } : undefined;
    }
    case 'intensity': {
      if (p.number !== undefined && p.number <= 10) return { kind: 'intensity', value: p.number };
      const i = intensityIn(n);
      if (i !== undefined) return { kind: 'intensity', value: i };
      if (p.intent === 'skip') return { kind: 'skip' };
      return undefined;
    }
    case 'bristol': {
      if (p.number !== undefined && p.number >= 1 && p.number <= 7) return { kind: 'bristol', value: p.number as BristolType };
      const b = bristolIn(n);
      return b ? { kind: 'bristol', value: b } : undefined;
    }
    case 'choose_meal':
      return undefined;
    case 'reminder_time': {
      const t = parseFutureTime(n, now);
      return t ? { kind: 'time', value: t } : p.intent === 'no' || p.intent === 'skip' ? { kind: 'cancel' } : undefined;
    }
    case 'hydration': {
      if (p.intent === 'skip' || p.intent === 'no') return { kind: 'skip' };
      const h = p.hydration ?? hydrationFromText(n);
      return h ? { kind: 'hydration', value: h } : undefined;
    }
    case 'confirm':
      if (p.intent === 'confirm') return { kind: 'save' };
      if (p.intent === 'no') return { kind: 'no' };
      return undefined;
  }
}

/** Aplica una respuesta a la pregunta pendiente. Devuelve false si no aplica. */
export function applyAnswer(s: Session, q: Question, a: Answer, now: number): boolean {
  if (a.kind === 'cancel') return true;
  const mark = () => s.asked.includes(q.id) || s.asked.push(q.id);
  const meal = s.meals.find((m) => m.id === q.target);
  const syms = s.symptoms.filter((x) => q.target.split(',').includes(x.id));
  switch (q.kind) {
    case 'unknown_food':
      if (!meal || !q.foodKey) return false;
      if (a.kind === 'yes' || a.kind === 'skip') meal.accepted.push(q.foodKey);
      else if (a.kind === 'no') {
        meal.items = meal.items.filter((i) => i.key !== q.foodKey);
        if (!meal.items.length && !meal.supplements.length) s.meals = s.meals.filter((m) => m !== meal);
      } else return false;
      return true;
    case 'meal_type':
      if (!meal) return false;
      if (a.kind === 'mealType') {
        meal.mealType = a.value;
        meal.mealTypeExplicit = true;
        // Ya respondió el tipo; si hace falta, se preguntará la hora.
      } else if (a.kind !== 'skip') return false;
      mark();
      return true;
    case 'meal_time':
      if (!meal) return false;
      if (a.kind === 'time') {
        meal.at = a.value;
        meal.timeExplicit = true;
      } else if (a.kind !== 'skip') return false;
      mark();
      return true;
    case 'portions':
      if (!meal) return false;
      if (a.kind === 'quantity') {
        for (const i of meal.items) if (!i.explicitQty) i.quantity = a.value;
      } else if (a.kind !== 'skip') return false;
      mark();
      return true;
    case 'feeling':
      if (!meal) return false;
      if (a.kind === 'feeling') meal.feelingAfter = a.value;
      else if (a.kind !== 'skip') return false;
      mark();
      return true;
    case 'intensity':
      if (a.kind === 'intensity') {
        for (const x of syms) x.intensity = Math.max(0, Math.min(10, Math.round(a.value)));
      } else if (a.kind === 'skip') {
        for (const x of syms) x.intensity = 4;
      } else return false;
      return true;
    case 'symptom_time':
      if (a.kind === 'time') {
        for (const x of syms) {
          x.at = a.value;
          x.timeExplicit = true;
        }
      } else if (a.kind !== 'skip') return false;
      mark();
      return true;
    case 'symptom_status':
      if (a.kind === 'yes' || a.kind === 'skip') {
        for (const x of syms) x.status = 'en_curso';
      } else if (a.kind === 'no') {
        for (const x of syms) {
          x.status = 'termino';
          x.endedAt = now;
        }
      } else return false;
      return true;
    case 'bristol': {
      const st = s.stools.find((x) => x.id === q.target);
      if (!st || a.kind !== 'bristol') return false;
      st.bristol = a.value;
      return true;
    }
    case 'choose_meal':
      return false;
    case 'reminder_time':
      return a.kind === 'time';
    case 'hydration':
      if (a.kind === 'hydration') s.hydration = a.value;
      else if (a.kind !== 'skip') return false;
      mark();
      return true;
    case 'confirm':
      return a.kind === 'save' || a.kind === 'no';
  }
}

// ───────────────────────── Fusionar contenido nuevo ─────────────────────────

/** Integra lo dicho al borrador. Devuelve una frase corta de lo que se anotó o cambió. */
export function merge(s: Session, p: ParseResult, now: number, raw?: string): string[] {
  const notes: string[] = [];
  for (const k of p.removals) {
    let removed = false;
    for (const m of s.meals) {
      const before = m.items.length;
      m.items = m.items.filter((i) => i.key !== k && !i.key.startsWith(`${k} `));
      if (m.items.length !== before) removed = true;
    }
    s.meals = s.meals.filter((m) => m.items.length || m.supplements.length);
    notes.push(removed ? `Quité ${k}.` : `No encontré «${k}» en lo que llevamos.`);
  }
  if (p.replaceLast && p.meals.length) {
    const target = s.meals[s.meals.length - 1];
    const lastItem = target?.items[target.items.length - 1];
    const incoming = p.meals[0].items[0];
    const head = (x: string) => foodKey(x).split(' ')[0];
    const ing = lastItem?.ingredients?.[lastItem.ingredients.length - 1];
    if (lastItem && ing && incoming && head(ing) === head(incoming.name) && head(lastItem.name) !== head(incoming.name)) {
      // "arepa con queso campesino" + "perdón, era queso cheddar" → cambia el queso de la arepa
      lastItem.ingredients = [...lastItem.ingredients!.slice(0, -1), incoming.name];
      p = { ...p, meals: [{ ...p.meals[0], items: p.meals[0].items.slice(1) }, ...p.meals.slice(1)].filter((m) => m.items.length || m.supplements.length) };
      notes.push(`Cambié ${ing.toLowerCase()} por ${incoming.name.toLowerCase()} en ${lastItem.name.toLowerCase()}.`);
    } else {
      const gone = target?.items.pop();
      if (gone) notes.push(`Cambié ${gone.name.toLowerCase()}.`);
    }
  }
  for (const dm of p.meals) {
    const last = s.meals[s.meals.length - 1];
    if (last && !dm.mealTypeExplicit && !dm.timeExplicit) {
      for (const it of dm.items) if (!last.items.some((x) => x.key === it.key)) last.items.push(it);
      for (const sup of dm.supplements) if (!last.supplements.includes(sup)) last.supplements.push(sup);
      if (dm.feelingAfter) last.feelingAfter = dm.feelingAfter;
      s.last = { kind: 'meal', id: last.id };
      notes.push(`Agregué ${joinList(dm.items.map(itemText).concat(dm.supplements.map((x) => x.toLowerCase())))}.`);
    } else {
      const m: SMeal = { ...dm, id: nextId(s, 'm'), accepted: [] };
      s.meals.push(m);
      s.last = { kind: 'meal', id: m.id };
      const t = mealTypeOf(m, now);
      notes.push(`Anoté ${m.mealTypeExplicit || t === 'bebida' ? `${t === 'bebida' ? 'una bebida' : `${article(t)} ${mealTypeLabel(t).toLowerCase()}`}` : 'una comida'}${m.items.length ? ` con ${joinList(m.items.map(itemText))}` : ''}.`);
    }
  }
  for (const ds of p.symptoms) {
    const same = s.symptoms.find((x) => x.type === ds.type && x.customName === ds.customName);
    if (same) {
      if (ds.intensity !== undefined) same.intensity = ds.intensity;
      if (ds.timeExplicit) {
        same.at = ds.at;
        same.timeExplicit = true;
      }
      if (ds.status !== 'desconocido') same.status = ds.status;
      same.location ??= ds.location;
      s.last = { kind: 'symptom', id: same.id };
      continue;
    }
    const x: SSymptom = { ...ds, id: nextId(s, 's') };
    if (x.status === 'termino' && x.durationMin === undefined) x.endedAt = now;
    s.symptoms.push(x);
    s.last = { kind: 'symptom', id: x.id };
  }
  if (p.symptoms.length) notes.push(`Anoté ${joinList(p.symptoms.map((x) => symptomLabel(x.type, x.customName).toLowerCase().split(' / ')[0]))}.`);
  for (const dst of p.stools) {
    const st: SStool = { ...dst, id: nextId(s, 'b') };
    s.stools.push(st);
    s.last = { kind: 'stool', id: st.id };
    notes.push(`Anoté una deposición${st.bristol ? ` tipo ${st.bristol} (${bristolInfo(st.bristol).description.split('.')[0].toLowerCase()})` : ''}.`);
  }
  if (p.water) {
    s.water = Math.round((s.water + p.water) * 100) / 100;
    notes.push(`Sumé ≈ ${formatMl(glassesToMl(p.water))} de agua.`);
  }
  if (p.hydration) {
    s.hydration = p.hydration;
    notes.push(`Anoté que hoy tomaste ${hydrationLabel(p.hydration).toLowerCase()} agua.`.replace('normal agua', 'agua normal'));
  } else if (p.waterVague && !p.water) {
    s.waterAsk = true;
  }
  if (p.digestion) {
    s.digestion = p.digestion;
    notes.push('Anoté cómo estuvo tu digestión hoy.');
  }
  // Correcciones sueltas sobre el último registro
  const lastMeal = s.last?.kind === 'meal' ? s.meals.find((m) => m.id === s.last!.id) : s.meals[s.meals.length - 1];
  if (!p.meals.length && !p.symptoms.length && !p.stools.length) {
    if (p.mealTypeOnly && lastMeal) {
      lastMeal.mealType = p.mealTypeOnly;
      lastMeal.mealTypeExplicit = true;
      notes.push(`Cambié a ${mealTypeLabel(p.mealTypeOnly).toLowerCase()}.`);
    }
    if (p.timeOnly !== undefined) {
      if (s.last?.kind === 'symptom') {
        const x = s.symptoms.find((y) => y.id === s.last!.id);
        if (x) {
          x.at = p.timeOnly;
          x.timeExplicit = true;
        }
      } else if (s.last?.kind === 'stool') {
        const x = s.stools.find((y) => y.id === s.last!.id);
        if (x) {
          x.at = p.timeOnly;
          x.timeExplicit = true;
        }
      } else if (lastMeal) {
        // Reinterpretar con el tipo de comida ("a las 8" en la cena = 8 p. m.)
        lastMeal.at = (raw ? parseTime(normalize(raw), now, mealTypeOf(lastMeal, now)) : undefined) ?? p.timeOnly;
        lastMeal.timeExplicit = true;
      }
      const shown = s.last?.kind === 'meal' || !s.last ? lastMeal?.at ?? p.timeOnly : p.timeOnly;
      notes.push(`Cambié la hora a las ${formatTime(shown)}`);
    }
    if (p.feelingOnly && lastMeal) {
      lastMeal.feelingAfter = p.feelingOnly;
      notes.push('Anoté cómo te sentiste.');
    }
    if (p.quantityOnly && lastMeal) {
      for (const i of lastMeal.items) if (!i.explicitQty) i.quantity = p.quantityOnly;
      notes.push(`Marqué las porciones como ${quantityLabel(p.quantityOnly).toLowerCase()}.`);
    }
  }
  return notes;
}

// ───────────────────────── Turno de conversación ─────────────────────────

export interface TurnContext {
  now: number;
  bottleMl?: number;
  extraFoods?: { name: string; key: string }[];
}

/** Procesa lo que la persona dijo o escribió. */
/**
 * Mueve alimentos del borrador a otra hora. Si eran toda la comida, cambia su
 * hora; si no, los separa en una comida nueva. Devuelve los nombres movidos.
 */
export function moveInDraft(s: Session, ref: { keys: string[]; at: number }, now: number): string | undefined {
  const names: string[] = [];
  for (const m of [...s.meals]) {
    const idx = m.items.map((it, i) => (ref.keys.includes(it.key) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const moving = idx.map((i) => m.items[i]);
    names.push(...moving.map((x) => x.name.toLowerCase()));
    if (moving.length === m.items.length) {
      m.at = ref.at;
      m.timeExplicit = true;
      if (!m.mealTypeExplicit || mealTypeOf(m, now) !== suggestMealType(new Date(ref.at))) {
        m.mealType = moving.every((x) => isBeverage(x.key)) ? 'bebida' : suggestMealType(new Date(ref.at));
        m.mealTypeExplicit = true;
      }
    } else {
      m.items = m.items.filter((_, i) => !idx.includes(i));
      const nm: SMeal = {
        id: nextId(s, 'm'),
        items: moving,
        supplements: [],
        accepted: [...m.accepted],
        at: ref.at,
        timeExplicit: true,
        mealType: moving.every((x) => isBeverage(x.key)) ? 'bebida' : suggestMealType(new Date(ref.at)),
        mealTypeExplicit: true,
      };
      s.meals.push(nm);
      s.last = { kind: 'meal', id: nm.id };
    }
  }
  return names.length ? joinList([...new Set(names)]) : undefined;
}

/** Anota como comida nueva alimentos mencionados con hora (cuando no estaban registrados). */
export function addRefMeal(prev: Session, ref: { keys: string[]; names: string[]; at: number }, now: number): Reply {
  const s = clone(prev);
  const items = ref.keys.map((key, i) => ({ name: ref.names[i], key, quantity: 'normal' as QuantityLevel, known: true, explicitQty: false, ingredients: catalogFood(key)?.ingredients ? [...catalogFood(key)!.ingredients!] : undefined }));
  const m: SMeal = { id: nextId(s, 'm'), items, supplements: [], accepted: [], at: ref.at, timeExplicit: true, mealType: items.every((x) => isBeverage(x.key)) ? 'bebida' : suggestMealType(new Date(ref.at)), mealTypeExplicit: true };
  s.meals.push(m);
  s.last = { kind: 'meal', id: m.id };
  s.pending = nextQuestion(s, now);
  const q = s.pending;
  const extra = q?.kind === 'confirm' ? ` Esto es lo que tengo: ${summaryLines(s, now).join('. ')}. ${q.text}` : q ? ` ${q.text}` : '';
  return { session: s, text: `No lo encontré entre lo registrado, así que anoté ${joinList(ref.names.map((x) => x.toLowerCase()))} a las ${formatTime(ref.at)}.${extra}`.replace(/\.\.(?=\s|$)/g, '.'), question: q };
}

function reminderQuestion(now: number): Question {
  const at = (h: number, dayOffset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  const tonight = at(20, 0) > now + 30 * 60_000 ? at(20, 0) : undefined;
  return {
    id: 'reminder_time',
    kind: 'reminder_time',
    target: '',
    text: '¿Cuándo te lo recuerdo? Por ejemplo: «en 2 horas», «a las 6» o «mañana a las 8».',
    chips: [
      { label: 'En 30 min', answer: { kind: 'time', value: now + 30 * 60_000 } },
      { label: 'En 1 hora', answer: { kind: 'time', value: now + 3600_000 } },
      ...(tonight ? [{ label: 'Esta noche 8:00 p. m.', answer: { kind: 'time', value: tonight } as Answer }] : []),
      { label: 'Mañana 8:00 a. m.', answer: { kind: 'time', value: at(8, 1) } },
      { label: 'Cancelar', answer: { kind: 'cancel' } },
    ],
  };
}

/** Respuesta a la hora de un recordatorio pendiente (voz o toque). */
function finishReminder(s: Session, a: Answer, now: number): Reply {
  const pr = s.pendingReminder!;
  s.pendingReminder = undefined;
  s.pending = nextQuestion(s, now);
  if (a.kind !== 'time') return { session: s, text: 'Listo, no programé el recordatorio.', question: s.pending };
  return { session: s, text: '', question: s.pending, reminder: { at: a.value, text: pr.text, daily: pr.daily } };
}

export function handleUtterance(prev: Session, raw: string, ctx: TurnContext): Reply {
  const s = clone(prev);

  // Hora de un recordatorio pedido antes
  if (s.pending?.kind === 'reminder_time' && s.pendingReminder) {
    const t = parseFutureTime(normalize(raw), ctx.now);
    const p0 = parseUtterance(raw, { now: ctx.now });
    if (t) return finishReminder(s, { kind: 'time', value: t }, ctx.now);
    if (p0.intent === 'no' || p0.intent === 'cancel' || p0.intent === 'skip') return finishReminder(s, { kind: 'cancel' }, ctx.now);
  }

  // ¿Es una consulta sobre el diario? ("recuérdame si ayer comí salchipapa")
  const query = detectQuery(raw, ctx.now, ctx.extraFoods);
  if (query) return { session: s, text: '', query, question: s.pending };

  // ¿Es un recordatorio? ("recuérdame en 2 horas tomar la creatina")
  const rem = detectReminder(raw, ctx.now);
  if (rem) {
    if (rem.at) return { session: s, text: '', question: s.pending, reminder: { at: rem.at, text: rem.text, daily: rem.daily } };
    s.pendingReminder = { text: rem.text, daily: rem.daily };
    s.pending = reminderQuestion(ctx.now);
    return { session: s, text: `Te recuerdo «${rem.text.toLowerCase()}». ${s.pending.text}`, question: s.pending };
  }

  const p = parseUtterance(raw, { now: ctx.now, extraFoods: ctx.extraFoods, bottleMl: ctx.bottleMl });
  if (p.intent === 'cancel') return { session: emptySession(), text: 'Listo, descarté todo. Cuéntame de nuevo cuando quieras.', cancelled: true };

  if (p.editRequest) {
    // ¿Está en el borrador? Entonces se corrige ahí mismo.
    const er = p.editRequest;
    const inDraft = s.meals.some((m) => (er.mealType ? mealTypeOf(m, ctx.now) === er.mealType : true) && (!er.keys.length || m.items.some((i) => er.keys.includes(i.key))));
    return { session: s, text: '', question: s.pending, editRequest: { ...er, inDraft } };
  }

  if (p.moveRef) {
    const moved = moveInDraft(s, p.moveRef, ctx.now);
    if (moved) {
      s.pending = nextQuestion(s, ctx.now);
      const q = s.pending;
      const extra = q?.kind === 'confirm' ? ` Esto es lo que tengo: ${summaryLines(s, ctx.now).join('. ')}. ${q.text}` : q ? ` ${q.text}` : '';
      return { session: s, text: `Listo, pasé ${moved} a las ${formatTime(p.moveRef.at)}.${extra}`.replace(/\.\.(?=\s|$)/g, '.'), question: q };
    }
    return { session: s, text: '', question: s.pending, moveSaved: p.moveRef };
  }

  if (p.fast) {
    // La acción de ayuno la ejecuta la pantalla; si además mencionó comida, se integra al borrador.
    const notes = p.meals.length || p.symptoms.length || p.stools.length ? merge(s, { ...p, fast: undefined }, ctx.now, raw) : [];
    const next = notes.length ? nextQuestion(s, ctx.now) : s.pending;
    s.pending = next;
    return { session: s, text: notes.join(' '), question: next, fast: p.fast };
  }

  // "Guárdalo" guarda de inmediato (sólo se completan las preguntas obligatorias)
  if (p.intent === 'confirm' && /\bguard/.test(normalize(raw)) && !isEmpty(s)) return finishSave(s, ctx.now);

  const q = s.pending;
  let ack: string[] = [];
  if (q) {
    // Si la frase trae contenido nuevo (alimentos, síntomas…), se integra; si no, se usa como respuesta.
    const hasContent = p.meals.length || p.symptoms.length || p.stools.length || p.removals.length || p.water || p.digestion || (p.hydration && q.kind !== 'hydration') || p.waterVague;
    const a = !hasContent || q.kind === 'confirm' ? interpret(q, raw, p, ctx.now, s) : undefined;
    if (a?.kind === 'save') return finishSave(s, ctx.now);
    if (a && a.kind === 'no' && q.kind === 'confirm') {
      s.pending = undefined;
      return { session: s, text: 'De acuerdo. Dime qué quieres cambiar o agregar, por ejemplo: «quita el pan» o «fue a las 8».' };
    }
    if (a && applyAnswer(s, q, a, ctx.now)) {
      ack = [];
    } else if (hasContent || !p.empty) {
      ack = merge(s, p, ctx.now, raw);
    } else {
      return { session: s, text: `Perdona, no te entendí. ${q.text}`, question: q };
    }
  } else {
    if (p.intent === 'confirm' && !isEmpty(s)) return finishSave(s, ctx.now);
    if (p.empty || p.intent) {
      if (isEmpty(s)) return { session: s, text: 'Cuéntame qué comiste o bebiste, cómo te sientes o si fuiste al baño. Por ejemplo: «almorcé arroz con pollo y una limonada».' };
      return { session: s, text: 'No te entendí bien. Puedes contarme otra comida, un síntoma o decir «guardar».', question: nextQuestion(s, ctx.now) };
    }
    ack = merge(s, p, ctx.now, raw);
  }
  const next = nextQuestion(s, ctx.now);
  s.pending = next;
  let text = ack.join(' ');
  if (next?.kind === 'confirm') text = `${text ? `${text} ` : ''}Esto es lo que tengo: ${summaryLines(s, ctx.now).join('. ')}. ${next.text}`;
  else if (next) text = `${text ? `${text} ` : ''}${next.text}`;
  return { session: s, text: text.trim(), question: next };
}

/** Procesa un toque en una opción rápida. */
export function handleChip(prev: Session, chip: Chip, now: number): Reply {
  const s = clone(prev);
  const q = s.pending;
  if (q?.kind === 'reminder_time' && s.pendingReminder) return finishReminder(s, chip.answer, now);
  if (chip.answer.kind === 'openMeal') return { session: s, text: '', question: s.pending, openMealId: chip.answer.id };
  if (chip.answer.kind === 'cancel') return { session: emptySession(), text: 'Listo, descarté todo.', cancelled: true };
  if (chip.answer.kind === 'save') return finishSave(s, now);
  if (q) applyAnswer(s, q, chip.answer, now);
  const next = nextQuestion(s, now);
  s.pending = next;
  const text = next?.kind === 'confirm' ? `Esto es lo que tengo: ${summaryLines(s, now).join('. ')}. ${next.text}` : next?.text ?? '';
  return { session: s, text, question: next };
}

function finishSave(s: Session, now: number): Reply {
  // Antes de guardar, completar lo obligatorio que falte
  const pendingRequired = nextQuestion(s, now);
  if (pendingRequired && (pendingRequired.kind === 'unknown_food' || pendingRequired.kind === 'bristol')) {
    s.pending = pendingRequired;
    return { session: s, text: `Antes de guardar: ${pendingRequired.text}`, question: pendingRequired };
  }
  s.pending = undefined;
  return { session: s, text: 'Guardando…', save: true };
}

// ───────────────────────── Registros finales ─────────────────────────

export interface Records {
  meals: MealInput[];
  symptoms: SymptomInput[];
  stools: StoolInput[];
  water: number;
  hydration?: HydrationLevel;
  digestion?: DigestionRating;
}

export function toRecords(s: Session, now: number): Records {
  const meals: MealInput[] = s.meals.map((m) => {
    const items: MealInput['items'] = m.items.length
      ? m.items.map(({ name, key, quantity, customQuantity, preparation, ingredients }) => ({ name, key, quantity, customQuantity, preparation, ingredients }))
      : [{ name: 'Agua', key: 'agua', quantity: 'normal' }];
    const keys = items.flatMap((i) => [i.key, ...(i.ingredients ?? []).map(foodKey)]);
    return {
      at: mealTimeOf(m, now),
      mealType: m.items.length ? mealTypeOf(m, now) : 'bebida',
      items,
      flags: deriveFlags(keys),
      supplements: m.supplements,
      feelingAfter: m.feelingAfter,
      notes: 'Registrado por voz',
    };
  });
  const symptoms: SymptomInput[] = s.symptoms.map((x) => {
    const startedAt = symptomTimeOf(x, s, now);
    return {
      type: x.type,
      customName: x.customName,
      intensity: x.intensity ?? 4,
      startedAt,
      endedAt: x.status === 'termino' && x.durationMin === undefined ? Math.max(startedAt, x.endedAt ?? now) : undefined,
      durationMin: x.durationMin,
      location: x.location,
    };
  });
  const stools: StoolInput[] = s.stools.map((st) => ({
    at: st.at ?? now,
    bristol: st.bristol ?? 4,
    color: st.color ?? 'marron',
    amount: 'normal',
    urgency: st.urgency ?? 0,
    effort: st.effort ?? 0,
    pain: { before: false, during: !!st.pain, after: false },
    painIntensity: st.pain ? st.painIntensity ?? 3 : undefined,
    incomplete: !!st.incomplete,
    mucus: !!st.mucus,
    blood: st.blood ?? 'no',
    notes: 'Registrado por voz',
  }));
  return { meals, symptoms, stools, water: s.water, hydration: s.hydration, digestion: s.digestion };
}

// ───────────────────────── Edición manual del borrador ─────────────────────────

export type DraftEdit =
  | { kind: 'item'; mealId: string; index: number; patch: { name?: string; quantity?: QuantityLevel; customQuantity?: string; preparation?: Preparation | null } }
  | { kind: 'removeItem'; mealId: string; index: number }
  | { kind: 'removeIngredient'; mealId: string; index: number; ingredient: string }
  | { kind: 'addItem'; mealId: string; name: string }
  | { kind: 'meal'; mealId: string; patch: { mealType?: MealType; at?: number } }
  | { kind: 'removeMeal'; mealId: string }
  | { kind: 'symptom'; id: string; intensity: number }
  | { kind: 'removeSymptom'; id: string }
  | { kind: 'stool'; id: string; bristol: BristolType }
  | { kind: 'removeStool'; id: string }
  | { kind: 'water'; value: number; hydration?: HydrationLevel | null };

/** Aplica una corrección hecha a mano en la ficha en borrador. Devuelve una sesión nueva. */
export function editDraft(prev: Session, e: DraftEdit, now: number): Session {
  const s = clone(prev);
  const meal = 'mealId' in e ? s.meals.find((m) => m.id === e.mealId) : undefined;
  switch (e.kind) {
    case 'item': {
      const it = meal?.items[e.index];
      if (!it || !meal) break;
      if (e.patch.name !== undefined && e.patch.name.trim()) {
        const name = prettyName(e.patch.name);
        const key = foodKey(name);
        const cat = catalogFood(key);
        it.name = cat?.name ?? name;
        it.key = cat ? foodKey(cat.name) : key;
        it.known = true;
        if (!meal.accepted.includes(it.key)) meal.accepted.push(it.key);
        if (cat?.ingredients && !it.ingredients?.length) it.ingredients = [...cat.ingredients];
      }
      if (e.patch.quantity) {
        it.quantity = e.patch.quantity;
        it.explicitQty = true;
        if (e.patch.quantity !== 'personalizada') it.customQuantity = undefined;
      }
      if (e.patch.customQuantity !== undefined) it.customQuantity = e.patch.customQuantity.trim() || undefined;
      if (e.patch.preparation !== undefined) it.preparation = e.patch.preparation ?? undefined;
      break;
    }
    case 'removeItem':
      if (meal) {
        meal.items.splice(e.index, 1);
        if (!meal.items.length && !meal.supplements.length) s.meals = s.meals.filter((m) => m !== meal);
      }
      break;
    case 'removeIngredient': {
      const it = meal?.items[e.index];
      if (it?.ingredients) it.ingredients = it.ingredients.filter((x) => x !== e.ingredient);
      break;
    }
    case 'addItem': {
      const name = prettyName(e.name);
      if (!meal || !name) break;
      const key = foodKey(name);
      const cat = catalogFood(key);
      const k = cat ? foodKey(cat.name) : key;
      if (!meal.items.some((i) => i.key === k)) {
        meal.items.push({ name: cat?.name ?? name, key: k, quantity: 'normal', known: true, explicitQty: false, ingredients: cat?.ingredients ? [...cat.ingredients] : undefined });
        meal.accepted.push(k);
      }
      break;
    }
    case 'meal':
      if (!meal) break;
      if (e.patch.mealType) {
        meal.mealType = e.patch.mealType;
        meal.mealTypeExplicit = true;
      }
      if (e.patch.at !== undefined) {
        meal.at = e.patch.at;
        meal.timeExplicit = true;
      }
      break;
    case 'removeMeal':
      s.meals = s.meals.filter((m) => m.id !== e.mealId);
      break;
    case 'symptom': {
      const x = s.symptoms.find((y) => y.id === e.id);
      if (x) x.intensity = Math.max(0, Math.min(10, Math.round(e.intensity)));
      break;
    }
    case 'removeSymptom':
      s.symptoms = s.symptoms.filter((y) => y.id !== e.id);
      break;
    case 'stool': {
      const x = s.stools.find((y) => y.id === e.id);
      if (x) x.bristol = e.bristol;
      break;
    }
    case 'removeStool':
      s.stools = s.stools.filter((y) => y.id !== e.id);
      break;
    case 'water':
      s.water = Math.max(0, e.value);
      if (e.hydration !== undefined) s.hydration = e.hydration ?? undefined;
      break;
  }
  // La pregunta pendiente puede haber dejado de aplicar (p. ej. se corrigió el alimento desconocido)
  if (s.pending?.kind !== 'reminder_time') s.pending = nextQuestion(s, now);
  return s;
}
