/**
 * Consultas y recordatorios por voz.
 *
 * Distingue tres tipos de frase:
 *  - Registrar:   "almorcé arroz con pollo"                 → lo hace nlu/dialog.
 *  - Consultar:   "recuérdame si ayer comí salchipapa",
 *                 "¿qué almorcé el lunes?", "¿cuándo fue la última vez que comí leche?",
 *                 "¿cuántas veces fui al baño esta semana?"  → se responde con tu diario.
 *  - Recordatorio: "recuérdame en 2 horas tomar la creatina",
 *                 "recuérdame mañana a las 8 registrar el desayuno" → aviso programado.
 *
 * Todo es local: se consulta la base del teléfono, sin servicios externos.
 */
import { addDays, dayKey, dayStart, DAY, formatLongDate, formatTime, HOUR, weekStart } from '@/domain/dates';
import { foodKey } from '@/domain/foods';
import { DIGESTION, bristolInfo, mealTypeLabel, preparationLabel, quantityLabel, symptomLabel } from '@/domain/labels';
import { hydrationSummary } from '@/domain/hydration';
import type { DailyLog, Fast, Meal, MealType, Stool, Symptom, SymptomType } from '@/domain/types';
import { detectMealType, matchFoods, matchSymptomTypes, normalize } from './nlu';

// ───────────────────────── Rangos de fechas ─────────────────────────

export interface Range {
  from: number;
  to: number;
  /** Frase para la respuesta: "ayer", "esta semana", "el lunes 10 de noviembre". */
  label: string;
  /** true si es un solo día. */
  single: boolean;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function dayRange(key: string, now: number, label?: string): Range {
  return { from: dayStart(key), to: Math.min(dayStart(addDays(key, 1)), now + 1), label: label ?? dayPhrase(dayStart(key), now), single: true };
}

/** "hoy", "ayer", "antier" o "el lunes 10 de noviembre". */
export function dayPhrase(t: number, now: number): string {
  const k = dayKey(t);
  const today = dayKey(now);
  if (k === today) return 'hoy';
  if (k === addDays(today, -1)) return 'ayer';
  if (k === addDays(today, -2)) return 'antier';
  return `el ${formatLongDate(t).replace(',', '')}`;
}

/** Rango mencionado en la frase (normalizada), o undefined. */
export function parseRange(n: string, now: number): Range | undefined {
  const today = dayKey(now);
  if (/\b(antier|anteayer)\b/.test(n)) return dayRange(addDays(today, -2), now);
  if (/\b(ayer|anoche)\b/.test(n)) return dayRange(addDays(today, -1), now);
  if (/\b(hoy|esta manana|esta tarde|esta noche)\b/.test(n)) return dayRange(today, now);
  const ago = n.match(/\bhace (\d+) dias\b/);
  if (ago) return dayRange(addDays(today, -Number(ago[1])), now);
  const last = n.match(/\b(?:los )?ultimos (\d+) dias\b/);
  if (last) return { from: dayStart(addDays(today, -(Number(last[1]) - 1))), to: now + 1, label: `en los últimos ${last[1]} días`, single: false };
  if (/\b(la semana pasada|semana anterior)\b/.test(n)) {
    const ws = addDays(weekStart(today), -7);
    return { from: dayStart(ws), to: dayStart(addDays(ws, 7)), label: 'la semana pasada', single: false };
  }
  if (/\b(esta semana|en la semana)\b/.test(n)) return { from: dayStart(weekStart(today)), to: now + 1, label: 'esta semana', single: false };
  if (/\b(el mes pasado|mes anterior)\b/.test(n)) {
    const d = new Date(now);
    const from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return { from, to, label: 'el mes pasado', single: false };
  }
  if (/\b(este mes|en el mes)\b/.test(n)) {
    const d = new Date(now);
    return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now + 1, label: 'este mes', single: false };
  }
  const wd = n.match(/\b(?:el |este |el pasado )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)( pasado)?\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    const dow = new Date(now).getDay();
    let back = (dow - target + 7) % 7;
    if (back === 0 && wd[2]) back = 7;
    return dayRange(addDays(today, -back), now);
  }
  const date = n.match(/\bel (\d{1,2})(?: de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))?\b/);
  if (date) {
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const d = new Date(now);
    const month = date[2] ? months.indexOf(date[2]) : d.getMonth();
    let t = new Date(d.getFullYear(), month, Number(date[1]), 12).getTime();
    if (t > now) t = new Date(d.getFullYear() - (date[2] ? 1 : 0), month - (date[2] ? 0 : 1), Number(date[1]), 12).getTime();
    return dayRange(dayKey(t), now);
  }
  return undefined;
}

