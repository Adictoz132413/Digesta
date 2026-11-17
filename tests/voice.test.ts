import { describe, expect, it } from 'vitest';
import { normalize, parseTime, parseUtterance } from '@/voice/nlu';
import { editDraft, emptySession, handleChip, handleUtterance, toRecords, type Reply, type Session } from '@/voice/dialog';

// Sábado 15 de nov de 2026, 3:00 p. m. (hora local)
const NOW = new Date(2026, 10, 15, 15, 0).getTime();
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 15 + dayOffset, h, m).getTime();
const P = (t: string) => parseUtterance(t, { now: NOW });

function talk(...lines: string[]): Reply {
  let s: Session = emptySession();
  let r: Reply = { session: s, text: '' };
  for (const l of lines) {
    r = handleUtterance(s, l, { now: NOW });
    s = r.session;
  }
  return r;
}

describe('intérprete de lenguaje (nlu)', () => {
  it('normaliza tildes, puntuación y números en palabras', () => {
    expect(normalize('Almorcé DOS arepas, ¡ricas!')).toBe('almorce 2 arepas ricas');
  });

  it('entiende una comida completa con tipo, hora, cantidades, preparación y sensación', () => {
    const r = P('Almorcé a la una arroz, fríjoles bastantes y carne asada, me cayó pesado');
    expect(r.meals).toHaveLength(1);
    const m = r.meals[0];
    expect(m.mealType).toBe('almuerzo');
    expect(m.at).toBe(at(13));
    expect(m.feelingAfter).toBe('pesado');
    expect(m.items.map((i) => [i.key, i.quantity])).toEqual([
      ['arroz', 'normal'],
      ['frijoles', 'abundante'],
      ['carne asada', 'normal'],
    ]);
  });

  it('cantidades con número y unidad, platos típicos e ingredientes', () => {
    const r = P('desayuné 2 tazas de café y una arepa de huevo, y en la cena media porción de bandeja paisa');
    expect(r.meals).toHaveLength(2);
    expect(r.meals[0].items[0]).toMatchObject({ key: 'cafe', quantity: 'personalizada', customQuantity: '2 tazas' });
    expect(r.meals[0].items[1].key).toBe('arepa de huevo');
    expect(r.meals[1]).toMatchObject({ mealType: 'cena' });
    expect(r.meals[1].items[0]).toMatchObject({ key: 'bandeja paisa', quantity: 'poca' });
    expect(r.meals[1].items[0].ingredients).toContain('Fríjoles');
  });

  it('síntomas con vocabulario colombiano, intensidad, hora y ubicación', () => {
    const a = P('hace una hora me dio agrieras fuerte');
    expect(a.symptoms[0]).toMatchObject({ type: 'acidez', intensity: 7, at: NOW - 3600_000 });
    const b = P('dolor de barriga abajo a la derecha muy fuerte desde hace 2 horas, todavía me duele');
    expect(b.symptoms).toHaveLength(1);
    expect(b.symptoms[0]).toMatchObject({ type: 'dolor', intensity: 9, location: 'fosa_iliaca_derecha', status: 'en_curso' });
    const c = P('tengo gases y la barriga hinchada, como un 6');
    expect(c.symptoms.map((x) => [x.type, x.intensity]).sort()).toEqual([
      ['gases', 6],
      ['hinchazon', 6],
    ]);
    expect(P('tengo maluquera').symptoms[0].type).toBe('nauseas');
    expect(P('me dio dolor de cabeza').symptoms[0]).toMatchObject({ type: 'otro', customName: 'Dolor de cabeza' });
  });

  it('respeta negaciones', () => {
    expect(P('no tuve gases ni dolor, todo bien').symptoms).toHaveLength(0);
  });

  it('deposiciones con Bristol, sangre, color y dolor', () => {
    expect(P('fui al baño y salió normal').stools[0].bristol).toBe(4);
    const r = P('hice popó suelta, con un poquito de sangre en el papel y me dolió');
    expect(r.stools[0]).toMatchObject({ bristol: 6, blood: 'papel', pain: true });
    expect(r.symptoms).toHaveLength(0);
    expect(P('hice del cuerpo en bolitas').stools[0].bristol).toBe(1);
    expect(P('fui al baño y fue pura agua').stools[0].bristol).toBe(7);
    expect(P('hice popó negra').stools[0].color).toBe('negro');
  });

  it('distingue "agua con gas", "huevos revueltos" y "vino" (verbo) de síntomas o alimentos', () => {
    expect(P('tomé agua con gas').symptoms).toHaveLength(0);
    expect(P('desayuné huevos revueltos').symptoms).toHaveLength(0);
    expect(P('desayuné huevos revueltos').meals[0].items[0].key).toBe('huevos pericos');
    expect(P('vino mi mamá y almorzamos sancocho').meals[0].items.map((i) => i.key)).toEqual(['sancocho']);
    expect(P('cené pasta con una copa de vino').meals[0].items.map((i) => i.key)).toContain('vino');
  });

  it('agua, digestión del día, suplementos y quitar alimentos', () => {
    expect(P('tomé 3 vasos de agua').water).toBe(3);
    expect(P('mi digestión hoy estuvo regular').digestion).toBe(3);
    expect(P('me tomé la creatina con un batido de proteína').meals[0]).toMatchObject({ supplements: ['Creatina'] });
    expect(P('quita el pan').removals).toEqual(['pan']);
  });

  it('marca alimentos desconocidos para preguntar', () => {
    const r = P('comí un pastel de gloria y un tinto');
    const unk = r.meals[0].items.find((i) => !i.known);
    expect(unk?.name.toLowerCase()).toContain('gloria');
  });

  it('horas: "a la una", "anoche", "a las 8" según la comida', () => {
    expect(parseTime('a la una', NOW, 'almuerzo')).toBe(at(13));
    expect(parseTime('anoche', NOW)).toBe(at(20, 0, -1));
    expect(parseTime('a las 8', NOW, 'cena')).toBe(at(20, 0, -1));
    expect(parseTime('a las 8', NOW, 'desayuno')).toBe(at(8));
    expect(parseTime('a las 7 y media de la mañana', NOW)).toBe(at(7, 30));
    expect(parseTime('hace media hora', NOW)).toBe(NOW - 30 * 60_000);
  });
});

