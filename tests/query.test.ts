import { beforeEach, describe, expect, it } from 'vitest';
import { openDbForTests } from '@/db/db';
import { getSettings } from '@/db/repo';
import { addCustomReminder, takeDueReminders } from '@/db/customReminders';
import { answerQuery, detectQuery, detectReminder, parseFutureTime, parseRange, type QueryData } from '@/voice/query';
import { emptySession, handleChip, handleUtterance } from '@/voice/dialog';
import type { Meal, MealType, Symptom } from '@/domain/types';

const H = 3600_000;
const NOW = new Date(2026, 10, 16, 15, 0).getTime(); // lunes 16 nov 2026, 3:00 p. m.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

function meal(id: string, t: number, mealType: MealType, items: [string, string][]): Meal {
  return { id, at: t, mealType, items: items.map(([name, key]) => ({ name, key, quantity: 'normal' as const })), itemKeys: items.map(([, k]) => k), flags: [], supplements: [], createdAt: t, updatedAt: t };
}
const sym = (t: number, type: Symptom['type'], intensity: number): Symptom => ({ id: `s${t}`, type, intensity, startedAt: t, createdAt: t, updatedAt: t });
const data: QueryData = {
  meals: [
    meal('a', at(15, 19), 'cena', [['Salchipapa', 'salchipapa'], ['Gaseosa', 'gaseosa']]),
    meal('b', at(16, 13), 'almuerzo', [['Arroz con pollo', 'arroz con pollo']]),
    meal('c', at(11, 7, 30), 'desayuno', [['Café con leche', 'cafe con leche']]),
  ],
  symptoms: [sym(at(15, 21), 'acidez', 6)],
  stools: [],
  logs: [],
  fasts: [],
};
data.meals[2].items[0].ingredients = ['Café', 'Leche'];

describe('consultas sobre el diario', () => {
  it('«Recuérdame si ayer comí salchipapa» se responde, no se registra', () => {
    const q = detectQuery('Recuérdame si ayer comí salchipapa', NOW)!;
    expect(q.kind).toBe('ate');
    expect(q.range?.label).toBe('ayer');
    const a = answerQuery(q, data, NOW);
    expect(a).toContain('Sí. Ayer comiste salchipapa en la cena a las 7:00');
    expect(a).toContain('acidez 6/10');
    expect(a).not.toContain('..');
    const r = handleUtterance(emptySession(), 'Recuérdame si ayer comí salchipapa', { now: NOW });
    expect(r.query?.kind).toBe('ate');
    expect(r.session.meals).toHaveLength(0);
  });

  it('respuesta negativa con la última vez', () => {
    const q = detectQuery('¿hoy comí salchipapa?', NOW)!;
    expect(answerQuery(q, data, NOW)).toContain('No, hoy no registraste salchipapa. La última vez fue ayer');
  });

  it('última vez, incluso como ingrediente, y conteos', () => {
    const q = detectQuery('cuándo fue la última vez que comí leche', NOW)!;
    expect(q.kind).toBe('last_time');
    expect(answerQuery(q, data, NOW)).toContain('fue el miércoles 11 de noviembre (hace 5 días), en el desayuno');
    const c = detectQuery('cuántas veces comí salchipapa los últimos 7 días', NOW)!;
    expect(c.kind).toBe('count_food');
    expect(answerQuery(c, data, NOW)).toContain('comiste salchipapa 1 vez');
  });

  it('qué comí, síntomas, baño y digestión', () => {
    expect(answerQuery(detectQuery('qué cené ayer', NOW)!, data, NOW)).toBe('Ayer: cena a las 7:00 p. m.: salchipapa, gaseosa.');
    expect(answerQuery(detectQuery('qué síntomas tuve ayer', NOW)!, data, NOW)).toContain('acidez 6/10');
    expect(detectQuery('cuántas veces fui al baño esta semana', NOW)?.kind).toBe('stools');
    expect(detectQuery('cómo estuvo mi digestión la semana pasada', NOW)?.kind).toBe('digestion');
  });

  it('no confunde registros con preguntas', () => {
    expect(detectQuery('almorcé arroz con pollo', NOW)).toBeUndefined();
    expect(detectQuery('cuando almorcé me dio gases', NOW)).toBeUndefined();
    expect(detectQuery('como un 6', NOW)).toBeUndefined();
    expect(detectQuery('recuérdame tomar agua en 1 hora', NOW)).toBeUndefined();
  });

  it('rangos: días de la semana y fechas', () => {
    expect(parseRange('el sabado', NOW)?.label).toBe('antier');
    expect(parseRange('el jueves', NOW)?.label).toBe('el jueves 12 de noviembre');
    expect(parseRange('esta semana', NOW)?.from).toBe(at(16, 0));
    expect(parseRange('el 3', NOW)?.label).toBe('el martes 3 de noviembre');
  });
});

