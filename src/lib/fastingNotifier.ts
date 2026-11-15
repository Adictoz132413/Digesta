/** Avisa cuando empieza un ayuno programado y cuando se cumple la meta (mientras la app esté abierta). */
import { useEffect } from 'react';
import { openFast, updateFast } from '@/db/fasting';
import { elapsedHours, fastState } from '@/domain/fasting';
import { formatTime } from '@/domain/dates';
import { notify } from './reminders';

export async function checkFast(now = Date.now()): Promise<void> {
  const f = await openFast();
  if (!f) return;
  const state = fastState(f, now);
  if (state === 'en_curso' && !f.notifiedStart && f.createdAt < f.startAt - 60_000) {
    await updateFast(f.id, { notifiedStart: true });
    await notify({ tag: 'ayuno-inicio', title: 'Empezó tu ayuno', body: `Meta: ${f.targetHours} horas. Agua, tinto o aromática sin azúcar están permitidos.`, url: '#/ayuno' });
  }
  if (state === 'en_curso' && !f.notifiedGoal && elapsedHours(f, now) >= f.targetHours) {
    await updateFast(f.id, { notifiedGoal: true });
    await notify({
      tag: 'ayuno-meta',
      title: '¡Cumpliste tu meta de ayuno!',
      body: `Llevas ${f.targetHours} horas desde las ${formatTime(f.startAt)}. Rompe el ayuno con una comida moderada y regístrala.`,
      url: '#/ayuno',
    });
  }
}

export function useFastingNotifier(): void {
  useEffect(() => {
    const run = () => void checkFast().catch(() => undefined);
    run();
    const t = setInterval(run, 30_000);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
}
