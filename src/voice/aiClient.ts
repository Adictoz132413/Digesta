/**
 * Llamada a Claude (se carga sólo cuando la IA está activada).
 * Contiene el formato de respuesta y las instrucciones.
 */
import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import { AiError, type AiContext, type AiPrefs } from './ai';

// ───────── Formato de respuesta (salida estructurada) ─────────

const MEAL_TYPES = ['desayuno', 'almuerzo', 'cena', 'merienda', 'bebida'] as const;
const QUANTITIES = ['poca', 'normal', 'abundante', 'personalizada'] as const;
const PREPS = ['crudo', 'cocido', 'frito', 'asado', 'horneado', 'guisado', 'al_vapor', 'licuado', 'procesado', 'fermentado', 'tostado', 'otro'] as const;
const FEELINGS = ['ligero', 'bien', 'satisfecho', 'pesado', 'molesto', 'mal'] as const;
const SYMPTOMS = ['hinchazon', 'gases', 'dolor', 'acidez', 'nauseas', 'retortijones', 'diarrea', 'estrenimiento', 'pesadez', 'eructos', 'vomito', 'otro'] as const;
const QUERY_KINDS = ['ate', 'last_time', 'count_food', 'what_ate', 'symptoms', 'stools', 'digestion', 'water', 'fasts'] as const;

const When = {
  /** "HH:MM" en 24 h, hora local. */
  time: z.string().nullable(),
  /** 0 hoy, -1 ayer, -2 antier… (1 mañana, sólo recordatorios). */
  day_offset: z.number().int(),
};

const Item = z.object({
  name: z.string(),
  quantity: z.enum(QUANTITIES),
  custom_quantity: z.string().nullable(),
  preparation: z.enum(PREPS).nullable(),
  ingredients: z.array(z.string()),
});

const Meal = z.object({
  meal_type: z.enum(MEAL_TYPES).nullable(),
  ...When,
  items: z.array(Item),
  supplements: z.array(z.string()),
  feeling_after: z.enum(FEELINGS).nullable(),
});

const Symptom = z.object({
  type: z.enum(SYMPTOMS),
  custom_name: z.string().nullable(),
  intensity: z.number().int().nullable(),
  ...When,
  status: z.enum(['en_curso', 'termino', 'desconocido']),
  duration_min: z.number().int().nullable(),
});

const Stool = z.object({
  ...When,
  bristol: z.number().int().nullable(),
  blood: z.enum(['no', 'papel', 'heces', 'abundante']).nullable(),
  pain: z.boolean(),
  mucus: z.boolean(),
  incomplete: z.boolean(),
});

export const AiOutput = z.object({
  kind: z.enum(['registro', 'consulta', 'recordatorio', 'corregir_guardado', 'mover_guardado', 'ayuno_inicio', 'ayuno_fin', 'respuesta', 'otro']),
  meals: z.array(Meal),
  symptoms: z.array(Symptom),
  stools: z.array(Stool),
  water_ml: z.number().nullable(),
  water_vague: z.boolean(),
  hydration: z.enum(['poca', 'normal', 'bastante']).nullable(),
  digestion: z.number().int().nullable(),
  remove_from_draft: z.array(z.string()),
  answer: z.object({
    intent: z.enum(['confirm', 'no', 'cancel', 'skip']).nullable(),
    meal_type: z.enum(MEAL_TYPES).nullable(),
    ...When,
    number: z.number().nullable(),
    quantity: z.enum(['poca', 'normal', 'abundante']).nullable(),
    feeling: z.enum(FEELINGS).nullable(),
  }),
  query: z
    .object({
      kind: z.enum(QUERY_KINDS),
      foods: z.array(z.string()),
      meal_type: z.enum(MEAL_TYPES).nullable(),
      symptom_types: z.array(z.enum(SYMPTOMS)),
      from_day_offset: z.number().int().nullable(),
      to_day_offset: z.number().int().nullable(),
    })
    .nullable(),
  reminder: z
    .object({
      text: z.string(),
      ...When,
      in_minutes: z.number().nullable(),
      daily: z.boolean(),
    })
    .nullable(),
  saved_ref: z
    .object({
      foods: z.array(z.string()),
      meal_type: z.enum(MEAL_TYPES).nullable(),
      day_offset: z.number().int().nullable(),
      last: z.boolean(),
      new_time: z.string().nullable(),
      new_day_offset: z.number().int(),
    })
    .nullable(),
  fast_time: z.string().nullable(),
  reply: z.string(),
});
export type AiOutput = z.infer<typeof AiOutput>;

