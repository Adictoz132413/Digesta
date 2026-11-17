import { describe, expect, it } from 'vitest';
import { aiReady, aiToTurn } from '@/voice/ai';
import { AiOutput, type AiOutput as Out } from '@/voice/aiClient';
import { emptySession, handleUtterance, toRecords } from '@/voice/dialog';

// Sábado 15 de nov de 2026, 3:00 p. m. (hora local)
const NOW = new Date(2026, 10, 15, 15, 0).getTime();
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 15 + dayOffset, h, m).getTime();

/** Respuesta vacía de la IA; cada prueba llena lo que necesita. */
function out(p: Partial<Out> = {}): Out {
  return {
    kind: 'registro',
    meals: [],
    symptoms: [],
    stools: [],
    water_ml: null,
    water_vague: false,
    hydration: null,
    digestion: null,
    remove_from_draft: [],
    answer: { intent: null, meal_type: null, time: null, day_offset: 0, number: null, quantity: null, feeling: null },
    query: null,
    reminder: null,
    saved_ref: null,
    fast_time: null,
    reply: '',
    ...p,
  };
}
const item = (name: string, extra: Partial<Out['meals'][number]['items'][number]> = {}) => ({ name, quantity: 'normal' as const, custom_quantity: null, preparation: null, ingredients: [], ...extra });
const meal = (p: Partial<Out['meals'][number]>) => ({ meal_type: null, time: null, day_offset: 0, items: [], supplements: [], feeling_after: null, ...p });

describe('IA: conversión de la respuesta', () => {
  it('el formato acepta una respuesta completa', () => {
    expect(AiOutput.safeParse(out()).success).toBe(true);
  });

  it('una comida con hora, cantidades, preparación e ingredientes', () => {
    const t = aiToTurn(
      out({
        meals: [meal({ meal_type: 'almuerzo', time: '13:00', items: [item('Arroz'), item('Fríjoles', { quantity: 'abundante' }), item('Carne asada', { preparation: 'asado' }), item('Arepa', { ingredients: ['queso', 'mantequilla'] }), item('Huevo', { quantity: 'personalizada', custom_quantity: '2' })], feeling_after: 'pesado' })],
      }),
      NOW,
    );
    const m = t.parse.meals[0];
    expect(m.mealType).toBe('almuerzo');
    expect(m.at).toBe(at(13));
    expect(m.items.map((i) => i.name)).toEqual(['Arroz', 'Fríjoles', 'Carne asada', 'Arepa', 'Huevo']);
    expect(m.items[1].quantity).toBe('abundante');
    expect(m.items[2].preparation).toBe('asado');
    expect(m.items[3].ingredients).toEqual(['Queso', 'Mantequilla']);
    expect(m.items[4]).toMatchObject({ quantity: 'personalizada', customQuantity: '2' });
    expect(m.items.every((i) => i.known)).toBe(true);
    expect(m.feelingAfter).toBe('pesado');
    expect(t.parse.empty).toBe(false);
  });

  it('una hora futura se entiende como del día anterior; "ayer" sin hora usa la hora típica', () => {
    const t = aiToTurn(out({ meals: [meal({ meal_type: 'cena', time: '20:00', items: [item('Sopa')] }), meal({ meal_type: 'almuerzo', day_offset: -1, items: [item('Salchipapa')] })] }), NOW);
    expect(t.parse.meals[0].at).toBe(at(20, 0, -1));
    expect(t.parse.meals[1].at).toBe(at(12, 30, -1));
  });

  it('una sola bebida queda como bebida', () => {
    const t = aiToTurn(out({ meals: [meal({ items: [item('Batido de proteína')] })] }), NOW);
    expect(t.parse.meals[0].mealType).toBe('bebida');
  });

  it('agua, síntomas y deposiciones', () => {
    const t = aiToTurn(
      out({
        water_ml: 500,
        symptoms: [{ type: 'acidez', custom_name: null, intensity: 14, time: '14:00', day_offset: 0, status: 'en_curso', duration_min: null }],
        stools: [{ time: '09:30', day_offset: 0, bristol: 4, blood: null, pain: false, mucus: false, incomplete: false }],
      }),
      NOW,
    );
    expect(t.parse.water).toBe(2);
    expect(t.parse.symptoms[0]).toMatchObject({ type: 'acidez', intensity: 10, at: at(14), status: 'en_curso' });
    expect(t.parse.stools[0]).toMatchObject({ bristol: 4, at: at(9, 30) });
  });

  it('quitar del borrador usa la clave que ya está ahí', () => {
    const t = aiToTurn(out({ remove_from_draft: ['queso mozzarella'] }), NOW, [], [{ name: 'Queso mozzarella', key: 'queso mozzarella' }]);
    expect(t.parse.removals).toEqual(['queso mozzarella']);
  });

  it('consulta del diario con rango', () => {
    const t = aiToTurn(out({ kind: 'consulta', query: { kind: 'ate', foods: ['salchipapa'], meal_type: null, symptom_types: [], from_day_offset: -1, to_day_offset: -1 } }), NOW);
    expect(t.query?.kind).toBe('ate');
    expect(t.query?.foods[0].key).toBe('salchipapa');
    expect(t.query?.range).toMatchObject({ from: at(0, 0, -1), single: true, label: 'ayer' });
  });

  it('recordatorio en minutos o a una hora que ya pasó hoy', () => {
    const a = aiToTurn(out({ kind: 'recordatorio', reminder: { text: 'Tomar la creatina', time: null, day_offset: 0, in_minutes: 120, daily: false } }), NOW);
    expect(a.reminder).toEqual({ text: 'Tomar la creatina', at: NOW + 120 * 60_000, daily: false });
    const b = aiToTurn(out({ kind: 'recordatorio', reminder: { text: 'Caminar', time: '08:00', day_offset: 0, in_minutes: null, daily: false } }), NOW);
    expect(b.reminder?.at).toBe(at(20));
    const c = aiToTurn(out({ kind: 'recordatorio', reminder: { text: 'Pesarme', time: '07:00', day_offset: 0, in_minutes: null, daily: true } }), NOW);
    expect(c.reminder?.at).toBe(at(7, 0, 1));
  });

  it('mover y corregir algo ya guardado', () => {
    const m = aiToTurn(out({ kind: 'mover_guardado', saved_ref: { foods: ['batido de proteína'], meal_type: null, day_offset: null, last: true, new_time: '14:00', new_day_offset: 0 } }), NOW);
    expect(m.parse.moveRef).toMatchObject({ keys: ['batido de proteina'], at: at(14) });
    const e = aiToTurn(out({ kind: 'corregir_guardado', saved_ref: { foods: [], meal_type: 'cena', day_offset: -1, last: false, new_time: null, new_day_offset: 0 } }), NOW);
    expect(e.parse.editRequest).toMatchObject({ mealType: 'cena', dayOffset: -1, keys: [] });
  });

  it('nada que registrar → vacío, con respuesta breve si la hay', () => {
    const t = aiToTurn(out({ kind: 'otro', reply: 'Puedes decirme qué comiste.' }), NOW);
    expect(t.parse.empty).toBe(true);
    expect(t.reply).toBe('Puedes decirme qué comiste.');
  });
});

