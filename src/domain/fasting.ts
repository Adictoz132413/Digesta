/**
 * Ayuno intermitente: protocolos, fases, precauciones y planificación.
 *
 * Contenido basado en la evidencia disponible (resumen):
 *  - Para bajar de peso, el ayuno intermitente rinde en general igual que reducir
 *    calorías de forma continua (metaanálisis en red, BMJ 2025;389:e082007).
 *  - El "cambio metabólico" de glucosa a grasa/cetonas ocurre entre ~12 y 36 h
 *    de ayuno y varía mucho entre personas (Anton et al., Obesity 2018).
 *  - La "autofagia a las 16 h" no está demostrada en humanos: la evidencia es
 *    sobre todo animal o indirecta.
 *  - El 16:8 es compatible con ganar músculo si se entrena y se come suficiente
 *    proteína (≈1,6–2,2 g/kg/día) (JISSN 2025, PMC12006946).
 *  - En la digestión, el efecto es individual: comidas muy grandes al romper el
 *    ayuno pueden causar hinchazón, y el ayuno puede empeorar reflujo o
 *    estreñimiento en algunas personas. Por eso DIGESTA compara tus días.
 */
import { HOUR } from './dates';
import type { Fast, FastProtocol, Meal } from './types';
import { foodKey } from './foods';

export interface ProtocolInfo {
  value: FastProtocol;
  label: string;
  fastHours: number;
  level: string;
  description: string;
}

export const PROTOCOLS: ProtocolInfo[] = [
  { value: '12:12', label: '12:12', fastHours: 12, level: 'Inicio', description: '12 horas sin comer, casi todo mientras duermes. Ideal para empezar y observar cómo responde tu digestión.' },
  { value: '14:10', label: '14:10', fastHours: 14, level: 'Intermedio', description: 'Cena temprano y desayuna un poco más tarde. Buen siguiente paso si el 12:12 te fue bien.' },
  { value: '16:8', label: '16:8', fastHours: 16, level: 'Clásico', description: 'El esquema más estudiado. Compatible con entrenar si comes suficiente proteína dentro de la ventana.' },
  { value: '18:6', label: '18:6', fastHours: 18, level: 'Avanzado', description: 'Ventana corta de comida. Puede costar cubrir la proteína y energía si entrenas fuerte.' },
  { value: 'personalizado', label: 'A tu medida', fastHours: 13, level: 'De 8 a 24 h', description: 'Elige tú las horas, entre 8 y 24.' },
];

export const protocolInfo = (p: FastProtocol) => PROTOCOLS.find((x) => x.value === p) ?? PROTOCOLS[0];

export function targetHoursFor(p: FastProtocol, customHours: number): number {
  return p === 'personalizado' ? customHours : protocolInfo(p).fastHours;
}

// ───────── Fases (descripción prudente) ─────────

export interface FastPhase {
  from: number;
  to: number;
  title: string;
  description: string;
}

export const PHASES: FastPhase[] = [
  { from: 0, to: 4, title: 'Digestión', description: 'Tu cuerpo todavía está usando la energía de la última comida.' },
  { from: 4, to: 12, title: 'Usando reservas', description: 'Baja la insulina y el hígado libera glucosa de sus reservas (glucógeno).' },
  { from: 12, to: 18, title: 'Más grasa como combustible', description: 'Empieza a usarse más grasa. Ese "cambio metabólico" ocurre entre 12 y 36 horas y varía mucho entre personas.' },
  { from: 18, to: 24, title: 'Cetonas en aumento', description: 'Las cetonas suben poco a poco. Escucha a tu cuerpo: si te sientes mal, rompe el ayuno.' },
];

export function phaseAt(hours: number): FastPhase {
  return PHASES.find((p) => hours >= p.from && hours < p.to) ?? PHASES[PHASES.length - 1];
}

export const PHASE_NOTE =
  'Estas fases son aproximadas. Afirmaciones populares como "la autofagia empieza a las 16 horas" no están demostradas en personas.';

// ───────── Precauciones ─────────