/*
 * Formato de la respuesta. No se usa la «salida estructurada» de la API (su
 * gramática compilada tiene un tamaño máximo y este formato lo supera): la IA
 * responde un JSON siguiendo la plantilla de abajo y aquí se valida con
 * tolerancia — un dato que falta o viene mal se toma como vacío.
 * Sin null: "" sin texto/hora, «ninguno» sin opción, -1 o 0 sin número.
 */
const NONE = 'ninguno' as const;
const txt = () => z.string().catch('');
const num = (d: number) => z.number().catch(d);
const bool = () => z.boolean().catch(false);
const pick = <T extends readonly [string, ...string[]]>(values: T, d: T[number]) => z.enum(values).catch(d);
const list = <T extends z.ZodType>(item: T) => z.array(item).catch([]);
const withNone = <T extends readonly string[]>(values: T) => [...values, NONE] as unknown as [T[number] | typeof NONE, ...(T[number] | typeof NONE)[]];

const WireItem = z.object({
  name: txt(),
  quantity: pick(QUANTITIES, 'normal'),
  custom_quantity: txt(),
  preparation: pick(withNone(PREPS), NONE),
  ingredients: list(z.string()),
});

const WireMeal = z.object({
  meal_type: pick(withNone(MEAL_TYPES), NONE),
  time: txt(),
  day_offset: num(0),
  items: list(WireItem),
  supplements: list(z.string()),
  feeling_after: pick(withNone(FEELINGS), NONE),
});

const WireSymptom = z.object({
  type: pick(SYMPTOMS, 'otro'),
  custom_name: txt(),
  intensity: num(-1),
  time: txt(),
  day_offset: num(0),
  status: pick(['en_curso', 'termino', 'desconocido'] as const, 'desconocido'),
  duration_min: num(-1),
});

const WireStool = z.object({
  time: txt(),
  day_offset: num(0),
  bristol: num(0),
  blood: pick(withNone(['no', 'papel', 'heces', 'abundante'] as const), NONE),
  pain: bool(),
  mucus: bool(),
  incomplete: bool(),
});

const obj = <T extends z.ZodRawShape>(shape: T) => {
  const o = z.object(shape);
  return o.catch(() => o.parse({}));
};

export const WireOutput = z.object({
  kind: pick(['registro', 'consulta', 'recordatorio', 'corregir_guardado', 'mover_guardado', 'ayuno_inicio', 'ayuno_fin', 'respuesta', 'otro'] as const, 'otro'),
  meals: list(WireMeal),
  symptoms: list(WireSymptom),
  stools: list(WireStool),
  water_ml: num(0),
  water_vague: bool(),
  hydration: pick(withNone(['poca', 'normal', 'bastante'] as const), NONE),
  digestion: num(0),
  remove_from_draft: list(z.string()),
  answer: obj({
    intent: pick(withNone(['confirm', 'no', 'cancel', 'skip'] as const), NONE),
    meal_type: pick(withNone(MEAL_TYPES), NONE),
    time: txt(),
    day_offset: num(0),
    number: num(-1),
    quantity: pick(withNone(['poca', 'normal', 'abundante'] as const), NONE),
    feeling: pick(withNone(FEELINGS), NONE),
  }),
  query: obj({
    kind: pick(QUERY_KINDS, 'what_ate'),
    foods: list(z.string()),
    meal_type: pick(withNone(MEAL_TYPES), NONE),
    symptom_types: list(z.enum(SYMPTOMS)),
    has_range: bool(),
    from_day_offset: num(0),
    to_day_offset: num(0),
  }),
  reminder: obj({
    text: txt(),
    time: txt(),
    day_offset: num(0),
    in_minutes: num(0),
    daily: bool(),
  }),
  saved_ref: obj({
    foods: list(z.string()),
    meal_type: pick(withNone(MEAL_TYPES), NONE),
    has_day: bool(),
    day_offset: num(0),
    last: bool(),
    new_time: txt(),
    new_day_offset: num(0),
  }),
  fast_time: txt(),
  reply: txt(),
});
export type WireOutput = z.infer<typeof WireOutput>;

