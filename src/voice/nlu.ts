/**
 * Intérprete local de lenguaje natural (español de Colombia) para el asistente de voz.
 *
 * Convierte frases como
 *   "almorcé a la una arroz, fríjoles bastantes y carne asada, me cayó pesado"
 *   "hace una hora me dio agrieras fuerte"
 *   "fui al baño y salió normal"
 * en borradores estructurados de comidas, síntomas y deposiciones.
 *
 * Todo ocurre en el dispositivo con reglas y diccionarios: no se usa ningún
 * servicio externo. Lo que no se entiende con seguridad se marca para que el
 * diálogo pregunte.
 */
import { DAY, HOUR } from '@/domain/dates';
import { FOOD_CATALOG, foodKey, prettyName } from '@/domain/foods';
import type {
  AbdomenZone,
  BloodPresence,
  BristolType,
  DigestionRating,
  FeelingAfter,
  Level0to3,
  MealType,
  Preparation,
  QuantityLevel,
  StoolColor,
  SymptomType,
} from '@/domain/types';

// ───────────────────────── Tipos ─────────────────────────

export interface DraftItem {
  name: string;
  key: string;
  quantity: QuantityLevel;
  customQuantity?: string;
  preparation?: Preparation;
  ingredients?: string[];
  /** false si no está en el catálogo ni en tu historial: el diálogo pregunta. */
  known: boolean;
  explicitQty: boolean;
}

export interface DraftMeal {
  mealType?: MealType;
  mealTypeExplicit: boolean;
  /** Hora indicada (si `timeExplicit`). */
  at?: number;
  timeExplicit: boolean;
  items: DraftItem[];
  supplements: string[];
  feelingAfter?: FeelingAfter;
}

export interface DraftSymptom {
  type: SymptomType;
  customName?: string;
  intensity?: number;
  at?: number;
  timeExplicit: boolean;
  /** "después de almorzar" → se ubica respecto a esa comida. */
  afterMeal?: MealType | 'comida';
  location?: AbdomenZone;
  status: 'en_curso' | 'termino' | 'desconocido';
  durationMin?: number;
}

export interface DraftStool {
  at?: number;
  timeExplicit: boolean;
  bristol?: BristolType;
  color?: StoolColor;
  blood?: BloodPresence;
  urgency?: Level0to3;
  effort?: Level0to3;
  pain?: boolean;
  painIntensity?: number;
  mucus?: boolean;
  incomplete?: boolean;
}

export type Intent = 'confirm' | 'no' | 'cancel' | 'skip';

export interface ParseResult {
  meals: DraftMeal[];
  symptoms: DraftSymptom[];
  stools: DraftStool[];
  /** Vasos de agua mencionados. */
  water?: number;
  digestion?: DigestionRating;
  /** Claves de alimentos que la persona pidió quitar ("quita el pan"). */
  removals: string[];
  intent?: Intent;
  /** Tipo de comida mencionado sin alimentos ("era la cena"). */
  mealTypeOnly?: MealType;
  /** Hora mencionada sin alimentos ni síntomas ("fue a las 8"). */
  timeOnly?: number;
  /** Sensación mencionada sin alimentos ("me cayó pesado"). */
  feelingOnly?: FeelingAfter;
  /** Cantidad general sin alimentos ("todo fue poquito"). */
  quantityOnly?: Exclude<QuantityLevel, 'personalizada'>;
  /** Número suelto (respuestas a "¿de 0 a 10?" o "¿tipo de Bristol?"). */
  number?: number;
  /** true si no se reconoció nada útil. */
  empty: boolean;
}

export interface ParseContext {
  now: number;
  /** Alimentos de tu historial y propios (nombre visible). */
  extraFoods?: { name: string; key: string }[];
}

// ───────────────────────── Normalización ─────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  cero: 0, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40,
  cincuenta: 50, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
};