describe('diálogo', () => {
  it('pide sólo lo necesario y guarda una comida', () => {
    let r = handleUtterance(emptySession(), 'almorcé arroz con pollo y una limonada', { now: NOW });
    // A las 3 p. m. "almuerzo" no coincide con la hora actual → pregunta la hora
    expect(r.question?.kind).toBe('meal_time');
    r = handleUtterance(r.session, 'a la 1', { now: NOW });
    expect(r.question?.kind).toBe('portions');
    r = handleUtterance(r.session, 'normales', { now: NOW });
    expect(r.question?.kind).toBe('feeling');
    r = handleUtterance(r.session, 'bien', { now: NOW });
    expect(r.question?.kind).toBe('confirm');
    expect(r.text).toContain('Almuerzo a las 1:00');
    r = handleUtterance(r.session, 'sí, guárdalo', { now: NOW });
    expect(r.save).toBe(true);
    const rec = toRecords(r.session, NOW);
    expect(rec.meals[0]).toMatchObject({ mealType: 'almuerzo', at: at(13), feelingAfter: 'bien' });
    expect(rec.meals[0].items.map((i) => i.key)).toEqual(['arroz con pollo', 'limonada']);
  });

  it('pregunta intensidad y estado de un síntoma, y acepta opciones tocadas', () => {
    let r = talk('me dio agrieras después de almorzar');
    expect(r.question?.kind).toBe('intensity');
    r = handleUtterance(r.session, 'un 6', { now: NOW });
    expect(r.question?.kind).toBe('symptom_status');
    const chip = r.question!.chips.find((c) => c.label === 'Ya se me pasó')!;
    r = handleChip(r.session, chip, NOW);
    expect(r.question?.kind).toBe('confirm');
    const rec = toRecords(r.session, NOW);
    expect(rec.symptoms[0]).toMatchObject({ type: 'acidez', intensity: 6, endedAt: NOW });
  });

  it('pregunta el tipo de Bristol si no se describió', () => {
    let r = talk('fui al baño');
    expect(r.question?.kind).toBe('bristol');
    r = handleUtterance(r.session, 'blanda', { now: NOW });
    expect(r.question?.kind).toBe('confirm');
    expect(toRecords(r.session, NOW).stools[0].bristol).toBe(5);
  });

  it('pregunta por alimentos desconocidos y los quita si la respuesta es no', () => {
    let r = talk('me comí un tinto y un zorbilón');
    expect(r.question?.kind).toBe('unknown_food');
    r = handleUtterance(r.session, 'no', { now: NOW });
    expect(r.session.meals[0].items.map((i) => i.key)).toEqual(['tinto']);
  });

  it('permite agregar y corregir sobre la marcha', () => {
    let r = talk('cené pasta con pollo y pan', 'a las 8');
    r = handleUtterance(r.session, 'quita el pan', { now: NOW });
    expect(r.session.meals[0].items.map((i) => i.key)).toEqual(['pasta', 'pollo']);
    r = handleUtterance(r.session, 'también una gaseosa', { now: NOW });
    expect(r.session.meals).toHaveLength(1);
    expect(r.session.meals[0].items.map((i) => i.key)).toContain('gaseosa');
    expect(toRecords(r.session, NOW).meals[0]).toMatchObject({ mealType: 'cena', at: at(20, 0, -1) });
    expect(toRecords(r.session, NOW).meals[0].flags).toEqual(expect.arrayContaining(['gaseosa']));
  });

  it('una sola frase con comida, síntoma y deposición', () => {
    const r = talk('desayuné café con leche y pan, me dio hinchazón fuerte y después fui al baño, salió suelta');
    const s = r.session;
    expect(s.meals).toHaveLength(1);
    expect(s.symptoms[0]).toMatchObject({ type: 'hinchazon', intensity: 7 });
    expect(s.stools[0].bristol).toBe(6);
  });

  it('una corrección general no pisa cantidades dichas explícitamente', () => {
    const r = talk('desayuné 2 arepas y pan', 'normales');
    const items = r.session.meals[0].items;
    expect(items.find((i) => i.key === 'arepa')).toMatchObject({ quantity: 'personalizada', customQuantity: '2' });
  });

  it('cancelar descarta el borrador', () => {
    const r = talk('comí arroz', 'cancelar');
    expect(r.cancelled).toBe(true);
    expect(r.session.meals).toHaveLength(0);
  });

  it('no guarda sin completar lo obligatorio', () => {
    const r = talk('fui al baño', 'guardar');
    expect(r.save).toBeUndefined();
    expect(r.question?.kind).toBe('bristol');
  });
});

