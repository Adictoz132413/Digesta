/** Avisa los recordatorios pedidos al asistente (mientras la app esté abierta o en segundo plano). */
import { useEffect } from 'react';
import { takeDueReminders } from '@/db/customReminders';
import { formatTime } from '@/domain/dates';
import { notify } from './reminders';

export async function checkCustomReminders(now = Date.now()) {
  for (const { reminder, late } of await takeDueReminders(now)) {
    await notify({
      tag: `voz-${reminder.id}`,
      title: 'Recordatorio',
      body: late ? `${reminder.text} (era para las ${formatTime(reminder.nextAt)})` : reminder.text,
      url: '#/hoy',
    });
  }
}

export function useCustomReminderScheduler(): void {
  useEffect(() => {
    const run = () => void checkCustomReminders().catch(() => undefined);
    run();
    const t = setInterval(run, 30_000);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
}
