/** Recordatorios que le pediste al asistente: ver y eliminar. */
import { MessageSquareText, Trash2 } from 'lucide-react';
import { deleteCustomReminder } from '@/db/customReminders';
import { formatTime } from '@/domain/dates';
import type { CustomReminder } from '@/domain/types';
import { dayPhrase } from '@/voice/query';
import { Card, IconButton, SectionTitle, useToast } from '@/components/ui';
import { navigate } from '@/lib/router';

export function CustomRemindersList({ reminders }: { reminders: CustomReminder[] }) {
  const toast = useToast();
  const now = Date.now();
  return (
    <>
      <SectionTitle>Recordatorios del asistente</SectionTitle>
      <Card>
        {reminders.length === 0 ? (
          <p className="text-sm text-muted">
            Pídele al asistente cosas como «recuérdame en 2 horas tomar la creatina» o «recuérdame mañana a las 8 registrar el desayuno».{' '}
            <button type="button" className="font-semibold text-primary underline" onClick={() => navigate('/asistente')}>
              Abrir asistente
            </button>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <MessageSquareText size={18} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.text}</p>
                  <p className="text-sm text-muted">{r.daily ? `Todos los días a las ${formatTime(r.nextAt)}` : `${dayPhrase(r.nextAt, now).replace(/^el /, '')} a las ${formatTime(r.nextAt)}`}</p>
                </div>
                <IconButton
                  label={`Eliminar recordatorio ${r.text}`}
                  onClick={async () => {
                    await deleteCustomReminder(r.id);
                    toast('Recordatorio eliminado');
                  }}
                >
                  <Trash2 size={18} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