// ───────────────────────── Consultas ─────────────────────────

export type QueryKind = 'ate' | 'last_time' | 'count_food' | 'what_ate' | 'symptoms' | 'stools' | 'digestion' | 'water' | 'fasts';

export interface QueryIntent {
  kind: QueryKind;
  foods: { name: string; key: string }[];
  /** Palabras de alimento no reconocidas (se buscan como texto). */
  freeText?: string;
  mealType?: MealType;
  symptomTypes: SymptomType[];
  range?: Range;
}

/** Inicios que indican pregunta sin necesidad de signo de interrogación. */
const QUERY_START =
  /^(dime|dimelo|muestrame|mostrame|ensename|sabes|quiero saber|consulta|busca|revisa|me (puedes|podrias) decir|me dices|me recuerdas|recuerdame|recordame|acuerdame|ayudame a recordar|no recuerdo|no me acuerdo|cuantas|cuantos|cual|cuales|que (comi|almorce|desayune|cene|merende|tome|bebi|sintomas|molestias|me dio|tuve|registre|hice)|como (estuvo|me fue|estuve|ha estado|va mi|van mis)|cuando fue|cuando (comi|almorce|desayune|cene|tome|bebi)|hace cuanto)\b/;
/** Narraciones de registro que empiezan parecido a una pregunta ("cuando almorcé me dio gases"). */
const NARRATION = /\b(me dio|me dieron|tuve|me cayo|me senti|me empezo|me dolio|empece a)\b/;
/** Tras "recuérdame…": consulta si sigue "si", "qué comí", "cuándo", "cuántas"… */
const RECALL_TAIL = /^(?:recuerdame|recordame|acuerdame|me recuerdas|ayudame a recordar|no recuerdo|no me acuerdo)\s+(?:de\s+)?(si|que (?:comi|almorce|desayune|cene|merende|tome|me dio|tuve|registre|hice|me cayo|me paso|bebi)|cuando|cuantas?|cuantos|lo que|como (?:estuvo|fue|me fue|estuve)|a que hora|que dia|en que)\b/;
const MEAL_VERB = /\b(comi|almorce|desayune|cene|merende|tome|bebi|probe|me comi|me tome)\b/;

const NOISE = new Set(
  (
    'que cual cuales cuando cuantas cuantos como donde dime dimelo muestrame mostrame ensename sabes quiero saber consulta busca revisa me puedes podrias decir dices ' +
    'recuerdas recuerdame recordame acuerdame ayudame a recordar no recuerdo acuerdo hay si el la los las un una unos unas de del en y o yo mi mis fue ' +
    'ultima ultimas vez veces hace cuanto tiempo dia dias semana mes pasado pasada anterior este esta esto hoy ayer antier anteayer anoche manana tarde noche ' +
    'comi almorce desayune cene merende tome bebi probe comido tomado algo alguna alguno ya he habia registre registrado por favor lunes martes miercoles jueves viernes sabado domingo ' +
    'ultimos desayuno almuerzo cena merienda comida comidas onces vez para con sin lo le se'
  ).split(' '),
);

