/**
 * Ayuno y digestión: compara tus registros en días con ayuno frente a días sin
 * ayuno, y las molestias después de la comida que rompe el ayuno frente a las
 * demás comidas. Describe asociaciones, no causas.
 */
import { dayKey, HOUR } from '@/domain/dates';
import { symptomLabel } from '@/domain/labels';
import type { DailyLog, Fast, Meal, Stool, Symptom } from '@/domain/types';

export interface GroupRate {
  n: number;
  followed: number;
  rate: number;
}

export interface DayStats {
  days: number;
  symptomDayRate: number;
  avgDigestion: number | null;
  softStoolDayRate: number;
  hardStoolDayRate: number;
}

export interface FastingDigestion {
  fasts: number;
  completed: number;
  avgHours: number;
  /** Comidas que rompieron un ayuno: ¿siguió alguna molestia en 0–6 h? */
  breakMeals: GroupRate;
  otherMeals: GroupRate;
  /** Síntomas más frecuentes tras romper el ayuno. */
  breakSymptoms: { label: string; count: number }[];
  withFast: DayStats;
  withoutFast: DayStats;
  enough: boolean;
  message: string;
}

const rate = (n: number, k: number): GroupRate => ({ n, followed: k, rate: n ? k / n : 0 });
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function analyzeFasting(input: { fasts: Fast[]; meals: Meal[]; symptoms: Symptom[]; stools: Stool[]; logs: DailyLog[]; threshold?: number; now?: number }): FastingDigestion {
  const now = input.now ?? Date.now();
  const threshold = input.threshold ?? 3;
  const done = input.fasts.filter((f) => f.endAt !== undefined && f.endAt <= now);
  const completed = done.filter((f) => (f.endAt! - f.startAt) / HOUR >= f.targetHours - 0.25);
  const avgHours = done.length ? done.reduce((a, f) => a + (f.endAt! - f.startAt) / HOUR, 0) / done.length : 0;

  const meals = [...input.meals].sort((a, b) => a.at - b.at);
  const episodes = input.symptoms.filter((s) => s.intensity >= threshold).sort((a, b) => a.startedAt - b.startedAt);
  const softStools = input.stools.filter((s) => s.bristol >= 6);
  const followedBy = (m: Meal) => {
    const syms = episodes.filter((s) => s.startedAt >= m.at && s.startedAt < m.at + 6 * HOUR);
    const soft = softStools.some((s) => s.at >= m.at && s.at < m.at + 6 * HOUR);
    const feel = m.feelingAfter === 'molesto' || m.feelingAfter === 'mal';
    return { hit: syms.length > 0 || soft || feel, syms };
  };

  // Comida que rompe cada ayuno: la indicada o la primera hasta 2 h después del fin
  const breakIds = new Set<string>();
  for (const f of done) {
    const m = (f.brokenByMealId && meals.find((x) => x.id === f.brokenByMealId)) || meals.find((x) => x.at >= f.endAt! - 10 * 60_000 && x.at <= f.endAt! + 2 * HOUR);
    if (m) breakIds.add(m.id);
  }
  const complete = meals.filter((m) => m.at + 6 * HOUR <= now);
  const breaks = complete.filter((m) => breakIds.has(m.id));
  const others = complete.filter((m) => !breakIds.has(m.id) && m.mealType !== 'bebida');
  const symCount = new Map<string, number>();
  let breakHits = 0;
  for (const m of breaks) {
    const r = followedBy(m);
    if (r.hit) breakHits++;
    for (const s of r.syms) {
      const l = symptomLabel(s.type, s.customName);
      symCount.set(l, (symCount.get(l) ?? 0) + 1);
    }
  }
  const otherHits = others.filter((m) => followedBy(m).hit).length;

  // Días: con ayuno = un ayuno de ≥ 12 h terminó ese día
  const fastDays = new Set(done.filter((f) => (f.endAt! - f.startAt) / HOUR >= 12).map((f) => dayKey(f.endAt!)));
  const trackedDays = new Set(meals.map((m) => dayKey(m.at)));
  const logs = new Map(input.logs.map((l) => [l.day, l]));
  const stats = (days: string[]): DayStats => {
    if (!days.length) return { days: 0, symptomDayRate: 0, avgDigestion: null, softStoolDayRate: 0, hardStoolDayRate: 0 };
    let sym = 0;
    let dig = 0;
    let rated = 0;
    let soft = 0;
    let hard = 0;
    for (const d of days) {
      if (episodes.some((s) => dayKey(s.startedAt) === d)) sym++;
      const l = logs.get(d)?.digestion;
      if (l) {
        dig += l;
        rated++;
      }
      const st = input.stools.filter((s) => dayKey(s.at) === d);
      if (st.some((s) => s.bristol >= 6)) soft++;
      if (st.some((s) => s.bristol <= 2)) hard++;
    }
    return { days: days.length, symptomDayRate: sym / days.length, avgDigestion: rated ? dig / rated : null, softStoolDayRate: soft / days.length, hardStoolDayRate: hard / days.length };
  };
  const withFast = stats([...trackedDays].filter((d) => fastDays.has(d)));
  const withoutFast = stats([...trackedDays].filter((d) => !fastDays.has(d)));
  const breakMeals = rate(breaks.length, breakHits);
  const otherMeals = rate(others.length, otherHits);
  const enough = breaks.length >= 3 && others.length >= 5;

  let message: string;
  if (!done.length) message = 'Aún no has terminado ningún ayuno. Cuando hagas algunos, aquí verás cómo responde tu digestión.';
  else if (!enough)
    message = `Llevas ${done.length} ${done.length === 1 ? 'ayuno' : 'ayunos'}. Se necesitan al menos 3 comidas de ruptura registradas para comparar; por ahora son observaciones aisladas.`;
  else {
    const diff = breakMeals.rate - otherMeals.rate;
    const base = `Después de romper el ayuno registraste molestias en ${breakMeals.followed} de ${breakMeals.n} ocasiones (${pct(breakMeals.rate)}); después de otras comidas, en ${pct(otherMeals.rate)}.`;
    message =
      diff >= 0.2 && breakMeals.followed >= 2
        ? `${base} Romper el ayuno parece sentarte peor: prueba con una comida más pequeña o diferente y observa si cambia. No es un diagnóstico.`
        : diff <= -0.2
          ? `${base} Por ahora, romper el ayuno no parece causarte más molestias que otras comidas.`
          : `${base} No se ve una diferencia clara.`;
  }

  return {
    fasts: done.length,
    completed: completed.length,
    avgHours,
    breakMeals,
    otherMeals,
    breakSymptoms: [...symCount.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 4),
    withFast,
    withoutFast,
    enough,
    message,
  };
}