describe('IA dentro del diálogo', () => {
  it('lo que interpretó la IA llega a la ficha y se guarda igual', () => {
    const ai = aiToTurn(out({ meals: [meal({ meal_type: 'desayuno', time: '07:30', items: [item('Arepa', { ingredients: ['Queso cheddar'] }), item('Café')] })] }), NOW);
    let r = handleUtterance(emptySession(), 'desayuné una arepa con queso, perdón, cheddar, y un tintico', { now: NOW, ai });
    expect(r.session.meals[0].items.map((i) => i.name)).toEqual(['Arepa', 'Café']);
    r = handleUtterance(r.session, 'sí', { now: NOW });
    const rec = toRecords(r.session, NOW);
    expect(rec.meals[0]).toMatchObject({ mealType: 'desayuno', at: at(7, 30) });
  });

  it('una consulta de la IA no se registra como comida', () => {
    const ai = aiToTurn(out({ kind: 'consulta', query: { kind: 'ate', foods: ['salchipapa'], meal_type: null, symptom_types: [], from_day_offset: -1, to_day_offset: -1 } }), NOW);
    const r = handleUtterance(emptySession(), 'recuérdame si ayer comí salchipapa', { now: NOW, ai });
    expect(r.query?.kind).toBe('ate');
    expect(r.session.meals).toHaveLength(0);
  });

  it('la respuesta breve de la IA se muestra cuando no hay nada que anotar', () => {
    const ai = aiToTurn(out({ kind: 'otro', reply: 'Cuéntame qué comiste hoy.' }), NOW);
    const r = handleUtterance(emptySession(), 'hola cómo funciona esto', { now: NOW, ai });
    expect(r.text).toBe('Cuéntame qué comiste hoy.');
  });

  it('sin clave la IA no se activa', () => {
    expect(aiReady({ enabled: true, apiKey: '', model: 'claude-opus-5-5' })).toBe(false);
    expect(aiReady({ enabled: false, apiKey: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-opus-5-5' })).toBe(false);
    expect(aiReady({ enabled: true, apiKey: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-opus-5-5' })).toBe(true);
  });
});