/** Minúsculas, sin tildes, sin puntuación (conserva ":" para horas) y números en dígitos. */
export function normalize(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)[.,](\d)/g, '$1:$2') // 7.30 → 7:30
    .replace(/[^a-z0-9: ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base
    .split(' ')
    .map((w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w))
    .join(' ');
}


// ───────────────────────── Léxicos ─────────────────────────

interface LexEntry {
  name: string;
  key: string;
  ingredients?: string[];
  known: boolean;
}

/** Palabras que sólo son alimento en ciertos contextos ("vino" = llegó; "te" = pronombre). */
const AMBIGUOUS_FOODS: Record<string, RegExp> = {
  te: /(un|una|de|tome|tomamos|taza|tazas|con|y|el|aromatica|poquito|mas)$/,
  vino: /(un|una|de|tome|tomamos|copa|copas|vaso|vasos|con|y|el|poquito|mas|tinto|blanco)$/,
  papa: /^(?!.*\bmi$)/,
  ron: /.*/,
  pera: /.*/,
};

const BEVERAGE_KEYS = new Set(
  [
    'cafe', 'cafe con leche', 'tinto', 'chocolate caliente', 'aguapanela', 'te', 'aromatica', 'jugo', 'jugo de naranja', 'jugo de lulo',
    'jugo de mora', 'jugo de maracuya', 'limonada', 'gaseosa', 'gaseosa cero', 'agua con gas', 'cerveza', 'vino', 'aguardiente', 'ron',
    'bebida energizante', 'kumis', 'avena bebida', 'batido de proteina', 'leche', 'leche deslactosada', 'bebida de almendras',
  ].map(foodKey),
);

export function isBeverage(key: string) {
  return BEVERAGE_KEYS.has(key);
}

function buildLexicon(extra: { name: string; key: string }[] = []): Map<string, LexEntry> {
  const lex = new Map<string, LexEntry>();
  const put = (k: string, e: LexEntry, overwrite = false) => {
    if (!k) return;
    if (overwrite || !lex.has(k)) lex.set(k, e);
    // Plurales simples
    const last = k.split(' ').pop()!;
    if (!/s$/.test(last)) {
      const pl = /[aeiou]$/.test(last) ? `${k}s` : `${k}es`;
      if (!lex.has(pl)) lex.set(pl, e);
    }
  };
  for (const f of FOOD_CATALOG) put(foodKey(f.name), { name: f.name, key: foodKey(f.name), ingredients: f.ingredients, known: true }, true);
  for (const f of FOOD_CATALOG) for (const a of f.aliases ?? []) put(foodKey(a), { name: f.name, key: foodKey(f.name), ingredients: f.ingredients, known: true });
  for (const e of extra) put(e.key, { name: e.name, key: e.key, known: true });
  return lex;
}

const SUPPLEMENTS: [RegExp, string][] = [
  [/\bcreatina\b/, 'Creatina'],
  [/\b(proteina en polvo|whey|scoop de proteina)\b/, 'Proteína en polvo'],
  [/\bmultivitaminico\b|\bvitaminas\b/, 'Multivitamínico'],
  [/\bomega 3\b|\bomega\b/, 'Omega 3'],
  [/\bmagnesio\b/, 'Magnesio'],
  [/\bprobioticos?\b/, 'Probiótico'],
  [/\bhierro\b/, 'Hierro'],
  [/\bvitamina d\b/, 'Vitamina D'],
  [/\bvitamina c\b/, 'Vitamina C'],
  [/\bpre ?entreno\b/, 'Pre-entreno'],
  [/\bcolageno\b/, 'Colágeno'],
  [/\b(psyllium|fibra en polvo|metamucil)\b/, 'Fibra (psyllium)'],
];

const PREP_WORDS: [RegExp, Preparation][] = [
  [/^(frit[oa]s?|apanad[oa]s?|freid[oa]s?)$/, 'frito'],
  [/^(asad[oa]s?|plancha|parrilla|a la plancha)$/, 'asado'],
  [/^(cocid[oa]s?|cocinad[oa]s?|hervid[oa]s?|sancochad[oa]s?)$/, 'cocido'],
  [/^vapor$/, 'al_vapor'],
  [/^(hornead[oa]s?|horno)$/, 'horneado'],
  [/^(sudad[oa]s?|guisad[oa]s?|estofad[oa]s?|salsa)$/, 'guisado'],
  [/^(crud[oa]s?)$/, 'crudo'],
  [/^(licuad[oa]s?|batid[oa]s?)$/, 'licuado'],
  [/^(empacad[oa]s?|procesad[oa]s?|enlatad[oa]s?)$/, 'procesado'],
  [/^(fermentad[oa]s?)$/, 'fermentado'],
];

const SMALL = /^(poquito|poquita|poquitos|poco|poca|pocos|pequen[oa]s?|mitad|media|medio|chiquit[oa]s?|un poco)$/;
const LARGE = /^(mucho|mucha|muchos|muchas|bastante|bastantes|harto|harta|hartos|abundante|abundantes|doble|grande|grandes|repeti|full|montones|tremendo)$/;
const UNITS = /^(tazas?|vasos?|platos?|porcion(es)?|pocillos?|cucharadas?|cucharaditas?|latas?|botellas?|pedazos?|tajadas?|rebanadas?|gramos|g|gr|ml|mililitros|unidades|copas?|onzas?|litros?|scoops?|sobres?|paquetes?)$/;

/** Palabras sin contenido para detectar alimentos desconocidos. */
const STOP = new Set(
  (
    'a al algo alla aqui asi bien bueno buena casa cada como comi comimos comer comiendo con cual de del desayune desayuno desayunamos despues ' +
    'donde el ella ellos en entonces era es esa ese eso esta estaba estuvo este esto fue fui ha habia hace hice hoy la las le les lo los luego ' +
    'mas me mi mis muy nada no nos o otra otro otros para pero por porque que rato rico rica ricos deliciosa delicioso se si sin solo su sus ' +
    'tambien tome tomamos tomando tomar tuve un una unas uno unos y ya yo almorce almuerzo almorzamos cene cena cenamos merende merienda onces ' +
    'mecato refrigerio snack pasabocas comida plato platos manana tarde noche ayer anoche antier mediodia madrugada ahora ahorita acabo recien ' +
    'medio media hora horas minutos minuto vez veces todo toda todos todas poquito poco poca mucho mucha bastante harto tipo estilo ' +
    'mama papa novia novio esposa esposo amigos amigo amiga familia trabajo oficina restaurante calle gimnasio gym entreno entrenar ' +
    'favor gracias listo ok vale dale bueno super tan pues entonces osea igual tal vez quizas creo parece senti siento cayo quede ' +
    'acompanado acompanada acompanamiento plus adicional extra lado parte'
  ).split(' '),
);

// Marcadores de tipo de comida
const MEAL_MARKERS: [RegExp, MealType][] = [
  [/\b(desayune|desayuno|desayunamos|desayunar|de desayuno|en el desayuno)\b/, 'desayuno'],
  [/\b(almorce|almuerzo|almorzamos|almorzar|de almuerzo|en el almuerzo)\b/, 'almuerzo'],
  [/\b(cene|cena|cenamos|cenar|de comida|en la comida|de cena|en la noche comi)\b/, 'cena'],
  [/\b(merende|merienda|onces|medias nueves|media manana|mecato|refrigerio|snack|pasabocas|de algo|algo de comer)\b/, 'merienda'],
];

export function detectMealType(s: string): MealType | undefined {
  for (const [re, t] of MEAL_MARKERS) if (re.test(s)) return t;
  return undefined;
}

// ───────────────────────── Tiempo ─────────────────────────

export const TYPICAL_HOUR: Record<MealType, number> = { desayuno: 7.5, almuerzo: 12.5, merienda: 16, cena: 19.5, bebida: 10 };

function atHour(now: number, dayOffset: number, h: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  return d.getTime();
}

/**
 * Interpreta expresiones de tiempo en una cláusula normalizada.
 * Devuelve undefined si no hay ninguna.
 */
export function parseTime(input: string, now: number, mealHint?: MealType): number | undefined {
  const s = input.replace(/\b(a la|la|eso de la|como a la|sobre la) una\b/g, '$1 1');
  let dayOffset = 0;
  let dayExplicit = false;
  if (/\b(antier|anteayer)\b/.test(s)) {
    dayOffset = -2;
    dayExplicit = true;
  } else if (/\b(ayer|anoche)\b/.test(s)) {
    dayOffset = -1;
    dayExplicit = true;
  }

  // "hace 2 horas", "hace media hora", "hace un rato", "hace 20 minutos"
  const hace = s.match(/\bhace (\d+|una?|media|un rato|ratico|poco)(?: (horas?|minutos?|min|rato))?\b/);
  if (hace) {
    const q = hace[1];
    const unit = hace[2] ?? '';
    let min = 30;
    if (q === 'media') min = 30;
    else if (q === 'un rato' || q === 'ratico' || q === 'poco' || unit === 'rato') min = 30;
    else {
      const n = q === 'un' || q === 'una' ? 1 : Number(q);
      min = /hora/.test(unit) ? n * 60 : /min/.test(unit) ? n : n <= 12 ? n * 60 : n;
    }
    return now - min * 60_000;
  }
  if (/\b(ahorita|ahora|acabo de|recien|en este momento)\b/.test(s) && !/\bahora en la\b/.test(s)) {
    if (!dayExplicit) return now;
  }

  // "a las 7", "a la 1 y media", "7:30 de la noche", "a las 8 pm"
  const clock = s.match(/\b(?:a las?|como a las?|sobre las?|eso de las?|las?)\s*(\d{1,2})(?::(\d{2}))?(?:\s*y\s*(media|cuarto|\d{1,2}))?(?:\s*(?:de la|en la|por la)?\s*(manana|tarde|noche|madrugada)|\s*(am|pm|a m|p m))?/);
  const loose = !clock ? s.match(/\b(\d{1,2}):(\d{2})\b(?:\s*(?:de la)?\s*(manana|tarde|noche))?/) : null;
  let hour: number | undefined;
  let period: string | undefined;
  if (clock) {
    hour = Number(clock[1]);
    let mins = clock[2] ? Number(clock[2]) : 0;
    if (clock[3] === 'media') mins = 30;
    else if (clock[3] === 'cuarto') mins = 15;
    else if (clock[3]) mins = Number(clock[3]);
    period = clock[4] ?? (clock[5] ? (clock[5].startsWith('p') ? 'pm' : 'am') : undefined);
    hour += mins / 60;
  } else if (loose) {
    hour = Number(loose[1]) + Number(loose[2]) / 60;
    period = loose[3];
  } else if (/\bmediodia\b/.test(s)) {
    hour = 12.5;
    period = 'tarde';
  } else if (/\bmedia noche|medianoche\b/.test(s)) {
    hour = 0;
    period = 'madrugada';
  }

  if (hour === undefined || hour > 24) {
    // Sólo una parte del día
    const part = /\b(esta manana|en la manana|por la manana|de manana|temprano)\b/.test(s)
      ? 8
      : /\b(esta tarde|en la tarde|por la tarde)\b/.test(s)
        ? 15
        : /\b(anoche|esta noche|en la noche|por la noche)\b/.test(s)
          ? 20
          : /\bmadrugada\b/.test(s)
            ? 3
            : undefined;
    if (part !== undefined) {
      let t = atHour(now, dayOffset, part);
      if (!dayExplicit && t > now) t = Math.min(now, t);
      return t;
    }
    if (dayExplicit) return atHour(now, dayOffset, mealHint ? TYPICAL_HOUR[mealHint] : 12);
    return undefined;
  }

  let h = hour;
  if (period === 'pm' || period === 'tarde' || period === 'noche') {
    if (h < 12) h += 12;
  } else if (period === 'manana' || period === 'am' || period === 'madrugada') {
    if (h >= 12) h -= 12;
  } else if (h < 12) {
    // Sin a. m./p. m.: usar el tipo de comida o la ocurrencia pasada más reciente
    if (mealHint === 'desayuno') {
      /* mañana */
    } else if (mealHint === 'almuerzo') {
      if (h <= 5) h += 12;
    } else if (mealHint === 'cena' || mealHint === 'merienda') {
      if (h >= 1 && h <= 11) h += 12;
    } else if (!dayExplicit) {
      const am = atHour(now, 0, h);
      const pm = atHour(now, 0, h + 12);
      if (pm <= now + 5 * 60_000) h += 12;
      else if (am > now + 5 * 60_000) h += 12; // aún no llega: fue ayer en la noche → se corrige abajo
    }
  }
  let t = atHour(now, dayOffset, h);
  if (!dayExplicit && t > now + 5 * 60_000) t -= DAY;
  return t;
}

// ───────────────────────── Síntomas ─────────────────────────

const SYMPTOM_LEX: [RegExp, SymptomType][] = [
  [/\b(hinchad[oa]s?|inflad[oa]s?|hinchazon|distension|distendid[oa]|abombad[oa])\b/, 'hinchazon'],
  [/\b(gases|flatulencias?|pedos?|gasecitos|gas)\b/, 'gases'],
  [/\b(agrieras?|acidez|ardor|ardia|arde|quemazon|acido)\b/, 'acidez'],
  [/\b(eructos?|eructando|eructe|eructaba|reflujo|regurgit\w*)\b/, 'eructos'],
  [/\b(nauseas?|maluquera|ganas de vomitar|mareo|maread[oa]|asco|estomago revuelto)\b/, 'nauseas'],
  [/\b(vomite|vomito|vomitando|vomitaba|devolvi)\b/, 'vomito'],
  [/\b(retorcijones?|retortijones?|colicos?|torcijones?)\b/, 'retortijones'],
  [/\b(dolor|dolio|duele|dolia|adolorid[oa]|punzada|punzadas)\b/, 'dolor'],
  [/\b(diarrea|estomago suelto|soltura|descompuest[oa])\b/, 'diarrea'],
  [/\b(estrenid[oa]|estrenimiento|no he podido ir al bano|no pude ir al bano|no he hecho popo|no he podido hacer)\b/, 'estrenimiento'],
  [/\b(pesadez|llenura|empachad[oa]|empacho|indigestion|indigestad[oa]|pesad[oa] el estomago)\b/, 'pesadez'],
];

const OTHER_PAIN = /\bdolor de (cabeza|muela|espalda|garganta|pecho|cuello|piernas?)\b/;

export function intensityIn(s: string): number | undefined {
  const num = s.match(/\b(\d{1,2})\s*(?:de|sobre)\s*10\b/) ?? s.match(/\b(?:un|una|intensidad|nivel|como un|como en)\s+(\d{1,2})\b/);
  if (num && Number(num[1]) <= 10) return Number(num[1]);
  if (/\b(muy fuerte|muy duro|horrible|terrible|insoportable|demasiado|durisim[oa]|horroroso|fuertisim[oa]|tenaz|berraco|el peor)\b/.test(s)) return 9;
  if (/\b(fuerte|bastante|mucho|mucha|harto|duro|feo|intenso|intensa)\b/.test(s)) return 7;
  if (/\b(moderad[oa]|regular|medio|mas o menos|normalito)\b/.test(s)) return 5;
  if (/\b(leve|poquito|un poco|poco|suave|ligero|ligera|levecito|nada grave)\b/.test(s)) return 3;
  return undefined;
}

function locationIn(s: string): AbdomenZone | undefined {
  const right = /\b(derech[oa])\b/.test(s);
  const left = /\b(izquierd[oa])\b/.test(s);
  const up = /\b(arriba|boca del estomago|parte de arriba|epigastrio)\b/.test(s);
  const down = /\b(abajo|bajo vientre|vientre|parte de abajo)\b/.test(s);
  if (/\b(todo el abdomen|toda la barriga|todo el estomago|general|todo)\b/.test(s) && !right && !left) return 'general';
  if (/\bombligo\b/.test(s)) return 'periumbilical';
  if (right) return up ? 'hipocondrio_derecho' : down ? 'fosa_iliaca_derecha' : 'flanco_derecho';
  if (left) return up ? 'hipocondrio_izquierdo' : down ? 'fosa_iliaca_izquierda' : 'flanco_izquierdo';
  if (up) return 'epigastrio';
  if (down) return 'hipogastrio';
  return undefined;
}

function isNegated(clause: string, index: number): boolean {
  const before = clause.slice(0, index).trim().split(' ').slice(-4).join(' ');
  return /\b(no|sin|ni|nada de|cero)\b/.test(before) && !/\b(no se me ha quitado|no se me quita|no para)\b/.test(clause);
}

function parseSymptoms(clause: string, now: number): DraftSymptom[] {
  const out: DraftSymptom[] = [];
  const seen = new Set<SymptomType>();
  let c = clause;
  const other = c.match(OTHER_PAIN);
  if (other && !isNegated(c, other.index ?? 0)) {
    out.push(baseSymptom('otro', c, now, `Dolor de ${other[1]}`));
    c = c.replace(OTHER_PAIN, ' ');
  }
  for (const [re, type] of SYMPTOM_LEX) {
    const m = c.match(re);
    if (!m || seen.has(type)) continue;
    if (type === 'vomito' && /ganas de vomitar/.test(c) && !/\b(vomite|vomitando)\b/.test(c)) continue;
    if (isNegated(c, m.index ?? 0)) continue;
    seen.add(type);
    out.push(baseSymptom(type, c, now));
  }
  return out;
}

function baseSymptom(type: SymptomType, c: string, now: number, customName?: string): DraftSymptom {
  const at = parseTime(c, now);
  let status: DraftSymptom['status'] = 'desconocido';
  if (/\b(ya (se me )?(paso|quito|calmo|fue)|se me (paso|quito|calmo)|ya no (me duele|tengo|siento))\b/.test(c)) status = 'termino';
  else if (/\b(todavia|aun|sigo|sigue|continua|no se me (ha )?quita|tengo|estoy|me duele|ando)\b/.test(c)) status = 'en_curso';
  const dur = c.match(/\b(?:duro|dura|por|durante) (\d+|una?|media) (horas?|minutos?|rato)\b/);
  let durationMin: number | undefined;
  if (dur) {
    const n = dur[1] === 'media' ? 0.5 : dur[1] === 'un' || dur[1] === 'una' ? 1 : Number(dur[1]);
    durationMin = /hora/.test(dur[2]) ? Math.round(n * 60) : dur[2] === 'rato' ? 30 : n;
    status = 'termino';
  }
  const after = c.match(/\bdespues de(?:l| la| el)? (almorzar|almuerzo|desayunar|desayuno|cenar|cena|comer|comida|merendar|onces)\b/);
  const afterMeal = after
    ? /almu|almor/.test(after[1])
      ? 'almuerzo'
      : /desay/.test(after[1])
        ? 'desayuno'
        : /cen/.test(after[1])
          ? 'cena'
          : /meren|once/.test(after[1])
            ? 'merienda'
            : 'comida'
    : undefined;
  return {
    type,
    customName,
    intensity: intensityIn(c),
    at,
    timeExplicit: at !== undefined,
    afterMeal,
    location: type === 'dolor' || type === 'retortijones' || type === 'otro' ? locationIn(c) : undefined,
    status,
    durationMin,
  };
}

// ───────────────────────── Deposiciones ─────────────────────────

const STOOL_TRIGGER = /\b(hice popo|hice pupu|popo|pupu|fui al bano|ido al bano|entre al bano|deposicion(es)?|evacue|evacuacion|hice del cuerpo|hice del dos|cague|caca|defeque|heces|materia fecal|del 2|hice el 2|obre|hice 2)\b/;

export function bristolIn(s: string): BristolType | undefined {
  if (/\btipo (\d)\b/.test(s)) {
    const n = Number(s.match(/\btipo (\d)\b/)![1]);
    if (n >= 1 && n <= 7) return n as BristolType;
  }
  if (/\b(liquida|liquido|aguada|aguado|agua|chorro|pura agua)\b/.test(s)) return 7;
  if (/\b(pastosa|espesa|floja|suelta|sueltica|sueltas?|diarrea|esponjosa)\b/.test(s)) return 6;
  if (/\b(blanda|blandita|blando|suave)\b/.test(s)) return 5;
  if (/\b(bolitas?|pepitas?|piedras?|canicas|nueces)\b/.test(s)) return 1;
  if (/\b(grietas|agrietada|cuarteada)\b/.test(s)) return 3;
  if (/\b(dura|duras|duro|seca|reseca|dificil|costo)\b/.test(s)) return 2;
  if (/\b(normal|normalito|bien|perfecta|formada|lisa|salchicha|buena)\b/.test(s)) return 4;
  return undefined;
}

function parseStool(c: string, now: number): DraftStool {
  const at = parseTime(c, now);
  const st: DraftStool = { at, timeExplicit: at !== undefined, bristol: bristolIn(c) };
  if (/\b(negra|negro|negras|alquitran)\b/.test(c)) st.color = 'negro';
  else if (/\bverde\b/.test(c)) st.color = 'verde';
  else if (/\bamarill[oa]\b/.test(c)) st.color = 'amarillo';
  else if (/\b(roja|rojo|rojiza)\b/.test(c)) st.color = 'rojo';
  else if (/\b(gris|blanca|palida|clarita|muy clara)\b/.test(c)) st.color = 'gris_claro';
  else if (/\boscura\b/.test(c)) st.color = 'marron_oscuro';
  const blood = c.match(/\bsangre\b/);
  if (blood && !isNegated(c, blood.index ?? 0)) {
    st.blood = /\b(mucha|bastante|abundante|harta) sangre\b/.test(c) ? 'abundante' : /\bpapel\b/.test(c) ? 'papel' : 'heces';
  } else if (blood) st.blood = 'no';
  if (/\b(corriendo|no aguantaba|casi no llego|de afan|urgentisimo)\b/.test(c)) st.urgency = 3;
  else if (/\b(urgencia|urgente|rapido)\b/.test(c)) st.urgency = 2;
  if (/\b(mucho esfuerzo|puje mucho|me costo mucho)\b/.test(c)) st.effort = 3;
  else if (/\b(esfuerzo|pujar|puje|costo|dificil)\b/.test(c)) st.effort = 2;
  const pain = c.match(/\b(dolor|dolio|duele|ardor|ardia)\b/);
  if (pain && !isNegated(c, pain.index ?? 0)) {
    st.pain = true;
    st.painIntensity = intensityIn(c);
  }
  if (/\b(moco|mocos|mucosidad|baba)\b/.test(c) && !isNegated(c, c.search(/\b(moco|mocos|mucosidad|baba)\b/))) st.mucus = true;
  if (/\b(incompleta|quede con ganas|no termine|como si faltara|sensacion de que falta)\b/.test(c)) st.incomplete = true;
  return st;
}

// ───────────────────────── Comidas ─────────────────────────

const FEELING_RE = /\bme (cayo|caye|senti|siento|quede|sento)\b(?: (?:super|muy|re|como))? (bien|ligero|liviano|satisfecho|satisfecha|lleno|llena|pesado|pesada|mal|maluco|regular|horrible|fatal)\b/;

function feelingIn(s: string): FeelingAfter | undefined {
  const m = s.match(FEELING_RE);
  if (!m) return undefined;
  const w = m[2];
  if (/ligero|liviano/.test(w)) return 'ligero';
  if (/satisfech|llen/.test(w)) return 'satisfecho';
  if (/pesad/.test(w)) return 'pesado';
  if (/regular/.test(w)) return 'molesto';
  if (/mal|maluco|horrible|fatal/.test(w)) return 'mal';
  return 'bien';
}

interface FoodSpan {
  start: number;
  end: number;
  entry: LexEntry;
}

function findFoods(tokens: string[], lex: Map<string, LexEntry>): FoodSpan[] {
  const spans: FoodSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: FoodSpan | null = null;
    for (let L = Math.min(5, tokens.length - i); L >= 1; L--) {
      const phrase = tokens.slice(i, i + L).join(' ');
      const e = lex.get(phrase);
      if (!e) continue;
      if (L === 1 && AMBIGUOUS_FOODS[phrase]) {
        const prev = tokens.slice(Math.max(0, i - 2), i).join(' ');
        if (!AMBIGUOUS_FOODS[phrase].test(prev)) continue;
      }
      found = { start: i, end: i + L, entry: e };
      break;
    }
    if (found) {
      spans.push(found);
      i = found.end;
    } else i++;
  }
  return spans;
}

