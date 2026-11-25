/** Tarjeta compacta de la lista de metas para la pantalla Hoy. */
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, ListChecks } from 'lucide-react';
import { getDb } from '@/db/db';
import { navigate } from '@/lib/router';
import { cx } from '@/components/ui';

export function GoalsCard() {
  const goals = useLiveQuery(() => getDb().goals.toArray(), [], []);
  const done = goals.filter((g) => g.done).length;
  const progress = goals.length ? done / goals.length : 0;
  const next = goals.filter((g) => !g.done).sort((a, b) => a.order - b.order)[0];
  return (
    <button type="button" onClick={() => navigate('/metas')} className="mt-2.5 flex w-full items-center gap-3 rounded-3xl border border-border bg-surface p-4 text-left shadow-card">
      <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-2xl', goals.length && done === goals.length ? 'bg-good text-white' : 'bg-primary-soft text-primary')}>
        <ListChecks size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-muted">Mis metas</span>
        {goals.length ? (
          <>
            <span className="block font-bold">
              {done} de {goals.length} cumplidas
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-3">
              <span className={cx('block h-full rounded-full', done === goals.length ? 'bg-good' : 'bg-primary')} style={{ width: `${progress * 100}%` }} />
            </span>
            {next && <span className="mt-1 block truncate text-xs text-muted">Sigue: {next.text}</span>}
          </>
        ) : (
          <span className="block font-bold">Arma tu lista de consejos para cumplir</span>
        )}
      </span>
      <ChevronRight size={20} className="text-muted" />
    </button>
  );
}
