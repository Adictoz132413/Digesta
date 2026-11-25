/**
 * Listas de metas listas para agregar con un toque (consejos de videos que la
 * persona pidió seguir). Cada acción respeta lo que dice la fuente; las
 * advertencias informan, no prohíben.
 */
import { PINEALON_CAUTION, type GoalInput } from '@/db/goals';

export interface GoalPreset {
  source: string;
  sourceUrl: string;
  /** De dónde salió el contenido de la lista. */
  basis: string;
  items: Omit<GoalInput, 'source' | 'sourceUrl'>[];
}

const NOT_APPROVED = 'No está aprobado como medicamento: se vende como «producto de investigación», sin dosis establecida en personas y con pureza variable según el vendedor.';

export const GOAL_PRESETS: GoalPreset[] = [
  {
    source: 'Dr. Norwitz · Sanar el intestino en 30 días',
    sourceUrl: 'https://www.youtube.com/watch?v=ndEfyeoq95w',
    basis: 'Resumen del video «How To Heal 20 Years of Gut Damage in 30 Days».',
    items: [
      {
        text: 'Hacer el «suspiro fisiológico»',
        detail: 'Una inhalación profunda, luego otra inhalación corta y una exhalación lenta. Según el video activa el nervio vago y ayuda a producir mucina que nutre las bacterias intestinales (min. 3:05).',
      },
      { text: 'Dejar 12 horas seguidas sin comer cada día', detail: 'Alimentación con tiempo restringido para que el intestino se repare (min. 6:43). Puedes llevarlo en la sección de ayuno.' },
      { text: 'No comer en las 3 horas antes de dormir', detail: 'Min. 6:43.' },
      {
        text: 'Priorizar alimentos fermentados: chucrut, kimchi y kéfir',
        detail: 'Mejor kéfir de oveja o de cabra. Según el video reducen la inflamación de forma más constante que la fibra (min. 7:32).',
      },
      {
        text: 'Considerar una dieta sin fibra (sólo en enfermedad inflamatoria intestinal grave)',
        detail: 'El video lo menciona para casos graves de EII (min. 9:32).',
        caution: 'Quitar la fibra sin indicación puede empeorar el estreñimiento y la microbiota. Hazlo sólo con tu médico o nutricionista, y anota cómo te va en el diario.',
      },
      {
        text: 'Tomar los probióticos específicos que recomienda',
        detail: 'Según el video podrían ayudar a atrapar microplásticos en el intestino. El resumen no dice cuáles: revisa el nombre de la cepa en el min. 10:52.',
      },
      { text: 'Comprar BPC-157', detail: 'Péptido para reparar tejidos y el revestimiento intestinal (min. 13:32).', caution: `${NOT_APPROVED} En EE. UU. la FDA lo puso en la lista de sustancias con posibles riesgos de seguridad y la Agencia Mundial Antidopaje lo prohíbe. Consúltalo con un médico.` },
      { text: 'Tomar BPC-157 con el estómago vacío', detail: 'El resumen no indica dosis ni por cuánto tiempo.' },
      {
        text: 'Comprar larazotida',
        detail: 'Según el video, bloquea la señal de la zonulina y protege contra la permeabilidad intestinal (min. 14:03).',
        caution: 'Es un fármaco experimental, no aprobado en ningún país; su estudio grande en celiaquía se suspendió por falta de eficacia. Lo que se vende en internet es «producto de investigación». Consúltalo con un médico.',
      },
      { text: 'Tomar larazotida 15 minutos antes de cada comida', detail: 'El resumen no indica dosis.' },
      { text: 'Comprar KPV', detail: 'Péptido que, según el video, entra a las células intestinales inflamadas y reduce la inflamación (min. 15:35).', caution: `${NOT_APPROVED} La evidencia es de laboratorio y animales. Consúltalo con un médico.` },
      { text: 'Tomar KPV', detail: 'El resumen no indica dosis ni horario.' },
    ],
  },
  {
    source: 'Dr. Norwitz · Dormir mejor (calidad antes que horas)',
    sourceUrl: 'https://www.youtube.com/watch?v=cgnfJtLc_pY',
    basis: 'Transcripción del video «How Much Sleep Do You Really Need?».',
    items: [
      { text: 'Mantener un horario de sueño constante', detail: 'Acostarte y levantarte a la misma hora todos los días (min. 8:40).' },
      { text: 'Tomar sol en la mañana', detail: 'Min. 8:40.' },
      { text: 'Reducir la luz brillante en la noche', detail: 'Min. 8:40.' },
      { text: 'Comprar magnesio L-treonato', detail: 'La forma de magnesio que, según el video, entra mejor al cerebro (min. 9:02).' },
      {
        text: 'Tomar 1 a 2 g de magnesio L-treonato 30 a 60 minutos antes de dormir',
        detail: 'Es el peso del compuesto, no del magnesio puro (min. 10:45).',
        caution: 'Si tienes enfermedad de los riñones, consúltalo antes. Sepáralo unas 2 horas de antibióticos como tetraciclinas o quinolonas y de medicamentos para la tiroides o la osteoporosis.',
      },
      { text: 'Dormir de lado', detail: 'En roedores, de lado el cerebro se «limpia» mejor durante el sueño; en personas no está probado (min. 11:49).' },
      {
        text: 'Comprar un dispositivo de luz y sonido a 40 Hz',
        detail: 'Estimulación «gamma» que en ratones ayudó al cerebro a limpiarse. Él deja ejemplos de aparatos en la descripción y en su boletín (min. 15:14).',
        caution: 'Las luces que parpadean pueden provocar convulsiones en personas con epilepsia o fotosensibilidad. En humanos sólo hay estudios de seguridad; el beneficio está demostrado en animales.',
      },
      { text: 'Usar la luz y el sonido a 40 Hz', detail: 'El video no da horario ni duración.' },
      {
        text: 'Comprar el péptido pinealon',
        detail: 'Para mejorar el sueño REM. Marca que usa él: Your Protocols (dice tener código de descuento) (min. 16:02 y 17:12).',
        caution: PINEALON_CAUTION,
      },
      { text: 'Tomar pinealon por vía oral', detail: 'El video no da dosis ni horario.' },
      {
        text: 'No obsesionarte con medir el sueño',
        detail: 'Si el anillo o la app de sueño te estresa, úsala menos: controla lo que puedes controlar (min. 11:10 y 18:16).',
      },
    ],
  },
  {
    source: 'Dr. Norwitz · El nervio vago contra la inflamación',
    sourceUrl: 'https://www.youtube.com/watch?v=uSJxTYX8YBA',
    basis: 'Transcripción del video «The Gut Health Trick I Wish I Knew 10 Years Ago».',
    items: [
      {
        text: 'Hacer unos minutos de «suspiro cíclico»',
        detail: 'Doble inhalación por la nariz y una exhalación larga y lenta por la boca. Alargar la exhalación activa el nervio vago y calma el sistema nervioso (min. 13:13).',
      },
      {
        text: 'Tratar la reducción del estrés como terapia para el intestino',
        detail: 'Date permiso de hacer actividades que te relajen y que disfrutes. Según el video, el estrés baja el tono vagal y empeora la inflamación intestinal (min. 15:07).',
      },
      {
        text: 'Comprar un estimulador no invasivo del nervio vago',
        detail: 'Aparatos que se ponen en la oreja o el cuello y dan pulsos eléctricos suaves. Él probó el Pulsetto, que va alrededor del cuello (min. 16:02).',
        caution:
          'Si tienes marcapasos u otro implante eléctrico, problemas del ritmo del corazón o epilepsia, o estás en embarazo, consúltalo antes. La aprobación de la FDA que menciona el video es para un implante en artritis reumatoide, no para estos aparatos externos.',
      },
      { text: 'Usar el estimulador del nervio vago', detail: 'Él dice sentirse más tranquilo y con menos hinchazón unos 7 minutos después de encenderlo. El video no da horario ni duración.' },
      {
        text: 'Observar cómo responde tu cuerpo a cada cambio',
        detail: '«La salud es un experimento N=1»: mantente curioso sobre tu propio cuerpo. Puedes anotar en DIGESTA cómo te sientes al empezar cada hábito (min. 16:02).',
      },
    ],
  },
];