/** Detecta si la frase es una pregunta sobre el diario. */
export function detectQuery(raw: string, now: number, extraFoods: { name: string; key: string }[] = []): QueryIntent | undefined {
  const n = normalize(raw);
  if (!n) return undefined;
  const hasQuestionMark = /[?¿]/.test(raw);
  const recall = /^(recuerdame|recordame|acuerdame|me recuerdas|ayudame a recordar|no recuerdo|no me acuerdo)\b/.test(n);
  if (recall && !RECALL_TAIL.test(n)) return undefined; // "recuérdame tomar agua" es un recordatorio
  const questionish = hasQuestionMark || QUERY_START.test(n) || /\b(la ultima vez|cuantas veces)\b/.test(n);
  if (!questionish) return undefined;
  if (!hasQuestionMark && !recall && /^cuando\b/.test(n) && NARRATION.test(n)) return undefined;
  // "Cómo me fue" y similares se consultan; frases de registro con "como" ("como un 6") no empiezan así.
  if (/^como (un|una|a las|a la)\b/.test(n)) return undefined;

  const range = parseRange(n, now);
  const mealType = detectMealType(n);
  const foods = matchFoods(n, extraFoods);
  const symptomTypes = matchSymptomTypes(n);
  const rest = n
    .split(' ')
    .filter((w) => !NOISE.has(w) && !/^\d+$/.test(w) && w.length > 2)
    .filter((w) => !foods.some((f) => f.key.split(' ').includes(w) || f.key === w || `${f.key}s` === w))
    .join(' ');

  let kind: QueryKind;
  if (/\bayun/.test(n)) kind = 'fasts';
  else if (/\b(bano|popo|pupu|deposicion|deposiciones|evacue|hice del cuerpo|heces|cague)\b/.test(n)) kind = 'stools';
  else if ((/\bdigestion\b|\bcomo (estuve|me fue|estuvo mi dia|me senti)\b/.test(n)) && !foods.length) kind = 'digestion';
  else if (/\bagua\b/.test(n) && !foods.length) kind = 'water';
  else if (symptomTypes.length || /\b(sintomas?|molestias?|me dio|me dolio|me cayo mal)\b/.test(n)) kind = foods.length ? (/\b(la ultima vez|cuando)\b/.test(n) ? 'last_time' : 'ate') : 'symptoms';
  else if ((foods.length || rest) && /\b(la ultima vez|cuando fue|hace cuanto|cuando comi)\b/.test(n)) kind = 'last_time';
  else if ((foods.length || rest) && /\bcuantas veces\b/.test(n)) kind = 'count_food';
  else if (/\bque (comi|almorce|desayune|cene|merende|tome|bebi)\b|\bque hubo\b|\bmis comidas\b|\bmi (desayuno|almuerzo|cena)\b/.test(n) && !foods.length) kind = 'what_ate';
  else if (foods.length || (rest && MEAL_VERB.test(n))) kind = 'ate';
  else if (MEAL_VERB.test(n) || mealType) kind = 'what_ate';
  else return undefined;

  return { kind, foods, freeText: !foods.length && rest ? rest : undefined, mealType, symptomTypes, range };
}

// ───────────────────────── Respuestas ─────────────────────────

export interface QueryData {
  meals: Meal[];
  symptoms: Symptom[];
  stools: Stool[];
  logs: DailyLog[];
  fasts: Fast[];
}

/** "el almuerzo", "la cena", "una bebida". */
const mealPhrase = (t: MealType) => (t === 'bebida' ? 'una bebida' : `${t === 'cena' || t === 'merienda' ? 'la' : 'el'} ${mealTypeLabel(t).toLowerCase()}`);
const join = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function mealHas(m: Meal, q: QueryIntent): Meal['items'][number] | undefined {
  if (q.foods.length) {
    const keys = q.foods.map((f) => f.key);
    return m.items.find((i) => keys.includes(i.key) || (i.ingredients ?? []).some((x) => keys.includes(foodKey(x))));
  }
  if (q.freeText) {
    const words = q.freeText.split(' ');
    return m.items.find((i) => words.every((w) => foodKey(i.name).includes(w)) || (i.ingredients ?? []).some((x) => words.every((w) => foodKey(x).includes(w))));
  }
  return undefined;
}

