import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, openDbForTests } from '@/db/db';
import { endFast, maybeEndFastWithMeal, openFast, reopenFast, startFast } from '@/db/fasting';
import { saveMeal, ValidationError } from '@/db/repo';
import { exportBackupJson, importBackup } from '@/db/backup';
import { fastsCsv } from '@/db/csv';
import { analyzeFasting } from '@/analysis/fasting';
import { fastState, mealBreaksFast, phaseAt, planFrom } from '@/domain/fasting';
import { parseUtterance } from '@/voice/nlu';
import { seedDemo } from '@/db/demo';
import { loadAll } from '@/db/repo';
import { emptySession, handleUtterance } from '@/voice/dialog';
import type { Fast, Meal, Symptom } from '@/domain/types';

const H = 3600_000;
let n = 0;
beforeEach(() => {
  openDbForTests(`test-fast-${n++}`);
});

describe('ayunos: persistencia', () => {
  it('inicia, impide dos a la vez y termina', async () => {
    const f = await startFast({ startAt: Date.now() - 10 * H, targetHours: 16, protocol: '16:8' });
    await expect(startFast({ startAt: Date.now(), targetHours: 12, protocol: '12:12' })).rejects.toBeInstanceOf(ValidationError);
    expect((await openFast())?.id).toBe(f.id);
    const done = await endFast(f.id, Date.now(), { hunger: 6, energy: 2, sideEffects: ['Hambre fuerte'] });
    expect(done.endAt).toBeGreaterThan(done.startAt);
    expect(await openFast()).toBeUndefined();
  });

  it('valida duraciones fuera de rango', async () => {
    await expect(startFast({ startAt: Date.now(), targetHours: 36, protocol: 'personalizado' })).rejects.toThrow(/24 horas/);
  });

  it('una comida que rompe el ayuno lo termina; agua o tinto no', async () => {
    const f = await startFast({ startAt: Date.now() - 14 * H, targetHours: 14, protocol: '14:10' });
    const tinto = await saveMeal({ at: Date.now() - H, mealType: 'bebida', items: [{ name: 'Tinto', key: 'tinto', quantity: 'normal' }], flags: ['cafe', 'cafeina'], supplements: [] });
    expect(await maybeEndFastWithMeal(tinto)).toBeUndefined();
    const arepa = await saveMeal({ at: Date.now() - 10 * 60_000, mealType: 'desayuno', items: [{ name: 'Arepa', key: 'arepa', quantity: 'normal' }], flags: [], supplements: [] });
    const ended = await maybeEndFastWithMeal(arepa);
    expect(ended?.id).toBe(f.id);
    expect(ended?.endAt).toBe(arepa.at);
    expect(ended?.brokenByMealId).toBe(arepa.id);
    await reopenFast(f.id);
    expect((await openFast())?.endAt).toBeUndefined();
  });

  it('se incluye en la copia de seguridad y en el CSV', async () => {
    const f = await startFast({ startAt: Date.now() - 16 * H, targetHours: 16, protocol: '16:8' });
    await endFast(f.id, Date.now());
    const json = await exportBackupJson();
    await getDb().fasts.clear();
    await importBackup(json, 'replace');
    const back = await getDb().fasts.toArray();
    expect(back).toHaveLength(1);
    expect(fastsCsv(back)).toContain('16:8');
  });

  it('acepta respaldos antiguos sin ayunos', async () => {
    const old = JSON.parse(await exportBackupJson());
    delete old.data.fasts;
    await expect(importBackup(JSON.stringify(old), 'replace')).resolves.toBeTruthy();
  });
});