export const NOT_WITHOUT_PROFESSIONAL = [
  'Embarazo o lactancia.',
  'Diabetes tratada con insulina o con medicamentos que bajan el azúcar (riesgo de hipoglucemia).',
  'Historia actual o pasada de trastornos de la conducta alimentaria (anorexia, bulimia, atracones).',
  'Bajo peso o pérdida de peso sin explicación.',
  'Menores de 18 años.',
  'Enfermedad renal, hepática o cardíaca, o medicamentos que deben tomarse con comida.',
];

export const STOP_SIGNS =
  'Rompe el ayuno y come algo si sientes mareo fuerte, desmayo, palpitaciones, confusión, temblor, sudor frío o mucha debilidad. Si no mejora, busca atención médica.';

export const ALLOWED_DURING_FAST = [
  'Agua (también con gas) y aromáticas sin azúcar.',
  'Tinto o café negro y té, sin azúcar, leche ni crema.',
  'Electrolitos sin azúcar ni edulcorantes, si sudas mucho.',
  'Creatina monohidratada sola (sin sabores ni azúcares).',
];

export const BREAK_FAST_TIPS = [
  'Rompe el ayuno con una comida moderada, no con el plato más grande del día: las comidas muy grandes después de ayunar pueden causar hinchazón o pesadez.',
  'Prioriza proteína (huevo, pollo, pescado, yogur, fríjoles en porción moderada) y algo de fibra. Deja frituras y picante fuerte para más tarde y observa cómo te caen.',
  'Come despacio y regístralo en DIGESTA: así verás si romper el ayuno te sienta distinto.',
];

export const TRAINING_TIPS = [
  'Si entrenas, procura que el entreno quede al final del ayuno o dentro de la ventana de comida, y come proteína después.',
  'Reparte la proteína en 2 o 3 comidas dentro de la ventana; en estudios con 16:8 se mantuvo la masa muscular con alrededor de 1,6–2,2 g por kg al día.',
  'Hidrátate bien y no hagas ayunos largos el día de un entreno muy exigente si no te sientes bien.',
];

export const DIGESTIVE_NOTE =
  'En la digestión el efecto es muy personal: a algunas personas el ayuno las alivia y a otras les aumenta el reflujo, la acidez o el estreñimiento. DIGESTA compara tus días con y sin ayuno para que lo veas con tus datos.';

// ───────── Planificación ─────────

export interface FastPlan {
  /** Última comida = inicio del ayuno. */
  startAt: number;
  /** Primera comida = fin del ayuno. */
  endAt: number;
  /** Fin de la ventana de comida siguiente. */
  windowEndAt: number;
  targetHours: number;
}

/** Plan a partir de la hora de la última comida. */
export function planFrom(startAt: number, targetHours: number): FastPlan {
  const endAt = startAt + targetHours * HOUR;
  return { startAt, endAt, targetHours, windowEndAt: endAt + (24 - targetHours) * HOUR };
}

/** Siguiente ocurrencia de una hora del día (HH:mm) a partir de `now`. */
export function nextTimeOfDay(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() < now - 5 * 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// ───────── Estado de un ayuno ─────────

export type FastState = 'programado' | 'en_curso' | 'completado' | 'interrumpido';

export function fastState(f: Fast, now: number): FastState {
  if (f.endAt !== undefined) return (f.endAt - f.startAt) / HOUR >= f.targetHours - 0.25 ? 'completado' : 'interrumpido';
  return f.startAt > now ? 'programado' : 'en_curso';
}

export function elapsedHours(f: Fast, now: number): number {
  return Math.max(0, ((f.endAt ?? now) - f.startAt) / HOUR);
}

/** Bebidas que no rompen el ayuno (si no llevan leche ni azúcar). */
const FAST_SAFE = new Set(['agua', 'agua con gas', 'tinto', 'cafe', 'cafe negro', 'aromatica', 'te'].map(foodKey));

export function mealBreaksFast(m: Pick<Meal, 'items' | 'flags'>): boolean {
  if (m.flags.includes('lacteos') || m.flags.includes('azucar') || m.flags.includes('alcohol')) return true;
  return !m.items.every((i) => FAST_SAFE.has(i.key));
}

export const SIDE_EFFECTS = ['Hambre fuerte', 'Mareo', 'Dolor de cabeza', 'Irritabilidad', 'Cansancio', 'Acidez', 'Buena concentración', 'Me sentí ligero'];