describe('dictado real (palabras colombianas y diminutivos)', () => {
  it('la frase de la captura: sin «poquitico» ni «normal» como alimentos', () => {
    const r = parseUtterance(
      'Desayuné yogur griego con banano, queso, pan, agua, un poquitico de kiwi, mozzarella, tres huevitos y pan pan normal con pasas tostado y también agua',
      { now: NOW },
    );
    const items = r.meals[0].items;
    expect(items.every((i) => i.known)).toBe(true);
    expect(items.map((i) => i.key)).toEqual(['yogur griego', 'banano', 'queso', 'pan', 'agua', 'kiwi', 'queso mozzarella', 'huevo', 'pasas']);
    expect(items.find((i) => i.key === 'kiwi')?.quantity).toBe('poca');
    expect(items.find((i) => i.key === 'huevo')).toMatchObject({ quantity: 'personalizada', customQuantity: '3' });
  });

  it('diminutivos: quesito, arepita, tintico, juguito de mora', () => {
    expect(P('me comí un quesito con una arepita y un tintico').meals[0].items.map((i) => i.key)).toEqual(['queso', 'arepa', 'tinto']);
    expect(P('cené un juguito de mora bien frío').meals[0].items.map((i) => i.key)).toEqual(['jugo de mora']);
    expect(P('almorcé un tantico de arroz').meals[0].items[0]).toMatchObject({ key: 'arroz', quantity: 'poca' });
  });
});