function itemDetail(i: Meal['items'][number]): string {
  const extra: string[] = [];
  if (i.quantity === 'personalizada' && i.customQuantity) extra.push(i.customQuantity);
  else if (i.quantity !== 'normal') extra.push(quantityLabel(i.quantity).toLowerCase());
  if (i.preparation) extra.push(preparationLabel(i.preparation).toLowerCase());
  return extra.length ? ` (${extra.join(', ')})` : '';
}

function afterMeal(m: Meal, d: QueryData): string {
  const syms = d.symptoms.filter((s) => s.startedAt >= m.at && s.startedAt < m.at + 24 * HOUR).sort((a, b) => a.startedAt - b.startedAt);
  const soft = d.stools.filter((s) => s.at >= m.at && s.at < m.at + 24 * HOUR && s.bristol >= 6);
  const parts = syms.slice(0, 3).map((s) => `${symptomLabel(s.type, s.customName).toLowerCase().split(' / ')[0]} ${s.intensity}/10 a las ${formatTime(s.startedAt)}`);
  if (soft.length) parts.push(`${soft.length === 1 ? 'una deposición blanda' : `${soft.length} deposiciones blandas`}`);
  if (m.feelingAfter === 'pesado' || m.feelingAfter === 'molesto' || m.feelingAfter === 'mal') parts.unshift(`te sentiste ${m.feelingAfter === 'molesto' ? 'con molestia' : m.feelingAfter}`);
  return parts.length ? ` Después registraste: ${join(parts)}.` : ' No registraste molestias en las 24 horas siguientes.';
}

function foodName(q: QueryIntent): string {
  return q.foods.length ? join(q.foods.map((f) => f.name.toLowerCase())) : q.freeText ?? 'eso';
}

function inRange<T>(xs: T[], at: (x: T) => number, r: Range): T[] {
  return xs.filter((x) => at(x) >= r.from && at(x) < r.to);
}

const pastDays = (now: number, days: number): Range => ({ from: dayStart(addDays(dayKey(now), -(days - 1))), to: now + 1, label: `en los últimos ${days} días`, single: false });
const todayRange = (now: number): Range => dayRange(dayKey(now), now, 'hoy');

/** Responde una consulta con los datos del diario. */
export function answerQuery(q: QueryIntent, d: QueryData, now: number): string {
  // "p. m." ya termina en punto: evitar "p. m.."
  return answer(q, d, now).replace(/\.\.(?=\s|$)/g, '.');
}

