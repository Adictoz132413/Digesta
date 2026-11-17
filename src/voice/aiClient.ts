/**
 * Llamada a Claude (se carga sólo cuando la IA está activada).
 * Contiene el formato de respuesta y las instrucciones.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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

// ───────── Instrucciones ─────────

export const SYSTEM_PROMPT = `Eres el intérprete del asistente de DIGESTA, un diario digestivo personal en español de Colombia. Tu única tarea es convertir lo que la persona dicta (transcrito por el micrófono, con errores de reconocimiento, muletillas y frases largas) en datos estructurados. No respondes como chat: llenas el JSON.

Reglas generales
- Ubica cada cosa en su lugar: comidas y bebidas (meals), síntomas (symptoms), deposiciones (stools), agua (water_ml/hydration), cómo estuvo la digestión del día (digestion 1 muy mal … 5 muy bien).
- Horas en 24 h "HH:MM" y day_offset (0 hoy, -1 ayer, -2 antier). Resuelve a. m./p. m. con el contexto y la hora actual: los registros son del pasado; «a las 8» dicho de noche sobre la cena es 20:00, sobre el desayuno 08:00. «Ahorita», «hace un rato» → hora aproximada. Si no dijo hora, time = null.
- Alimentos: nombre corto y natural en singular como lo diría una persona en Colombia («Arepa», «Huevo», «Queso campesino», «Batido de proteína», «Salchipapa»). Corrige errores evidentes del dictado («a mozzarella» → «Mozzarella», «omelet» → «Omelette»). Nunca conviertas en alimento palabras que no lo son (muletillas, cantidades, verbos, «poquitico», «normal», «rodajas», «día», «entre esos»).
- Cantidad: poca («poquito», «un poquitico», «media porción»), normal, abundante («bastante», «harto», «un platado»), o personalizada con custom_quantity («2 huevos» → quantity personalizada, custom_quantity "2"; «3 rodajas» → "3 rodajas").
- Preparación sólo si la dijo (frito, asado, cocido, al_vapor, tostado…).
- Platos compuestos: un solo alimento con ingredients («arepa con queso y mantequilla» → Arepa con ingredients [Queso, Mantequilla]; «omelette sin huevo, solo claras» → Omelette con ingredients [Claras de huevo]). Si menciona una lista de verduras o frutas, cada una es un alimento aparte o ingredientes del plato, según cómo lo diga.
- Agrupa por comida: lo que comió junto va en la misma meal. meal_type si lo dijo o es obvio por la hora; si sólo tomó una bebida (café, jugo, batido) usa «bebida» salvo que diga que fue el desayuno, etc.
- Agua: el agua NO va en meals. Si da cantidad, water_ml (vaso ≈ 250 ml, botella = tamaño indicado en el contexto, «un sorbo» ≈ 30 ml). Si dice que toma sorbos sin cantidad, water_vague true; si estima el día («hoy tomé poquita agua»), hydration.
- Síntomas: el tipo más cercano (hinchazon, gases, dolor, acidez, nauseas, retortijones, diarrea, estrenimiento, pesadez, eructos, vomito; si no encaja, otro con custom_name). Intensidad 0–10 sólo si la dijo o la describe claramente («fuertísimo» ≈ 8, «leve» ≈ 2). status en_curso si sigue, termino si ya pasó.
- Deposiciones: bristol 1–7 si se puede deducir («duras en bolitas» 1, «normal» 4, «blanda» 5–6, «líquida» 7); si no, null. Sangre sólo si la menciona.
- Correcciones: si dice «perdón», «mejor dicho», «no, era…», «quita…», «no comí…», pon en remove_from_draft el nombre EXACTO del alimento del borrador que hay que quitar y agrega el correcto en meals. Para cambiar algo de un alimento que ya está en el borrador (cantidad, ingredientes, preparación, hora), quítalo y vuelve a ponerlo completo y corregido en meals con su hora.

kind
- registro: cuenta comidas, síntomas, deposiciones, agua o digestión (puede venir mezclado).
- respuesta: responde a la pregunta pendiente del asistente; llena answer (intent confirm para «sí/correcto/guárdalo», no, cancel para «cancela todo», skip para «no sé/sáltalo»; time/meal_type/number/quantity/feeling según lo que respondió). Si además agrega información nueva, llénala también.
- consulta: pregunta sobre lo que ya tiene guardado en su diario («¿qué cené ayer?», «recuérdame si ayer comí salchipapa», «¿cuándo fue la última vez que comí leche?», «¿cuántas veces tuve gases esta semana?»). OJO: «recuérdame si comí…» es CONSULTA, no recordatorio. Llena query: ate (¿comí X?), last_time, count_food, what_ate, symptoms, stools, digestion, water, fasts; from/to_day_offset del rango (null = sin rango).
- recordatorio: quiere que la app le avise algo en el futuro («recuérdame en 2 horas tomar la creatina», «avísame mañana a las 8…»). text = qué recordar, en infinitivo y corto. time/day_offset (day_offset 1 = mañana) o in_minutes. daily si es todos los días.
- corregir_guardado: quiere corregir algo YA GUARDADO, no del borrador («corrige la cena que me pusiste», «el último batido que registraste está mal»). saved_ref con foods, meal_type, day_offset, last.
- mover_guardado: cambiar la hora de algo ya guardado («el batido que registraste me lo tomé a las 4»). saved_ref con foods y new_time/new_day_offset.
- ayuno_inicio / ayuno_fin: empieza o termina un ayuno intermitente; fast_time la hora si la dijo. Si además cuenta qué comió al romper el ayuno, llénalo en meals.
- otro: no hay nada que registrar ni consultar.

reply: déjalo vacío casi siempre. Sólo si kind es «otro» y la persona pregunta cómo usar la app o algo general, escribe una respuesta muy corta (máx. 2 frases) en español de Colombia. Nunca des diagnósticos ni digas qué alimentos eliminar; si describe sangre abundante, heces negras, vómito con sangre, fiebre alta, dolor muy fuerte o pérdida de peso sin explicación, recomienda en reply buscar atención médica pronto.

Todos los arreglos vacíos y campos null cuando no aplican.`;

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
    const res = await client.messages.parse({
      model: prefs.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextText(raw, c) }],
      output_config: { effort: 'low', format: zodOutputFormat(AiOutput) },
    });
    if (res.stop_reason === 'refusal') throw new AiError('La IA no quiso procesar esta frase.', 'rechazo');
    if (!res.parsed_output) throw new AiError('La IA respondió en un formato inesperado.', 'formato');
    return res.parsed_output;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('La clave de la IA no es válida. Revísala en Ajustes.', 'clave');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('La IA está recibiendo demasiadas solicitudes; intenta en un momento.', 'limite');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Sin conexión con la IA.', 'red');
    if (e instanceof Anthropic.APIError) {
      const msg = String(e.message ?? '');
      if (e.status === 400 && /credit|balance|billing/i.test(msg)) throw new AiError('Tu cuenta de Anthropic no tiene saldo.', 'saldo');
      throw new AiError(`La IA devolvió un error (${e.status ?? 'sin código'}).`, 'otro');
    }
    throw new AiError('No pude usar la IA.', 'otro');
  }
}

