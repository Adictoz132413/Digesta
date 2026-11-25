/**
 * Listas de metas listas para agregar con un toque (consejos de videos que la
 * persona pidió seguir). Cada acción respeta lo que dice la fuente; las
 * advertencias informan, no prohíben.
 */
import type { GoalInput } from '@/db/goals';

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
];