function answer(q: QueryIntent, d: QueryData, now: number): string {
  const meals = [...d.meals].sort((a, b) => a.at - b.at);
  switch (q.kind) {
    case 'ate': {
      const name = foodName(q);
      const range = q.range;
      if (!range) return answerLastTime(q, meals, d, now);
      const hits = inRange(meals, (m) => m.at, range).filter((m) => mealHas(m, q));
      if (!hits.length) {
        const lastAny = [...meals].reverse().find((m) => mealHas(m, q) && m.at < range.from);
        return `No, ${range.label} no registraste ${name}.${lastAny ? ` La última vez fue ${dayPhrase(lastAny.at, now)} (${mealPhrase(lastAny.mealType)} a las ${formatTime(lastAny.at)}).` : ' No aparece en tu diario.'}`;
      }
      const lines = hits.slice(0, 3).map((m) => {
        const it = mealHas(m, q)!;
        const where = range.single ? '' : `${dayPhrase(m.at, now)}, `;
        return `${where}en ${mealPhrase(m.mealType)} a las ${formatTime(m.at)}${itemDetail(it)}`;
      });
      const head = `Sí. ${cap(range.label)} comiste ${name} ${hits.length > 1 ? `${hits.length} veces: ` : ''}${join(lines)}.`;
      return head + afterMeal(hits[hits.length - 1], d);
    }
    case 'last_time':
      return answerLastTime(q, meals, d, now);
    case 'count_food': {
      const r = q.range ?? pastDays(now, 30);
      const hits = inRange(meals, (m) => m.at, r).filter((m) => mealHas(m, q));
      if (!hits.length) return `${cap(r.label)} no registraste ${foodName(q)}.`;
      const days = [...new Set(hits.map((m) => dayPhrase(m.at, now)))];
      return `${cap(r.label)} comiste ${foodName(q)} ${hits.length === 1 ? '1 vez' : `${hits.length} veces`}${days.length <= 5 ? `: ${join(days)}` : ''}.`;
    }
    case 'what_ate': {
      const r = q.range ?? todayRange(now);
      const list = inRange(meals, (m) => m.at, r).filter((m) => !q.mealType || m.mealType === q.mealType);
      if (!list.length) return `${cap(r.label)} no registraste ${q.mealType ? mealPhrase(q.mealType) : 'comidas'}.`;
      const parts = list.slice(0, 6).map((m) => `${r.single ? '' : `${dayPhrase(m.at, now)}, `}${mealTypeLabel(m.mealType).toLowerCase()} a las ${formatTime(m.at)}: ${m.items.map((i) => i.name.toLowerCase() + itemDetail(i)).join(', ')}`);
      return `${cap(r.label)}: ${parts.join('. ')}.${list.length > 6 ? ` Y ${list.length - 6} más.` : ''}`;
    }
    case 'symptoms': {
      const r = q.range ?? todayRange(now);
      const list = inRange(d.symptoms, (s) => s.startedAt, r).filter((s) => !q.symptomTypes.length || q.symptomTypes.includes(s.type));
      const what = q.symptomTypes.length ? join(q.symptomTypes.map((t) => symptomLabel(t).toLowerCase().split(' / ')[0])) : 'síntomas';
      if (!list.length) return `${cap(r.label)} no registraste ${what}.`;
      const parts = list.slice(0, 5).map((s) => `${symptomLabel(s.type, s.customName).toLowerCase().split(' / ')[0]} ${s.intensity}/10 ${r.single ? '' : `${dayPhrase(s.startedAt, now)} `}a las ${formatTime(s.startedAt)}`);
      return `${cap(r.label)} registraste ${join(parts)}.`;
    }
    case 'stools': {
      const r = q.range ?? todayRange(now);
      const list = inRange(d.stools, (s) => s.at, r).sort((a, b) => a.at - b.at);
      if (!list.length) return `${cap(r.label)} no registraste deposiciones.`;
      const detail = list.length <= 4 ? `: ${join(list.map((s) => `tipo ${s.bristol} (${bristolInfo(s.bristol).group === 'normal' ? 'normal' : bristolInfo(s.bristol).group}) ${r.single ? '' : `${dayPhrase(s.at, now)} `}a las ${formatTime(s.at)}`))}` : `; Bristol medio ${(list.reduce((a, s) => a + s.bristol, 0) / list.length).toFixed(1).replace('.', ',')}`;
      const blood = list.filter((s) => s.blood !== 'no').length;
      return `${cap(r.label)} fuiste al baño ${list.length === 1 ? '1 vez' : `${list.length} veces`}${detail}.${blood ? ` En ${blood} anotaste sangre.` : ''}`;
    }
    case 'digestion': {
      const r = q.range ?? todayRange(now);
      const logs = d.logs.filter((l) => dayStart(l.day) >= r.from && dayStart(l.day) < r.to && l.digestion);
      if (!logs.length) return `${cap(r.label)} no calificaste tu digestión.`;
      if (r.single) return `${cap(r.label)} calificaste tu digestión como «${DIGESTION.find((x) => x.value === logs[0].digestion)!.label.toLowerCase()}».`;
      const avg = logs.reduce((a, l) => a + l.digestion!, 0) / logs.length;
      return `${cap(r.label)} calificaste ${logs.length} días; en promedio ${avg.toFixed(1).replace('.', ',')} de 5 (${DIGESTION.find((x) => x.value === Math.round(avg))!.label.toLowerCase()}).`;
    }
    case 'water': {
      const r = q.range ?? todayRange(now);
      const logs = d.logs.filter((l) => dayStart(l.day) >= r.from && dayStart(l.day) < r.to && (l.water || l.hydration));
      if (!logs.length) return `${cap(r.label)} no anotaste agua.`;
      return `${cap(r.label)}: ${logs.map((l) => `${r.single ? '' : `${dayPhrase(dayStart(l.day), now)}, `}${hydrationSummary(l)}`).join('; ')}.`;
    }
    case 'fasts': {
      const r = q.range ?? pastDays(now, 30);
      const list = d.fasts.filter((f) => f.endAt !== undefined && f.endAt >= r.from && f.startAt < r.to).sort((a, b) => a.startAt - b.startAt);
      const open = d.fasts.find((f) => f.endAt === undefined && f.startAt <= now);
      const openTxt = open ? ` Ahora llevas ${Math.floor((now - open.startAt) / HOUR)} h de ayuno.` : '';
      if (!list.length) return `${cap(r.label)} no terminaste ayunos.${openTxt}`;
      const parts = list.slice(-4).map((f) => `${Math.round(((f.endAt! - f.startAt) / HOUR) * 10) / 10} h ${dayPhrase(f.endAt!, now)}`.replace('.', ','));
      return `${cap(r.label)} hiciste ${list.length === 1 ? '1 ayuno' : `${list.length} ayunos`}: ${join(parts)}.${openTxt}`;
    }
  }
}