/** Plantilla que se le muestra a la IA (los valores indican el tipo y el relleno). */
export const TEMPLATE = `{
  "kind": "registro | consulta | recordatorio | corregir_guardado | mover_guardado | ayuno_inicio | ayuno_fin | respuesta | otro",
  "meals": [{
    "meal_type": "desayuno | almuerzo | cena | merienda | bebida | ninguno",
    "time": "HH:MM o \\"\\"", "day_offset": 0,
    "items": [{ "name": "texto", "quantity": "poca | normal | abundante | personalizada", "custom_quantity": "texto o \\"\\"", "preparation": "${PREPS.join(' | ')} | ninguno", "ingredients": ["texto"] }],
    "supplements": ["texto"],
    "feeling_after": "${FEELINGS.join(' | ')} | ninguno"
  }],
  "symptoms": [{ "type": "${SYMPTOMS.join(' | ')}", "custom_name": "texto o \\"\\"", "intensity": "0-10 o -1", "time": "HH:MM o \\"\\"", "day_offset": 0, "status": "en_curso | termino | desconocido", "duration_min": "minutos o -1" }],
  "stools": [{ "time": "HH:MM o \\"\\"", "day_offset": 0, "bristol": "1-7 o 0", "blood": "no | papel | heces | abundante | ninguno", "pain": false, "mucus": false, "incomplete": false }],
  "water_ml": 0, "water_vague": false, "hydration": "poca | normal | bastante | ninguno", "digestion": "1-5 o 0",
  "remove_from_draft": ["nombre exacto del borrador"],
  "answer": { "intent": "confirm | no | cancel | skip | ninguno", "meal_type": "… | ninguno", "time": "HH:MM o \\"\\"", "day_offset": 0, "number": -1, "quantity": "poca | normal | abundante | ninguno", "feeling": "… | ninguno" },
  "query": { "kind": "${QUERY_KINDS.join(' | ')}", "foods": ["texto"], "meal_type": "… | ninguno", "symptom_types": ["…"], "has_range": false, "from_day_offset": 0, "to_day_offset": 0 },
  "reminder": { "text": "texto", "time": "HH:MM o \\"\\"", "day_offset": 0, "in_minutes": 0, "daily": false },
  "saved_ref": { "foods": ["texto"], "meal_type": "… | ninguno", "has_day": false, "day_offset": 0, "last": false, "new_time": "HH:MM o \\"\\"", "new_day_offset": 0 },
  "fast_time": "HH:MM o \\"\\"",
  "reply": ""
}`;

/** Saca el objeto JSON del texto de la respuesta (por si viene con ``` o una frase). */
export function extractJson(text: string): unknown {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('sin JSON');
  return JSON.parse(text.slice(a, b + 1));
}

const orNull = <T extends string>(v: T): Exclude<T, typeof NONE> | null => (v === NONE ? null : (v as Exclude<T, typeof NONE>));
const str = (v: string) => (v.trim() ? v.trim() : null);
const int = (v: number) => Math.round(v);