function quantityBefore(tokens: string[], start: number, minIdx: number, taken: Set<number> = new Set()): { quantity: QuantityLevel; custom?: string; consumed: number[] } | undefined {
  let from = Math.max(minIdx, start - 4);
  for (let k = start - 1; k >= from; k--) if (taken.has(k)) {
    from = k + 1;
    break;
  }
  const win = tokens.slice(from, start);
  // Palabras de tamaño tienen prioridad ("un plato grande de…", "media porción")
  for (let j = win.length - 1; j >= 0; j--) {
    const w = win[j];
    const two = `${win[j - 1] ?? ''} ${w}`;
    if (two === 'un poco' || SMALL.test(w)) return { quantity: 'poca', consumed: [from + j] };
    if (LARGE.test(w)) return { quantity: 'abundante', consumed: [from + j] };
  }
  // NUM UNIDAD (de)
  for (let j = 0; j < win.length; j++) {
    const n = win[j];
    if (/^\d+(:\d+)?$/.test(n) || n === 'media' || n === 'medio' || n === 'un' || n === 'una') {
      const unit = win[j + 1];
      if (unit && UNITS.test(unit)) {
        const num = n === 'un' || n === 'una' ? '1' : n === 'media' || n === 'medio' ? '½' : n.replace(':', ',');
        if ((n === 'un' || n === 'una') && /^(plato|porcion|taza|vaso|pocillo)$/.test(unit)) return { quantity: 'normal', consumed: [from + j, from + j + 1] };
        if ((n === 'media' || n === 'medio') && /^(plato|porcion)$/.test(unit)) return { quantity: 'poca', consumed: [from + j, from + j + 1] };
        if (/^(plato|platos)$/.test(unit) && Number(n) >= 2) return { quantity: 'abundante', consumed: [from + j, from + j + 1] };
        return { quantity: 'personalizada', custom: `${num} ${unit}`, consumed: [from + j, from + j + 1] };
      }
      if (/^\d+$/.test(n) && j === win.length - 1 && Number(n) <= 20) {
        return { quantity: 'personalizada', custom: n, consumed: [from + j] };
      }
    }
  }
  for (let j = win.length - 1; j >= 0; j--) {
    const w = win[j];
    const two = `${win[j - 1] ?? ''} ${w}`;
    if (two === 'un poco' || SMALL.test(w)) return { quantity: 'poca', consumed: [from + j] };
    if (LARGE.test(w) || two === 'plato grande') return { quantity: 'abundante', consumed: [from + j] };
  }
  return undefined;
}