function answerLastTime(q: QueryIntent, meals: Meal[], d: QueryData, now: number): string {
  const name = foodName(q);
  const hits = meals.filter((m) => mealHas(m, q));
  if (!hits.length) return `No encuentro ${name} en tu diario.`;
  const last = hits[hits.length - 1];
  const it = mealHas(last, q)!;
  const days = Math.floor((dayStart(dayKey(now)) - dayStart(dayKey(last.at))) / DAY);
  const recent = hits.filter((m) => m.at > now - 30 * DAY).length;
  return `La última vez que comiste ${name} fue ${dayPhrase(last.at, now)}${days > 2 ? ` (hace ${days} días)` : ''}, en ${mealPhrase(last.mealType)} a las ${formatTime(last.at)}${itemDetail(it)}. En los últimos 30 días, ${recent === 1 ? '1 vez' : `${recent} veces`}.${afterMeal(last, d)}`;
}

// ───────────────────────── Recordatorios ─────────────────────────

export interface ReminderIntent {
  /** Momento del aviso, si se indicó. */
  at?: number;
  text: string;
  daily: boolean;
}

const REMIND = /^(?:por favor )?(recuerdame|recordame|acuerdame|avisame|me recuerdas|me avisas|ponme un recordatorio(?: para)?|pon un recordatorio(?: para)?|crea un recordatorio(?: para)?)\b\s*(?:de |que |a )?/;

