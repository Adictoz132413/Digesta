import { beforeEach, describe, expect, it } from 'vitest';
import { openDbForTests } from '@/db/db';
import { getSettings, loadDay, patchDailyLog } from '@/db/repo';
import { dailyCsv } from '@/db/csv';
import { formatBottles, formatMl, hydrationSummary, mlToGlasses } from '@/domain/hydration';
import { parseUtterance, parseWater } from '@/voice/nlu';
import { emptySession, handleUtterance, toRecords, type Reply } from '@/voice/dialog';

const NOW = new Date(2026, 10, 15, 15, 0).getTime();
let n = 0;
beforeEach(() => {
  openDbForTests(`test-hyd-${n++}`);
});

function talk(...lines: string[]): Reply {
  let r: Reply = { session: emptySession(), text: '' };
  for (const l of lines) r = handleUtterance(r.session, l, { now: NOW, bottleMl: 600 });
  return r;
}

describe('hidratación: utilidades y persistencia', () => {
  it('formatos de cantidad', () => {
    expect(formatMl(600)).toBe('600 ml');
    expect(formatMl(1500)).toBe('1,5 L');
    expect(formatBottles(1.75)).toBe('1 ¾');
    expect(formatBottles(0.5)).toBe('½');
    expect(mlToGlasses(600)).toBe(2.4);
    expect(hydrationSummary({ water: 6, hydration: 2 })).toBe('≈ 1,5 L · normal (estimado)');
  });

  it('por defecto se registra a sorbos con botella de 600 ml', async () => {
    expect(await getSettings()).toMatchObject({ hydrationMode: 'sorbos', bottleMl: 600 });
  });

  it('guarda fracciones de botella y el estimado del día', async () => {
    await patchDailyLog('2026-11-15', { water: 2.4, hydration: 3 });
    const d = await loadDay('2026-11-15');
    expect(d.log).toMatchObject({ water: 2.4, hydration: 3 });
    const csv = dailyCsv([d.log!]);
    expect(csv).toContain(';600;Bastante;');
  });
});

describe('hidratación por voz', () => {
  it('cantidades en vasos, botellas y litros', () => {
    expect(parseWater('tome 3 vasos de agua').ml).toBe(750);
    expect(parseWater('me tome media botella de agua', 600).ml).toBe(300);
    expect(parseWater('me tome toda la botella', 1000).ml).toBe(1000);
    expect(parseUtterance('me tomé un litro de agua', { now: NOW }).water).toBe(4);
    expect(parseUtterance('tomé 3 vasos de agua', { now: NOW }).water).toBe(3);
  });

  it('estimado del día sin tocar las porciones de la comida', () => {
    const r = parseUtterance('hoy tomé poca agua', { now: NOW });
    expect(r.hydration).toBe(1);
    expect(r.quantityOnly).toBeUndefined();
    expect(r.meals).toHaveLength(0);
    expect(parseUtterance('tomé bastante agua', { now: NOW }).hydration).toBe(3);
  });

  it('agua a sorbos: pregunta el estimado y lo guarda', () => {
    let r = talk('tomé agua a sorbos todo el día');
    expect(r.question?.kind).toBe('hydration');
    r = handleUtterance(r.session, 'normal', { now: NOW });
    expect(r.question?.kind).toBe('confirm');
    expect(toRecords(r.session, NOW).hydration).toBe(2);
  });

  it('una comida con agua estimada en la misma frase', () => {
    const r = talk('almorcé arroz con pollo a la una y tomé poca agua');
    const rec = toRecords(r.session, NOW);
    expect(rec.meals[0].items.map((i) => i.key)).toEqual(['arroz con pollo']);
    expect(rec.hydration).toBe(1);
  });

  it('una botella usa el tamaño configurado', () => {
    const r = talk('me tomé una botella de agua');
    expect(r.session.water).toBe(2.4);
    expect(r.text).toContain('600 ml');
  });
});