function prepAfter(tokens: string[], end: number, maxIdx: number): { prep: Preparation; idx: number[] } | undefined {
  for (let j = end; j < Math.min(maxIdx, end + 4); j++) {
    const w = tokens[j];
    if (w === 'a' && tokens[j + 1] === 'la' && tokens[j + 2] === 'plancha') return { prep: 'asado', idx: [j, j + 1, j + 2] };
    if (w === 'al' && tokens[j + 1] === 'vapor') return { prep: 'al_vapor', idx: [j, j + 1] };
    if (w === 'al' && tokens[j + 1] === 'horno') return { prep: 'horneado', idx: [j, j + 1] };
    if (w === 'en' && tokens[j + 1] === 'salsa') return { prep: 'guisado', idx: [j, j + 1] };
    for (const [re, p] of PREP_WORDS) if (re.test(w)) return { prep: p, idx: [j] };
  }
  return undefined;
}

function quantityAfter(tokens: string[], end: number, maxIdx: number): { quantity: QuantityLevel; idx: number } | undefined {
  for (let j = end; j < Math.min(maxIdx, end + 2); j++) {
    if (LARGE.test(tokens[j])) return { quantity: 'abundante', idx: j };
    if (/^(poquito|poquita|poquitos)$/.test(tokens[j])) return { quantity: 'poca', idx: j };
  }
  return undefined;
}