/** Hora futura: "en 2 horas", "a las 3", "mañana a las 8", "esta noche". */
export function parseFutureTime(n: string, now: number): number | undefined {
  const inRel = n.match(/\ben (\d+|una?|media) (horas?|minutos?|min|hora y media)\b/);
  if (inRel) {
    const q = inRel[1] === 'media' ? 0.5 : inRel[1] === 'un' || inRel[1] === 'una' ? 1 : Number(inRel[1]);
    const mins = /min/.test(inRel[2]) ? q : inRel[2] === 'hora y media' ? 90 : q * 60;
    return now + mins * 60_000;
  }
  const s = n.replace(/\b(a la|la) una\b/g, '$1 1');
  let dayOffset = 0;
  if (/\bpasado manana\b/.test(s)) dayOffset = 2;
  else if (/\bmanana\b/.test(s) && !/\b(de|en|por|esta) la manana\b|\besta manana\b/.test(s.replace(/^manana\b/, ''))) dayOffset = 1;
  const clock = s.match(/\b(?:a las?|a la)\s*(\d{1,2})(?::(\d{2}))?(?:\s*y\s*(media|cuarto))?(?:\s*(?:de la|en la|por la)?\s*(manana|tarde|noche)|\s*(am|pm|a m|p m))?/);
  let hour: number | undefined;
  let period: string | undefined;
  if (clock) {
    hour = Number(clock[1]) + (clock[2] ? Number(clock[2]) / 60 : clock[3] === 'media' ? 0.5 : clock[3] === 'cuarto' ? 0.25 : 0);
    period = clock[4] ?? (clock[5] ? (clock[5].startsWith('p') ? 'pm' : 'am') : undefined);
  } else if (/\b(esta noche|en la noche|por la noche)\b/.test(s)) hour = 20;
  else if (/\b(esta tarde|en la tarde|por la tarde)\b/.test(s)) hour = 15;
  else if (/\bmediodia\b/.test(s)) hour = 12;
  else if (dayOffset) hour = 8;
  if (hour === undefined || hour > 24) return undefined;
  if ((period === 'tarde' || period === 'noche' || period === 'pm') && hour < 12) hour += 12;
  const at = (h: number, off: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + off);
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    return d.getTime();
  };
  if (dayOffset) return at(period || hour >= 12 ? hour : hour < 7 ? hour + 12 : hour, dayOffset);
  // Hoy: la próxima ocurrencia futura (a. m. o p. m.)
  const candidates = period ? [hour] : hour < 12 ? [hour, hour + 12] : [hour];
  for (const h of candidates) if (at(h, 0) > now + 60_000) return at(h, 0);
  return at(candidates[0], 1);
}

const TIME_PHRASES =
  /\b(en (\d+|una?|media) (horas?|minutos?|min|hora y media)|pasado manana|manana|esta noche|en la noche|por la noche|esta tarde|en la tarde|por la tarde|al mediodia|mediodia|todos los dias|cada dia|a diario|diariamente|(a las?|a la) \d{1,2}(:\d{2})?( y (media|cuarto))?( (de la|en la|por la) (manana|tarde|noche)| (am|pm|a m|p m))?)\b/g;

/** Detecta un pedido de recordatorio. */
export function detectReminder(raw: string, now: number): ReminderIntent | undefined {
  const n = normalize(raw);
  const m = n.match(REMIND);
  if (!m || RECALL_TAIL.test(n)) return undefined;
  const daily = /\b(todos los dias|cada dia|a diario|diariamente)\b/.test(n);
  const at = parseFutureTime(n, now);
  const original = raw
    .replace(/^[\s¿¡]*(por favor,?\s*)?/i, '')
    .replace(/^(recuérdame|recuerdame|recórdame|recordame|acuérdame|acuerdame|avísame|avisame|me recuerdas|me avisas|ponme un recordatorio( para)?|pon un recordatorio( para)?|crea un recordatorio( para)?)\b[\s,]*(de |que |a (?!las? |la ))?/i, '');
  // Quitar las expresiones de tiempo del texto original (sin tildes para comparar)
  let text = original;
  const plain = normalize(original);
  const timeBits = plain.match(TIME_PHRASES) ?? [];
  for (const bit of timeBits) {
    const re = new RegExp(bit.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,]+').replace(/a/g, '[aá]').replace(/e/g, '[eé]').replace(/i/g, '[ií]').replace(/o/g, '[oó]').replace(/u/g, '[uú]').replace(/n/g, '[nñ]'), 'i');
    text = text.replace(re, ' ');
  }
  text = text.replace(/\s+/g, ' ').replace(/^[\s,.]+|[\s,.?!]+$/g, '').replace(/^(que|de|a|para) /i, '').trim();
  if (!text) text = 'Registrar en DIGESTA';
  return { at, text: cap(text), daily };
}
