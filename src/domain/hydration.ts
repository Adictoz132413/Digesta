/**
 * Hidratación: tres formas de registrarla según cómo tomas agua.
 *  - A sorbos: un estimado rápido del día (poca, normal, bastante).
 *  - Botella: fracciones de tu botella (¼, ½, ¾…).
 *  - Vasos: vasos de unos 250 ml.
 * Internamente la cantidad se guarda en "vasos" de 250 ml (con decimales).
 */
import type { DailyLog, HydrationLevel, HydrationMode } from './types';

export const GLASS_ML = 250;

export const HYDRATION_MODES: { value: HydrationMode; label: string; description: string }[] = [
  { value: 'sorbos', label: 'A sorbos', description: 'Tomas agua poco a poco durante el día: basta con un estimado.' },
  { value: 'botella', label: 'En botella', description: 'Llevas una botella y cuentas cuánto de ella te tomaste.' },
  { value: 'vasos', label: 'Por vasos', description: 'Cuentas vasos de unos 250 ml.' },
];

export const HYDRATION_LEVELS: { value: HydrationLevel; label: string; emoji: string; tone: 'bad' | 'mid' | 'good' }[] = [
  { value: 1, label: 'Poca', emoji: '💧', tone: 'mid' },
  { value: 2, label: 'Normal', emoji: '💧💧', tone: 'good' },
  { value: 3, label: 'Bastante', emoji: '💧💧💧', tone: 'good' },
];

export const hydrationLabel = (h?: HydrationLevel) => HYDRATION_LEVELS.find((x) => x.value === h)?.label ?? '';

export const BOTTLE_SIZES = [500, 600, 750, 1000, 1500];

export const URINE_TIP = 'Una pista práctica: si tu orina es de color amarillo claro durante el día, sueles estar bien hidratado; si es oscura, toma un poco más.';

/** "750 ml" o "1,5 L". */
export function formatMl(ml: number): string {
  if (ml < 1000) return `${Math.round(ml / 10) * 10} ml`;
  return `${(Math.round(ml / 100) / 10).toLocaleString('es-CO')} L`;
}

export const glassesToMl = (glasses: number) => glasses * GLASS_ML;
export const mlToGlasses = (ml: number) => Math.round((ml / GLASS_ML) * 100) / 100;

/** Botellas en cuartos legibles: 1.75 → "1 ¾". */
export function formatBottles(n: number): string {
  const q = Math.round(n * 4) / 4;
  const whole = Math.floor(q);
  const frac = q - whole;
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  if (!whole && !f) return '0';
  return [whole || '', f].filter(Boolean).join(' ');
}

/** Resumen corto para calendario, informes y CSV. */
export function hydrationSummary(log?: Pick<DailyLog, 'water' | 'hydration'>): string {
  const parts: string[] = [];
  if (log?.water) parts.push(`≈ ${formatMl(glassesToMl(log.water))}`);
  if (log?.hydration) parts.push(`${hydrationLabel(log.hydration).toLowerCase()} (estimado)`);
  return parts.join(' · ');
}