const EATING = /\b(comi|comimos|me comi|desayune|almorce|cene|merende|tome|me tome|tomamos|probe|pique|picamos|bebi|me bebi|almuerzo|desayuno|cena|onces|merienda|mecato|de comida)\b/;

function parseMealClause(clause: string, lex: Map<string, LexEntry>): { items: DraftItem[]; unknownAllowed: boolean } {
  const tokens = clause.split(' ').filter(Boolean);
  const spans = findFoods(tokens, lex);
  const consumed = new Set<number>();
  const items: DraftItem[] = [];
  spans.forEach((sp, idx) => {
    for (let k = sp.start; k < sp.end; k++) consumed.add(k);
    const prevEnd = idx > 0 ? spans[idx - 1].end : 0;
    const nextStart = idx < spans.length - 1 ? spans[idx + 1].start : tokens.length;
    const q = quantityBefore(tokens, sp.start, prevEnd, consumed);
    q?.consumed.forEach((k) => consumed.add(k));
    const qa = q ? undefined : quantityAfter(tokens, sp.end, nextStart);
    if (qa) consumed.add(qa.idx);
    const p = prepAfter(tokens, sp.end, nextStart);
    p?.idx.forEach((k) => consumed.add(k));
    const existing = items.find((x) => x.key === sp.entry.key);
    if (existing) return;
    items.push({
      name: sp.entry.name,
      key: sp.entry.key,
      quantity: q?.quantity ?? qa?.quantity ?? 'normal',
      customQuantity: q?.custom,
      preparation: p?.prep,
      ingredients: sp.entry.ingredients ? [...sp.entry.ingredients] : undefined,
      known: sp.entry.known,
      explicitQty: !!(q || qa),
    });
  });

  // Alimentos desconocidos: sólo si la cláusula habla de comer o ya tiene alimentos.
  const unknownAllowed = spans.length > 0 || EATING.test(clause);
  if (unknownAllowed) {
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 1 && run.length <= 3) {
        const words = run.map((k) => tokens[k]);
        if (!words.every((w) => /^\d/.test(w))) {
          const name = prettyName(words.join(' '));
          const key = foodKey(name);
          // Palabras ambiguas descartadas por contexto ("vino mi mamá") no vuelven como desconocidas
          if (key.length >= 3 && !items.some((x) => x.key === key) && !(words.length === 1 && AMBIGUOUS_FOODS[key])) {
            const q = quantityBefore(tokens, run[0], 0);
            const p = prepAfter(tokens, run[run.length - 1] + 1, tokens.length);
            items.push({ name, key, quantity: q?.quantity ?? 'normal', customQuantity: q?.custom, preparation: p?.prep, known: false, explicitQty: !!q });
          }
        }
      }
      run = [];
    };
    tokens.forEach((w, k) => {
      const isNoise =
        consumed.has(k) ||
        STOP.has(w) ||
        /^\d+(:\d+)?$/.test(w) ||
        UNITS.test(w) ||
        SMALL.test(w) ||
        LARGE.test(w) ||
        PREP_WORDS.some(([re]) => re.test(w)) ||
        w.length <= 2 ||
        /^(desayun|almorz|almorc|cen|merend|com|tom|beb)\w*$/.test(w);
      if (isNoise) flush();
      else run.push(k);
    });
    flush();
  }
  return { items, unknownAllowed };
}