/** Convierte el formato enviado (con rellenos) al formato interno (con null). */
export function fromWire(w: WireOutput): AiOutput {
  return {
    kind: w.kind,
    meals: w.meals.map((m) => ({
      meal_type: orNull(m.meal_type),
      time: str(m.time),
      day_offset: int(m.day_offset),
      items: m.items.map((i) => ({ name: i.name, quantity: i.quantity, custom_quantity: str(i.custom_quantity), preparation: orNull(i.preparation), ingredients: i.ingredients })),
      supplements: m.supplements,
      feeling_after: orNull(m.feeling_after),
    })),
    symptoms: w.symptoms.map((x) => ({
      type: x.type,
      custom_name: str(x.custom_name),
      intensity: x.intensity < 0 ? null : int(x.intensity),
      time: str(x.time),
      day_offset: int(x.day_offset),
      status: x.status,
      duration_min: x.duration_min < 0 ? null : int(x.duration_min),
    })),
    stools: w.stools.map((x) => ({
      time: str(x.time),
      day_offset: int(x.day_offset),
      bristol: x.bristol >= 1 && x.bristol <= 7 ? int(x.bristol) : null,
      blood: orNull(x.blood),
      pain: x.pain,
      mucus: x.mucus,
      incomplete: x.incomplete,
    })),
    water_ml: w.water_ml > 0 ? w.water_ml : null,
    water_vague: w.water_vague,
    hydration: orNull(w.hydration),
    digestion: w.digestion >= 1 && w.digestion <= 5 ? int(w.digestion) : null,
    remove_from_draft: w.remove_from_draft,
    answer: {
      intent: orNull(w.answer.intent),
      meal_type: orNull(w.answer.meal_type),
      time: str(w.answer.time),
      day_offset: int(w.answer.day_offset),
      number: w.answer.number < 0 ? null : w.answer.number,
      quantity: orNull(w.answer.quantity),
      feeling: orNull(w.answer.feeling),
    },
    query:
      w.kind === 'consulta'
        ? {
            kind: w.query.kind,
            foods: w.query.foods,
            meal_type: orNull(w.query.meal_type),
            symptom_types: w.query.symptom_types,
            from_day_offset: w.query.has_range ? int(w.query.from_day_offset) : null,
            to_day_offset: w.query.has_range ? int(w.query.to_day_offset) : null,
          }
        : null,
    reminder:
      w.kind === 'recordatorio'
        ? { text: w.reminder.text, time: str(w.reminder.time), day_offset: int(w.reminder.day_offset), in_minutes: w.reminder.in_minutes > 0 ? w.reminder.in_minutes : null, daily: w.reminder.daily }
        : null,
    saved_ref:
      w.kind === 'corregir_guardado' || w.kind === 'mover_guardado'
        ? {
            foods: w.saved_ref.foods,
            meal_type: orNull(w.saved_ref.meal_type),
            day_offset: w.saved_ref.has_day ? int(w.saved_ref.day_offset) : null,
            last: w.saved_ref.last,
            new_time: str(w.saved_ref.new_time),
            new_day_offset: int(w.saved_ref.new_day_offset),
          }
        : null,
    fast_time: str(w.fast_time),
    reply: w.reply,
  };
}

// ───────── Instrucciones ─────────

