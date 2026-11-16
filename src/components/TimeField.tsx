/**
 * Selector de fecha y hora pensado para el celular.
 *
 * No depende de los selectores nativos de fecha/hora (en algunos Android no
 * responden dentro de ventanas emergentes): usa atajos, listas simples
 * (día, hora, minutos, a. m./p. m.) y botones para ajustar ±15 min / ±1 h.
 */
import { addDays, dayKey, dayStart, formatShortDate, formatTime, relativeDayLabel, todayKey, weekdayShort } from '@/domain/dates';
import { Chip, cx, inputClass } from './ui';

const SHORTCUTS = [
  { label: 'Ahora', delta: 0 },
  { label: 'Hace 30 min', delta: 30 },
  { label: 'Hace 1 h', delta: 60 },
  { label: 'Hace 2 h', delta: 120 },
  { label: 'Hace 4 h', delta: 240 },
];

const ADJUST = [
  { label: '−1 h', min: -60 },
  { label: '−15 min', min: -15 },
  { label: '+15 min', min: 15 },
  { label: '+1 h', min: 60 },
];

/** Opciones de día: desde hace 14 días hasta hoy (o pasado mañana si se permite el futuro). */
function dayOptions(value: number, allowFuture: boolean): { key: string; label: string }[] {
  const today = todayKey();
  const out: { key: string; label: string }[] = [];
  for (let i = allowFuture ? 2 : 0; i >= -14; i--) {
    const k = addDays(today, i);
    const label = i === 0 ? 'Hoy' : i === -1 ? 'Ayer' : i === 1 ? 'Mañana' : i === -2 ? 'Antier' : `${weekdayShort(k)} ${formatShortDate(k)}`;
    out.push({ key: k, label });
  }
  const current = dayKey(value);
  if (!out.some((o) => o.key === current)) out.push({ key: current, label: formatShortDate(current, true) });
  return out;
}

function compose(day: string, h12: number, minute: number, pm: boolean): number {
  const h = (h12 % 12) + (pm ? 12 : 0);
  return dayStart(day) + h * 3600_000 + minute * 60_000;
}

export function TimeField({ value, onChange, label = 'Fecha y hora', allowFuture = false }: { value: number; onChange: (t: number) => void; label?: string; allowFuture?: boolean }) {
  const now = Date.now();
  const active = SHORTCUTS.find((s) => Math.abs(now - s.delta * 60_000 - value) < 60_000);
  const d = new Date(value);
  const day = dayKey(value);
  const h24 = d.getHours();
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = d.getMinutes();
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), minute])].sort((a, b) => a - b);
  const set = (t: number) => onChange(allowFuture ? t : Math.min(t, Date.now() + 5 * 60_000));

  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 flex w-full items-baseline justify-between text-sm font-semibold">
        <span>{label}</span>
        <span className="text-primary">
          {relativeDayLabel(day)} · {formatTime(value)}
        </span>
      </legend>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {SHORTCUTS.map((s) => (
          <Chip key={s.label} size="sm" selected={active === s} onClick={() => onChange(Date.now() - s.delta * 60_000)}>
            {s.label}
          </Chip>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-[1.3fr_0.9fr_1fr_1.1fr] gap-1.5">
        <select aria-label="Día" className={cx(inputClass, 'min-h-12 px-2 text-sm')} value={day} onChange={(e) => set(compose(e.target.value, h12, minute, pm))}>
          {dayOptions(value, allowFuture).map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select aria-label="Hora" className={cx(inputClass, 'min-h-12 px-2 text-center text-base font-semibold')} value={h12} onChange={(e) => set(compose(day, Number(e.target.value), minute, pm))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <select aria-label="Minutos" className={cx(inputClass, 'min-h-12 px-2 text-center text-base font-semibold')} value={minute} onChange={(e) => set(compose(day, h12, Number(e.target.value), pm))}>
          {minutes.map((m) => (
            <option key={m} value={m}>
              :{String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
        <select aria-label="a. m. o p. m." className={cx(inputClass, 'min-h-12 px-2 text-center text-sm font-semibold')} value={pm ? 'pm' : 'am'} onChange={(e) => set(compose(day, h12, minute, e.target.value === 'pm'))}>
          <option value="am">a.m.</option>
          <option value="pm">p.m.</option>
        </select>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {ADJUST.map((a) => (
          <button key={a.label} type="button" onClick={() => set(value + a.min * 60_000)} className="min-h-10 rounded-xl border border-border bg-surface text-sm font-semibold active:scale-95">
            {a.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