// ───────────────────────── Intenciones ─────────────────────────

const CONFIRM_RE = /^(si|sii|sip|claro|claro que si|correcto|dale|listo|ok|okay|okey|exacto|eso es todo|es todo|asi es|perfecto|guardar|guardalo|guardala|guarda|guardelo|confirmo|de una|hagale|bueno|ya|eso|esta bien|todo bien|correcto guardalo|si guardalo|si senor|afirmativo|si eso es todo|listo guardalo|si por favor)( por favor| gracias)?$/;
const NO_RE = /^(no|nop|nones|negativo|nada|nada mas|no gracias|ninguno|ninguna|no eso no|no es)$/;
const CANCEL_RE = /\b(cancela|cancelar|cancelalo|olvidalo|olvida eso|borra todo|empecemos de nuevo|empieza de nuevo|descarta|descartalo)\b/;
const SKIP_RE = /^(omitir|omite|saltar|salta|siguiente|no se|no me acuerdo|no recuerdo|ni idea|paso|da igual|no importa)$/;
const REMOVE_RE = /\b(quita|quitale|quitar|borra|borrale|elimina|saca|no era|no comi|sin el|sin la|sin los|sin las|menos el|menos la)\b\s*(?:el |la |los |las |lo |de )?(.+)$/;

// ───────────────────────── Función principal ─────────────────────────

