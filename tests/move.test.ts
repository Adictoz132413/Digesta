import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, openDbForTests } from '@/db/db';
import { saveMeal } from '@/db/repo';
import { parseUtterance } from '@/voice/nlu';
import { addRefMeal, emptySession, handleUtterance, toRecords } from '@/voice/dialog';
import { moveSavedFoods } from '@/voice/moveSaved';

const NOW = new Date(2026, 10, 16, 18, 20).getTime();
const FOUR_PM = new Date(2026, 10, 16, 16, 0).getTime();
const PHRASE = 'el batido de el batido de suero de leche que pusiste que registraste ahorita más tarde eso me lo tomé a las 4 de la tarde';

describe('corregir la hora de algo ya dicho (quinta captura)', () => {
  it('se entiende como mover el batido de proteína a las 4 p. m., sin alimentos falsos', () => {
    const r = parseUtterance(PHRASE, { now: NOW });
    expect(r.moveRef).toEqual({ keys: ['batido de proteina'], names: ['Batido de proteína'], at: FOUR_PM });
    expect(r.meals).toHaveLength(0);
    expect(parseUtterance('desayuné pan y queso, eso lo pusiste mal', { now: NOW }).meals.flatMap((m) => m.items.map((i) => i.key))).not.toContain('pusiste');
  });

  it('en el borrador: separa el batido en un registro aparte a las 4 p. m.', () => {
    let r = handleUtterance(emptySession(), 'cené arroz con pollo y un batido de suero de leche', { now: NOW });
    expect(r.session.meals[0].items.map((i) => i.key)).toEqual(['arroz con pollo', 'batido de proteina']);
    r = handleUtterance(r.session, PHRASE, { now: NOW });
    expect(r.text).toContain('pasé batido de proteína a las 4:00');
    const rec = toRecords(r.session, NOW);
    expect(rec.meals.map((m) => [m.mealType, m.at, m.items.map((i) => i.key)])).toEqual([
      ['cena', expect.any(Number), ['arroz con pollo']],
      ['bebida', FOUR_PM, ['batido de proteina']],
    ]);
  });

  it('si toda la comida era el batido, sólo cambia la hora', () => {
    let r = handleUtterance(emptySession(), 'me tomé un batido de suero de leche', { now: NOW });
    r = handleUtterance(r.session, 'el batido que anotaste me lo tomé a las 4 de la tarde', { now: NOW });
    expect(r.session.meals).toHaveLength(1);
    expect(toRecords(r.session, NOW).meals[0].at).toBe(FOUR_PM);
  });

  it('si no está en el borrador, la pantalla lo busca en lo guardado', () => {
    const r = handleUtterance(emptySession(), PHRASE, { now: NOW });
    expect(r.moveSaved?.keys).toEqual(['batido de proteina']);
    const added = addRefMeal(r.session, r.moveSaved!, NOW);
    expect(toRecords(added.session, NOW).meals[0]).toMatchObject({ mealType: 'bebida', at: FOUR_PM });
  });
});

describe('mover alimentos ya guardados', () => {
  let n = 0;
  beforeEach(() => {
    openDbForTests(`test-move-${n++}`);
  });
  it('separa el batido de la cena guardada y lo pone a las 4 p. m.', async () => {
    await saveMeal({ at: NOW - 600_000, mealType: 'cena', items: [{ name: 'Arroz con pollo', key: 'arroz con pollo', quantity: 'normal' }, { name: 'Batido de proteína', key: 'batido de proteina', quantity: 'normal' }], flags: [], supplements: [] });
    const res = await moveSavedFoods({ keys: ['batido de proteina'], at: FOUR_PM }, NOW);
    expect(res).toEqual({ names: ['Batido de proteína'], split: true });
    const meals = (await getDb().meals.toArray()).sort((a, b) => a.at - b.at);
    expect(meals.map((m) => [m.mealType, m.at, m.items.map((i) => i.key)])).toEqual([
      ['bebida', FOUR_PM, ['batido de proteina']],
      ['cena', NOW - 600_000, ['arroz con pollo']],
    ]);
    expect(await moveSavedFoods({ keys: ['salchipapa'], at: FOUR_PM }, NOW)).toBeUndefined();
  });
});
