/** Tarjeta compacta del ayuno para la pantalla Hoy. */
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Timer } from 'lucide-react';
import { openFast } from '@/db/fasting';
import { formatDuration, formatTime, HOUR } from '@/domain/dates';
import { elapsedHours, fastState } from '@/domain/fasting';
import { navigate } from '@/lib/router';
import { cx } from '@/components/ui';

export function FastingCard({ now }: { now: number }) {
  const fast = useLiveQuery(() => openFast(), []);
  const state = fast ? fastState(fast, now) : undefined;
  const elapsed = fast ? elapsedHours(fast, now) : 0;
  const progress = fast ? Math.min(1, elapsed / fast.targetHours) : 0;
  return (
    <button type="button" onClick={() => navigate('/ayuno')} className="mt-2.5 flex w-full items-center gap-3 rounded-3xl border border-border bg-surface p-4 text-left shadow-card">
      <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-2xl', state === 'en_curso' ? 'bg-primary text-on-primary' : 'bg-primary-soft text-primary')}>
        <Timer size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-muted">Ayuno intermitente</span>
        {state === 'en_curso' && fast ? (
          <>
            <span className="block font-bold">
              {formatDuration(Math.round(elapsed * 60))} de {fast.targetHours} h{progress >= 1 ? ' · ¡meta cumplida!' : ''}
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-3">
              <span className={cx('block h-full rounded-full', progress >= 1 ? 'bg-good' : 'bg-primary')} style={{ width: `${progress * 100}%` }} />
            </span>
            {progress < 1 && <span className="mt-1 block text-xs text-muted">Podrás comer a las {formatTime(fast.startAt + fast.targetHours * HOUR)}</span>}
          </>
        ) : state === 'programado' && fast ? (
          <span className="block font-bold">Programado: empieza a las {formatTime(fast.startAt)}</span>
        ) : (
          <span className="block font-bold">Planea un día de ayuno</span>
        )}
      </span>
      <ChevronRight size={20} className="text-muted" />
    </button>
  );
}