describe('ayunos: lógica', () => {
  it('estados, fases y plan', () => {
    const now = Date.now();
    const base: Fast = { id: 'f', startAt: now - 5 * H, targetHours: 16, protocol: '16:8', createdAt: now, updatedAt: now };
    expect(fastState(base, now)).toBe('en_curso');
    expect(fastState({ ...base, startAt: now + H }, now)).toBe('programado');
    expect(fastState({ ...base, endAt: base.startAt + 16 * H }, now)).toBe('completado');
    expect(fastState({ ...base, endAt: base.startAt + 10 * H }, now)).toBe('interrumpido');
    expect(phaseAt(2).title).toBe('Digestión');
    expect(phaseAt(13).title).toContain('grasa');
    const p = planFrom(0, 16);
    expect(p.endAt).toBe(16 * H);
    expect(p.windowEndAt).toBe(24 * H);
  });

  it('qué rompe el ayuno', () => {
    expect(mealBreaksFast({ items: [{ name: 'Agua', key: 'agua', quantity: 'normal' }], flags: [] })).toBe(false);
    expect(mealBreaksFast({ items: [{ name: 'Tinto', key: 'tinto', quantity: 'normal' }], flags: ['azucar'] })).toBe(true);
    expect(mealBreaksFast({ items: [{ name: 'Café con leche', key: 'cafe con leche', quantity: 'normal' }], flags: ['lacteos'] })).toBe(true);
  });

  it('compara molestias tras romper el ayuno con otras comidas', () => {
    const T0 = new Date(2026, 9, 1).getTime();
    const now = T0 + 40 * 24 * H;
    const fasts: Fast[] = [];
    const meals: Meal[] = [];
    const symptoms: Symptom[] = [];
    const meal = (id: string, at: number): Meal => ({ id, at, mealType: 'almuerzo', items: [{ name: 'Arroz', key: 'arroz', quantity: 'normal' }], itemKeys: ['arroz'], flags: [], supplements: [], createdAt: at, updatedAt: at });
    for (let d = 0; d < 10; d++) {
      const day = T0 + d * 24 * H;
      if (d % 2 === 0) {
        const end = day + 12 * H;
        fasts.push({ id: `f${d}`, startAt: end - 16 * H, endAt: end, targetHours: 16, protocol: '16:8', createdAt: 0, updatedAt: 0 });
        meals.push(meal(`b${d}`, end + 5 * 60_000));
        symptoms.push({ id: `s${d}`, type: 'hinchazon', intensity: 6, startedAt: end + H, createdAt: 0, updatedAt: 0 });
        meals.push(meal(`c${d}`, day + 19 * H));
      } else {
        meals.push(meal(`d${d}`, day + 8 * H), meal(`a${d}`, day + 13 * H), meal(`c${d}`, day + 19 * H));
      }
    }
    const r = analyzeFasting({ fasts, meals, symptoms, stools: [], logs: [], now });
    expect(r.fasts).toBe(5);
    expect(r.completed).toBe(5);
    expect(r.breakMeals).toMatchObject({ n: 5, followed: 5 });
    expect(r.otherMeals.followed).toBe(0);
    expect(r.enough).toBe(true);
    expect(r.message).toContain('Romper el ayuno parece sentarte peor');
    expect(r.breakSymptoms[0].label).toContain('Hinchazón');
    expect(r.withFast.symptomDayRate).toBe(1);
    expect(r.withoutFast.symptomDayRate).toBe(0);
  });
});

describe('ayunos en los datos de demostración', () => {
  it('siembra ayunos 16:8 que el análisis puede comparar', async () => {
    const now = new Date(2026, 10, 14, 22, 0).getTime();
    const db = openDbForTests('test-demo-fast');
    await seedDemo(db, 60, now);
    const fasts = await db.fasts.toArray();
    expect(fasts.length).toBeGreaterThanOrEqual(12);
    expect(fasts.every((f) => f.endAt! > f.startAt && (f.endAt! - f.startAt) / H >= 15)).toBe(true);
    const r = analyzeFasting({ ...(await loadAll()), fasts, now });
    expect(r.enough).toBe(true);
    expect(r.breakMeals.n).toBe(fasts.length);
  });
});

describe('ayunos por voz', () => {
  const now = new Date(2026, 10, 15, 20, 0).getTime();
  it('entiende empezar y terminar el ayuno sin crear alimentos', () => {
    const a = parseUtterance('empiezo el ayuno', { now });
    expect(a.fast).toEqual({ kind: 'start', at: now });
    expect(a.meals).toHaveLength(0);
    const b = parseUtterance('empecé a ayunar a las 7 de la noche', { now });
    expect(b.fast?.at).toBe(new Date(2026, 10, 15, 19, 0).getTime());
    const c = parseUtterance('rompí el ayuno con una arepa y un tinto', { now });
    expect(c.fast?.kind).toBe('end');
    expect(c.meals[0].items.map((i) => i.key)).toEqual(['arepa', 'tinto']);
  });
  it('el diálogo devuelve la acción de ayuno', () => {
    const r = handleUtterance(emptySession(), 'voy a empezar el ayuno', { now });
    expect(r.fast?.kind).toBe('start');
  });
});

