/** Recordatorios pedidos al asistente (se guardan en la configuración local). */
import { getSettings, newId, updateSettings, ValidationError } from './repo';
import { DAY } from '@/domain/dates';
import type { CustomReminder } from '@/domain/types';

export async function addCustomReminder(input: { at: number; text: string; daily: boolean }, now = Date.now()): Promise<CustomReminder> {
  if (input.at <= now) throw new ValidationError('La hora del recordatorio ya pasó.');
  if (input.at > now + 366 * DAY) throw new ValidationError('Sólo puedo recordarte cosas dentro del próximo año.');
  const s = await getSettings();
  const r: CustomReminder = { id: newId(), nextAt: input.at, text: input.text.trim().slice(0, 200), daily: input.daily, createdAt: now };
  await updateSettings({ customReminders: [...s.customReminders, r].sort((a, b) => a.nextAt - b.nextAt) });
  return r;
}

export async function deleteCustomReminder(id: string): Promise<void> {
  const s = await getSettings();
  await updateSettings({ customReminders: s.customReminders.filter((r) => r.id !== id) });
}

/**
 * Recordatorios vencidos: devuelve los que hay que avisar (vencidos hace menos de
 * 12 h) y actualiza la lista (los diarios pasan al día siguiente; los únicos se borran).
 */
export async function takeDueReminders(now = Date.now()): Promise<{ reminder: CustomReminder; late: boolean }[]> {
  const s = await getSettings();
  const due = s.customReminders.filter((r) => r.nextAt <= now);
  if (!due.length) return [];
  const out = due.filter((r) => now - r.nextAt < 12 * 3600_000).map((r) => ({ reminder: r, late: now - r.nextAt > 10 * 60_000 }));
  const next = s.customReminders
    .map((r) => {
      if (r.nextAt > now || !r.daily) return r;
      let t = r.nextAt;
      while (t <= now) t += DAY;
      return { ...r, nextAt: t };
    })
    .filter((r) => r.nextAt > now);
  await updateSettings({ customReminders: next });
  return out;
}