describe('correcciones al hablar', () => {
  const keys = (t: string) => P(t).meals.flatMap((m) => m.items.map((i) => i.key));
  it('la frase de la segunda captura: «queso cheddar amozzarella perdón»', () => {
    const r = P('desayuné un poquitico de kiwi, un poquitico de yogur griego, un poquitico de banano, tres huevitos, queso cheddar amozzarella perdón y pan pan normal con pasas');
    expect(r.meals[0].items.every((i) => i.known)).toBe(true);
    expect(keys('desayuné un poquitico de kiwi, un poquitico de yogur griego, un poquitico de banano, tres huevitos, queso cheddar amozzarella perdón y pan pan normal con pasas')).toEqual([
      'kiwi', 'yogur griego', 'banano', 'huevo', 'queso mozzarella', 'pan', 'pasas',
    ]);
  });
  it('«perdón» / «mejor dicho» antes o después, y «no comí X, comí Y»', () => {
    expect(keys('almorcé arroz con pollo, perdón, arroz con carne')).toEqual(['arroz', 'carne de res']);
    expect(keys('cené pasta, mejor dicho lasaña, y una gaseosa')).toEqual(['lasana', 'gaseosa']);
    expect(keys('desayuné queso cheddar, a mozzarella, perdón, y pan')).toEqual(['queso mozzarella', 'pan']);
    const r = P('no comí pan, comí arepa');
    expect(r.removals).toEqual(['pan']);
    expect(r.meals[0].items.map((i) => i.key)).toEqual(['arepa']);
  });
  it('elige la lectura sin palabras sueltas: arepa con queso campesino', () => {
    const arepa = P('desayuné arepa con queso campesino').meals[0].items;
    expect(arepa.map((i) => i.key)).toEqual(['arepa']);
    expect(arepa[0].ingredients).toEqual(['Queso campesino']);
    expect(keys('almorcé arroz con pollo')).toEqual(['arroz con pollo']);
  });
  it('corrección en un mensaje aparte reemplaza lo último del borrador', () => {
    let r = handleUtterance(emptySession(), 'desayuné arepa con queso campesino', { now: NOW });
    r = handleUtterance(r.session, 'perdón, era queso cheddar', { now: NOW });
    expect(r.session.meals[0].items.map((i) => i.key)).toEqual(['arepa']);
    expect(r.session.meals[0].items[0].ingredients).toEqual(['Queso cheddar']);
  });
});

describe('unidades y tostado (tercera captura)', () => {
  it('«rodajas» es una unidad y «tostado» va al pan', () => {
    const r = P('desayuné un poquitico de kiwi, pan con pasas tostado, tres huevos revueltos y dos rodajas de queso mozzarella');
    const items = r.meals[0].items;
    expect(items.every((i) => i.known)).toBe(true);
    expect(items.find((i) => i.key === 'pan')?.preparation).toBe('tostado');
    expect(items.find((i) => i.key === 'pasas')?.preparation).toBeUndefined();
    expect(items.find((i) => i.key === 'queso mozzarella')).toMatchObject({ quantity: 'personalizada', customQuantity: '2 rodajas' });
    expect(P('comí unas rodajas de piña').meals[0].items.map((i) => i.key)).toEqual(['pina']);
    expect(P('almorcé un puñado de maní').meals[0].items.map((i) => i.key)).toEqual(['mani']);
  });
});