export const SYSTEM_PROMPT = `Eres el intérprete del asistente de DIGESTA, un diario digestivo personal en español de Colombia. Tu única tarea es convertir lo que la persona dicta (transcrito por el micrófono, con errores de reconocimiento, muletillas y frases largas) en datos estructurados. No respondes como chat: llenas el JSON.

Reglas generales
- Ubica cada cosa en su lugar: comidas y bebidas (meals), síntomas (symptoms), deposiciones (stools), agua (water_ml/hydration), cómo estuvo la digestión del día (digestion 1 muy mal … 5 muy bien).
- Horas en 24 h "HH:MM" y day_offset (0 hoy, -1 ayer, -2 antier). Resuelve a. m./p. m. con el contexto y la hora actual: los registros son del pasado; «a las 8» dicho de noche sobre la cena es 20:00, sobre el desayuno 08:00. «Ahorita», «hace un rato» → hora aproximada. Si no dijo hora, time = "" (vacío).
- Alimentos: nombre corto y natural en singular como lo diría una persona en Colombia («Arepa», «Huevo», «Queso campesino», «Batido de proteína», «Salchipapa»). Corrige errores evidentes del dictado («a mozzarella» → «Mozzarella», «omelet» → «Omelette»). Nunca conviertas en alimento palabras que no lo son (muletillas, cantidades, verbos, «poquitico», «normal», «rodajas», «día», «entre esos»).
- Cantidad: poca («poquito», «un poquitico», «media porción»), normal, abundante («bastante», «harto», «un platado»), o personalizada con custom_quantity («2 huevos» → quantity personalizada, custom_quantity "2"; «3 rodajas» → "3 rodajas").
- Preparación sólo si la dijo (frito, asado, cocido, al_vapor, tostado…).
- Platos compuestos: un solo alimento con ingredients («arepa con queso y mantequilla» → Arepa con ingredients [Queso, Mantequilla]; «omelette sin huevo, solo claras» → Omelette con ingredients [Claras de huevo]). Si menciona una lista de verduras o frutas, cada una es un alimento aparte o ingredientes del plato, según cómo lo diga.
- Agrupa por comida: lo que comió junto va en la misma meal. meal_type si lo dijo o es obvio por la hora; si sólo tomó una bebida (café, jugo, batido) usa «bebida» salvo que diga que fue el desayuno, etc.
- Agua: el agua NO va en meals. Si da cantidad, water_ml (vaso ≈ 250 ml, botella = tamaño indicado en el contexto, «un sorbo» ≈ 30 ml). Si dice que toma sorbos sin cantidad, water_vague true; si estima el día («hoy tomé poquita agua»), hydration.
- Síntomas: el tipo más cercano (hinchazon, gases, dolor, acidez, nauseas, retortijones, diarrea, estrenimiento, pesadez, eructos, vomito; si no encaja, otro con custom_name). Intensidad 0–10 sólo si la dijo o la describe claramente («fuertísimo» ≈ 8, «leve» ≈ 2). status en_curso si sigue, termino si ya pasó.
- Deposiciones: bristol 1–7 si se puede deducir («duras en bolitas» 1, «normal» 4, «blanda» 5–6, «líquida» 7); si no, 0. Sangre sólo si la menciona.
- Correcciones: si dice «perdón», «mejor dicho», «no, era…», «quita…», «no comí…», pon en remove_from_draft el nombre EXACTO del alimento del borrador que hay que quitar y agrega el correcto en meals. Para cambiar algo de un alimento que ya está en el borrador (cantidad, ingredientes, preparación, hora), quítalo y vuelve a ponerlo completo y corregido en meals con su hora.

kind
- registro: cuenta comidas, síntomas, deposiciones, agua o digestión (puede venir mezclado).
- respuesta: responde a la pregunta pendiente del asistente; llena answer (intent confirm para «sí/correcto/guárdalo», no, cancel para «cancela todo», skip para «no sé/sáltalo»; time/meal_type/number/quantity/feeling según lo que respondió). Si además agrega información nueva, llénala también.
- consulta: pregunta sobre lo que ya tiene guardado en su diario («¿qué cené ayer?», «recuérdame si ayer comí salchipapa», «¿cuándo fue la última vez que comí leche?», «¿cuántas veces tuve gases esta semana?»). OJO: «recuérdame si comí…» es CONSULTA, no recordatorio. Llena query: ate (¿comí X?), last_time, count_food, what_ate, symptoms, stools, digestion, water, fasts; from/to_day_offset del rango (has_range false si no hay rango).
- recordatorio: quiere que la app le avise algo en el futuro («recuérdame en 2 horas tomar la creatina», «avísame mañana a las 8…»). text = qué recordar, en infinitivo y corto. time/day_offset (day_offset 1 = mañana) o in_minutes. daily si es todos los días.
- corregir_guardado: quiere corregir algo YA GUARDADO, no del borrador («corrige la cena que me pusiste», «el último batido que registraste está mal»). saved_ref con foods, meal_type, day_offset, last.
- mover_guardado: cambiar la hora de algo ya guardado («el batido que registraste me lo tomé a las 4»). saved_ref con foods y new_time/new_day_offset.
- ayuno_inicio / ayuno_fin: empieza o termina un ayuno intermitente; fast_time la hora si la dijo. Si además cuenta qué comió al romper el ayuno, llénalo en meals.
- otro: no hay nada que registrar ni consultar.

reply: déjalo vacío casi siempre. Sólo si kind es «otro» y la persona pregunta cómo usar la app o algo general, escribe una respuesta muy corta (máx. 2 frases) en español de Colombia. Nunca des diagnósticos ni digas qué alimentos eliminar; si describe sangre abundante, heces negras, vómito con sangre, fiebre alta, dolor muy fuerte o pérdida de peso sin explicación, recomienda en reply buscar atención médica pronto.

Cuando algo no aplica: arreglos vacíos, textos "" (hora "" si no la dijo), «ninguno» en las listas de opciones, -1 en intensidad, duración y number, 0 en bristol, digestion, water_ml e in_minutes, y false en los sí/no. Los objetos query, reminder y saved_ref siempre van; llénalos sólo si kind es consulta, recordatorio, corregir_guardado o mover_guardado (si no, con rellenos). Una consulta sin rango de días lleva has_range false; saved_ref sin día indicado lleva has_day false.

Responde ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después, sin \`\`\`) con exactamente esta forma:
${TEMPLATE}`;

