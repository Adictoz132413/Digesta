import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, openDbForTests } from '@/db/db';
import { saveMeal } from '@/db/repo';
import { parseUtterance } from '@/voice/nlu';
import { addRefMeal, emptySession, handleUtterance, toRecords } from '@/voice/dialog';
import { findSavedMeal, moveSavedFoods } from '@/voice/moveSaved';

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

describe('pedir que corrija algo guardado (sexta captura)', () => {
  const SIXTH = 'Necesito que corrijas la cena que me pusiste de lo del batido de proteína';
  it('se entiende como un pedido de corrección, no como comida', () => {
    const r = parseUtterance(SIXTH, { now: NOW });
    expect(r.editRequest).toEqual({ mealType: 'cena', keys: ['batido de proteina'], dayOffset: undefined });
    expect(r.meals).toHaveLength(0);
    expect(parseUtterance('arregla el desayuno de ayer', { now: NOW }).editRequest).toMatchObject({ mealType: 'desayuno', dayOffset: -1 });
    expect(parseUtterance('corrige lo que me pusiste', { now: NOW }).editRequest).toMatchObject({ keys: [] });
    // Con una hora nueva sigue siendo un cambio de hora
    expect(parseUtterance('corrige, el batido me lo tomé a las 4 de la tarde', { now: NOW }).moveRef?.at).toBe(FOUR_PM);
    // "necesito" y "corrijas" nunca son alimentos
    expect(parseUtterance('necesito que anotes arroz', { now: NOW }).meals.flatMap((m) => m.items.map((i) => i.key))).toEqual(['arroz']);
  });

  it('si está en el borrador, se corrige ahí; si no, se busca en lo guardado', async () => {
    let r = handleUtterance(emptySession(), 'cené arroz y un batido de proteína', { now: NOW });
    r = handleUtterance(r.session, SIXTH, { now: NOW });
    expect(r.editRequest?.inDraft).toBe(true);
    const r2 = handleUtterance(emptySession(), SIXTH, { now: NOW });
    expect(r2.editRequest?.inDraft).toBe(false);
  });
});

describe('buscar la comida guardada a corregir', () => {
  let n = 0;
  beforeEach(() => {
    openDbForTests(`test-find-${n++}`);
  });
  it('encuentra la cena más reciente con el batido', async () => {
    await saveMeal({ at: NOW - 30 * 3600_000, mealType: 'cena', items: [{ name: 'Pasta', key: 'pasta', quantity: 'normal' }], flags: [], supplements: [] });
    const target = await saveMeal({ at: NOW - 600_000, mealType: 'cena', items: [{ name: 'Leche', key: 'leche', quantity: 'normal' }, { name: 'Batido de proteína', key: 'batido de proteina', quantity: 'normal' }], flags: [], supplements: [] });
    expect((await findSavedMeal({ mealType: 'cena', keys: ['batido de proteina'] }, NOW))?.id).toBe(target.id);
    expect((await findSavedMeal({ mealType: 'cena', keys: [], dayOffset: -1 }, NOW))?.items[0].key).toBe('pasta');
    expect(await findSavedMeal({ mealType: 'desayuno', keys: [] }, NOW)).toBeUndefined();
  });
});

describe('batido con leche', () => {
  it('la leche es ingrediente del batido', () => {
    const items = parseUtterance('de cena me tomé un batido de proteína con leche', { now: NOW }).meals[0].items;
    expect(items.map((i) => i.key)).toEqual(['batido de proteina']);
    expect(items[0].ingredients).toEqual(['Leche']);
  });
});