/** Separa en cláusulas por puntuación y conectores. */
export function splitClauses(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[.;!?\n]+|,|\b y luego\b|\b luego\b(?! de)|\b despues\b(?! de)|\b después\b(?! de)|\b pero\b|\b entonces\b|\b y me\b|\b y tuve\b|\b y fui\b|\b y hice\b|\by (?=(?:me|tuve|fui|hice|sali|salio)\b)/)
    .map((c) => normalize(c))
    .filter(Boolean);
}

let cachedLex: { sig: string; lex: Map<string, LexEntry> } | null = null;

export function parseUtterance(raw: string, ctx: ParseContext): ParseResult {
  const res: ParseResult = { meals: [], symptoms: [], stools: [], removals: [], empty: true };
  const whole = normalize(raw);
  if (!whole) return res;

  const sig = (ctx.extraFoods ?? []).map((e) => e.key).join('|');
  if (!cachedLex || cachedLex.sig !== sig) cachedLex = { sig, lex: buildLexicon(ctx.extraFoods) };
  const lex = cachedLex.lex;

  // Intenciones de frase completa
  if (CANCEL_RE.test(whole)) {
    res.intent = 'cancel';
    res.empty = false;
    return res;
  }
  if (CONFIRM_RE.test(whole)) {
    res.intent = 'confirm';
    res.empty = false;
    return res;
  }
  if (NO_RE.test(whole)) {
    res.intent = 'no';
    res.empty = false;
    return res;
  }
  if (SKIP_RE.test(whole)) {
    res.intent = 'skip';
    res.empty = false;
    return res;
  }
  const lone = whole.match(/^(?:tipo |el |la |un |una |como un |como una )?(\d{1,2})(?: de 10| sobre 10)?$/);
  if (lone) res.number = Number(lone[1]);

  // Quitar alimentos
  const rm = whole.match(REMOVE_RE);
  if (rm) {
    const spans = findFoods(rm[2].split(' '), lex);
    if (spans.length) res.removals = spans.map((s) => s.entry.key);
    else res.removals = [foodKey(rm[2])];
    res.empty = false;
    if (!/\b(y|tambien|ademas)\b/.test(rm[2])) return res;
  }

  // Agua
  const water = whole.match(/\b(\d+|un|una|medio|media) (vasos?|botellas?|botellitas?|litros?) de agua\b/);
  if (water) {
    const n = water[1] === 'un' || water[1] === 'una' ? 1 : water[1] === 'medio' || water[1] === 'media' ? 0.5 : Number(water[1]);
    const mult = /botell/.test(water[2]) ? 2 : /litro/.test(water[2]) ? 4 : 1;
    res.water = Math.max(1, Math.round(n * mult));
  } else if (/\b(tome|me tome|bebi) agua\b/.test(whole)) res.water = 1;

  // Digestión del día
  const dig = whole.match(/\bdigestion\b.*?\b(excelente|muy bien|super bien|bien|regular|mas o menos|muy mal|mal|pesima|horrible|fatal)\b/);
  if (dig) {
    const w = dig[1];
    res.digestion = /excelente|muy bien|super bien/.test(w) ? 5 : w === 'bien' ? 4 : /regular|mas o menos/.test(w) ? 3 : w === 'mal' ? 2 : 1;
  }

  const clauses = splitClauses(raw);
  let current: DraftMeal | null = null;
  let lastKind: 'meal' | 'stool' | 'symptom' | null = null;
  const now = ctx.now;

  for (const c0 of clauses) {
    const c = c0.replace(/\b(\d+|un|una|medio|media) (vasos?|botellas?|botellitas?|litros?) de agua\b/g, ' ').replace(/\b(tome|me tome|bebi) agua\b/g, ' ');
    if (dig && /\bdigestion\b/.test(c)) continue;

    // Deposiciones (y detalles en cláusulas siguientes: "…, con un poquito de sangre")
    const stoolExtra = lastKind === 'stool' && !EATING.test(c) ? parseStool(c, now) : undefined;
    const stoolDetail = stoolExtra && (stoolExtra.bristol || stoolExtra.color || stoolExtra.blood || stoolExtra.mucus || stoolExtra.urgency || stoolExtra.incomplete || stoolExtra.effort || stoolExtra.pain);
    if (STOOL_TRIGGER.test(c) || stoolDetail) {
      if (STOOL_TRIGGER.test(c)) res.stools.push(parseStool(c, now));
      else {
        const prev = res.stools[res.stools.length - 1];
        for (const [k, v] of Object.entries(stoolExtra!)) {
          if (v === undefined || k === 'timeExplicit' || k === 'at') continue;
          (prev as unknown as Record<string, unknown>)[k] = v;
        }
      }
      lastKind = 'stool';
      continue;
    }

    // Intensidad o estado dichos aparte: "…, como un 6", "…, todavía me duele"
    if (lastKind === 'symptom' && res.symptoms.length) {
      const extraInt = intensityIn(c);
      const onlyDetail = !EATING.test(c) && !detectMealType(c);
      const newSyms = parseSymptoms(c, now);
      if (onlyDetail && extraInt !== undefined && !newSyms.some((x) => !res.symptoms.some((y) => y.type === x.type))) {
        for (const x of res.symptoms) if (x.intensity === undefined) x.intensity = extraInt;
      }
    }

    const mealType = detectMealType(c);
    const feeling = feelingIn(c);
    const forSymptoms = c.replace(/\b(agua )?con gas\b/g, ' ').replace(FEELING_RE, ' ');
    let syms = parseSymptoms(forSymptoms, now);
    // "fui al baño y me dolió": el dolor pertenece a la deposición
    if (lastKind === 'stool' && syms.length && syms.every((x) => x.type === 'dolor') && !EATING.test(c)) {
      const prev = res.stools[res.stools.length - 1];
      prev.pain = true;
      prev.painIntensity = syms[0].intensity ?? prev.painIntensity;
      syms = [];
      continue;
    }
    let forFood = c;
    for (const [re] of SUPPLEMENTS) forFood = forFood.replace(re, ' ');
    const { items } = parseMealClause(syms.length ? '' : forFood, lex);
    const supplements = SUPPLEMENTS.filter(([re]) => re.test(c)).map(([, name]) => name);

    if (syms.length) {
      for (const x of syms) {
        const prev = res.symptoms.find((y) => y.type === x.type && y.customName === x.customName);
        if (!prev) {
          res.symptoms.push(x);
          continue;
        }
        if (prev.intensity === undefined) prev.intensity = x.intensity;
        if (!prev.timeExplicit && x.timeExplicit) {
          prev.at = x.at;
          prev.timeExplicit = true;
        }
        if (x.status !== 'desconocido') prev.status = x.status;
        prev.location ??= x.location;
        prev.durationMin ??= x.durationMin;
        prev.afterMeal ??= x.afterMeal;
      }
      // Varios síntomas en la misma frase comparten la intensidad dicha
      const shared = syms.find((x) => x.intensity !== undefined)?.intensity;
      if (shared !== undefined) for (const x of syms) x.intensity ??= shared;
      lastKind = 'symptom';
    }

    const timeForMeal = items.length || mealType ? parseTime(c, now, mealType) : undefined;
    if (items.length || supplements.length || (mealType && !syms.length)) {
      const startNew = !current || (mealType && current.mealType && mealType !== current.mealType) || (timeForMeal !== undefined && current.timeExplicit && Math.abs((current.at ?? 0) - timeForMeal) > HOUR);
      if (startNew) {
        current = { mealType, mealTypeExplicit: !!mealType, at: timeForMeal, timeExplicit: timeForMeal !== undefined, items: [], supplements: [] };
        res.meals.push(current);
      }
      const m = current!;
      if (mealType && !m.mealType) {
        m.mealType = mealType;
        m.mealTypeExplicit = true;
      }
      if (timeForMeal !== undefined && !m.timeExplicit) {
        m.at = timeForMeal;
        m.timeExplicit = true;
      }
      for (const it of items) if (!m.items.some((x) => x.key === it.key)) m.items.push(it);
      for (const s of supplements) if (!m.supplements.includes(s)) m.supplements.push(s);
      if (feeling) m.feelingAfter = feeling;
      lastKind = 'meal';
    } else if (feeling) {
      if (current) current.feelingAfter = feeling;
      else res.feelingOnly = feeling;
    }
  }

  // Comidas sin alimentos (sólo "almorcé a la 1"): se convierten en datos sueltos
  const emptyMeals = res.meals.filter((m) => !m.items.length && !m.supplements.length);
  res.meals = res.meals.filter((m) => m.items.length || m.supplements.length);
  for (const m of emptyMeals) {
    if (m.mealType && res.mealTypeOnly === undefined) res.mealTypeOnly = m.mealType;
    if (m.timeExplicit && res.timeOnly === undefined) res.timeOnly = m.at;
    if (m.feelingAfter && res.feelingOnly === undefined) res.feelingOnly = m.feelingAfter;
  }

  // Frases sin alimentos: actualizar campos sueltos
  if (!res.meals.length && !res.symptoms.length && !res.stools.length) {
    const mt = detectMealType(whole);
    if (mt) res.mealTypeOnly = mt;
    const t = parseTime(whole, now, mt ?? res.mealTypeOnly);
    if (t !== undefined && res.timeOnly === undefined) res.timeOnly = t;
    const f = feelingIn(whole);
    if (f) res.feelingOnly = f;
    const toks = whole.split(' ');
    if (toks.some((w) => SMALL.test(w)) || /\bun poco\b/.test(whole)) res.quantityOnly = 'poca';
    else if (toks.some((w) => LARGE.test(w))) res.quantityOnly = 'abundante';
    else if (/\b(normal|normales)\b/.test(whole)) res.quantityOnly = 'normal';
  }

  res.empty =
    !res.meals.length &&
    !res.symptoms.length &&
    !res.stools.length &&
    res.water === undefined &&
    res.digestion === undefined &&
    !res.removals.length &&
    res.mealTypeOnly === undefined &&
    res.timeOnly === undefined &&
    res.feelingOnly === undefined &&
    res.quantityOnly === undefined &&
    res.number === undefined;
  return res;
}