function contextText(raw: string, c: AiContext): string {
  const d = new Date(c.now);
  const weekday = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return [
    `Ahora: ${weekday}, ${hh} (hora local).`,
    `Botella habitual: ${c.bottleMl} ml.`,
    c.draft.length ? `Borrador de esta conversación (aún sin guardar):\n- ${c.draft.join('\n- ')}` : 'Borrador: vacío.',
    c.pending ? `Pregunta pendiente del asistente: «${c.pending}»` : 'No hay pregunta pendiente.',
    '',
    `La persona dijo: «${raw}»`,
  ].join('\n');
}

/** Pide a Claude que interprete la frase. Lanza AiError si no se pudo. */
export async function callClaude(raw: string, c: AiContext, prefs: AiPrefs): Promise<AiOutput> {
  const client = new Anthropic({ apiKey: prefs.apiKey.trim(), dangerouslyAllowBrowser: true, timeout: 45_000, maxRetries: 1 });
  try {
    const res = await client.messages.create({
      model: prefs.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextText(raw, c) }],
      output_config: { effort: 'low' },
    });
    if (res.stop_reason === 'refusal') throw new AiError('La IA no quiso procesar esta frase.', 'rechazo');
    if (res.stop_reason === 'max_tokens') throw new AiError('La respuesta de la IA quedó incompleta.', 'formato');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    let data: unknown;
    try {
      data = extractJson(text);
    } catch {
      throw new AiError('La IA respondió en un formato inesperado.', 'formato');
    }
    return fromWire(WireOutput.parse(data));
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('La clave de la IA no es válida. Revísala en Ajustes.', 'clave');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('La IA está recibiendo demasiadas solicitudes; intenta en un momento.', 'limite');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Sin conexión con la IA.', 'red');
    if (e instanceof Anthropic.APIError) {
      const msg = String(e.message ?? '');
      if (e.status === 400 && /credit|balance|billing/i.test(msg)) throw new AiError('Tu cuenta de Anthropic no tiene saldo.', 'saldo');
      // Se muestra el detalle que da Anthropic para poder diagnosticar
      const detail = msg.replace(/^\d{3}\s*/, '').replace(/\{.*"message":"([^"]+)".*\}/s, '$1').slice(0, 180).replace(/[.\s]+$/, '');
      throw new AiError(`La IA devolvió un error (${e.status ?? 'sin código'})${detail ? `: ${detail}` : ''}.`, 'otro');
    }
    throw new AiError('No pude usar la IA.', 'otro');
  }
}