describe('recordatorios por voz', () => {
  let n = 0;
  beforeEach(() => {
    openDbForTests(`test-rem-${n++}`);
  });

  it('entiende hora relativa, hora del día y mañana', () => {
    expect(parseFutureTime('en 2 horas', NOW)).toBe(NOW + 2 * H);
    expect(parseFutureTime('a las 9 de la noche', NOW)).toBe(at(16, 21));
    expect(parseFutureTime('a las 6', NOW)).toBe(at(16, 18));
    expect(parseFutureTime('manana a las 8', NOW)).toBe(at(17, 8));
    const r = detectReminder('Recuérdame en 2 horas tomar la creatina', NOW)!;
    expect(r).toMatchObject({ text: 'Tomar la creatina', at: NOW + 2 * H, daily: false });
    expect(detectReminder('avísame a las 9 de la noche que tome agua', NOW)?.text).toBe('Tome agua');
    expect(detectReminder('recuérdame todos los días a las 7 de la mañana tomar el omeprazol', NOW)).toMatchObject({ text: 'Tomar el omeprazol', daily: true, at: at(17, 7) });
  });

  it('sin hora: pregunta cuándo y acepta la respuesta', () => {
    let r = handleUtterance(emptySession(), 'recuérdame comprar avena', { now: NOW });
    expect(r.question?.kind).toBe('reminder_time');
    r = handleUtterance(r.session, 'mañana a las 8', { now: NOW });
    expect(r.reminder).toMatchObject({ text: 'Comprar avena', at: at(17, 8) });
    let r2 = handleUtterance(emptySession(), 'recuérdame llamar al médico', { now: NOW });
    r2 = handleChip(r2.session, r2.question!.chips.find((c) => c.label === 'En 1 hora')!, NOW);
    expect(r2.reminder?.at).toBe(NOW + H);
  });

  it('se guardan, avisan una vez y los diarios pasan al día siguiente', async () => {
    await addCustomReminder({ at: NOW + H, text: 'Tomar la creatina', daily: false }, NOW);
    await addCustomReminder({ at: NOW + 2 * H, text: 'Omeprazol', daily: true }, NOW);
    await expect(addCustomReminder({ at: NOW - H, text: 'Tarde', daily: false }, NOW)).rejects.toThrow(/ya pasó/);
    expect((await getSettings()).customReminders).toHaveLength(2);
    const due = await takeDueReminders(NOW + 3 * H);
    expect(due.map((d) => d.reminder.text).sort()).toEqual(['Omeprazol', 'Tomar la creatina']);
    const left = (await getSettings()).customReminders;
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: 'Omeprazol', nextAt: NOW + 2 * H + 24 * H });
    expect(await takeDueReminders(NOW + 3 * H)).toHaveLength(0);
  });
});

describe('guardar en cualquier momento', () => {
  it('«guárdalo» guarda aunque haya una pregunta opcional pendiente', () => {
    let r = handleUtterance(emptySession(), 'anoche cené salchipapa con gaseosa', { now: NOW });
    expect(r.question?.kind).not.toBe('confirm');
    r = handleUtterance(r.session, 'guárdalo', { now: NOW });
    expect(r.save).toBe(true);
  });
});