describe('platos compuestos y corrección manual del borrador (cuarta captura)', () => {
  it('«omelette de tres huevos con queso mozzarella»: los huevos y el queso son ingredientes', () => {
    const items = P('desayuné un omelette de tres huevos con queso mozzarella, pan tostado normal y agua').meals[0].items;
    expect(items.map((i) => i.key)).toEqual(['omelette', 'pan', 'agua']);
    expect(items[0].ingredients).toEqual(['Huevo', 'Queso mozzarella']);
    expect(items[1].preparation).toBe('tostado');
    expect(P('almorcé un sándwich de jamón y queso y una gaseosa').meals[0].items.map((i) => i.key)).toEqual(['sandwich', 'gaseosa']);
  });

  it('«el omelette sin los huevos» quita los huevos sueltos', () => {
    let r = handleUtterance(emptySession(), 'desayuné un omelette, tres huevos y pan', { now: NOW });
    r = handleUtterance(r.session, 'el omelette sin los huevos', { now: NOW });
    expect(r.session.meals[0].items.map((i) => i.key)).toEqual(['omelette', 'pan']);
  });

  it('editar a mano: renombrar un desconocido, cantidades, ingredientes, agregar y hora', () => {
    let r = handleUtterance(emptySession(), 'me comí un tinto y un zorbilón', { now: NOW });
    expect(r.session.pending?.kind).toBe('unknown_food');
    const m = r.session.meals[0];
    let s = editDraft(r.session, { kind: 'item', mealId: m.id, index: 1, patch: { name: 'salchichón' } }, NOW);
    expect(s.meals[0].items[1]).toMatchObject({ key: 'salchichon', known: true });
    expect(s.pending?.kind).not.toBe('unknown_food');
    s = editDraft(s, { kind: 'item', mealId: m.id, index: 0, patch: { quantity: 'abundante' } }, NOW);
    expect(s.meals[0].items[0].quantity).toBe('abundante');
    s = editDraft(s, { kind: 'addItem', mealId: m.id, name: 'arepa con queso' }, NOW);
    expect(s.meals[0].items[2].ingredients).toEqual(['Arepa', 'Queso campesino']);
    s = editDraft(s, { kind: 'removeIngredient', mealId: m.id, index: 2, ingredient: 'Arepa' }, NOW);
    expect(s.meals[0].items[2].ingredients).toEqual(['Queso campesino']);
    s = editDraft(s, { kind: 'meal', mealId: m.id, patch: { mealType: 'merienda', at: NOW - 3600_000 } }, NOW);
    const rec = toRecords(s, NOW);
    expect(rec.meals[0]).toMatchObject({ mealType: 'merienda', at: NOW - 3600_000 });
    s = editDraft(s, { kind: 'removeItem', mealId: m.id, index: 0 }, NOW);
    expect(s.meals[0].items.map((i) => i.key)).toEqual(['salchichon', 'arepa con queso']);
  });
});

describe('sobras de ayer y listas de verduras (octava captura)', () => {
  it('«volví a comer… vegetales entre esos zanahoria pimentón… la salchipapa de ayer»', () => {
    const r = P('volví a comer arroz pollo con salsa de soya qué más a vegetales entre esos zanahoria pimentón un poquito de la salchipapa de ayer un poquito de sopa de huevo un poquito de gaseosa');
    const m = r.meals[0];
    expect(m.items.every((i) => i.known)).toBe(true);
    expect(m.items.map((i) => i.key)).toEqual(['arroz', 'pollo', 'salsa de soya', 'verduras', 'salchipapa', 'sopa', 'gaseosa']);
    expect(m.items.find((i) => i.key === 'verduras')?.ingredients).toEqual(['Zanahoria', 'Pimentón']);
    // "de ayer" son sobras: la comida no se pasa al día anterior
    expect(m.timeExplicit).toBe(false);
  });
  it('«el almuerzo de ayer» sí es de ayer', () => {
    const m = P('el almuerzo de ayer fue arroz con pollo').meals[0];
    expect(m.at).toBe(new Date(2026, 10, 14, 12, 30).getTime());
  });
});
