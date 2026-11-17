/** Preferencias del asistente de voz (se guardan en este dispositivo). */
import { Mic } from 'lucide-react';
import { useState } from 'react';
import { installOnDevice, onDeviceStatus, readVoicePrefs, recognitionSupported, ttsSupported, writeVoicePrefs, type OnDeviceStatus, type VoicePrefs } from '@/voice/speech';
import { Button, Card, SectionTitle, Segmented, Switch, useToast } from '@/components/ui';
import { navigate } from '@/lib/router';

const STATUS_TEXT: Record<OnDeviceStatus, string> = {
  available: 'Disponible: Chrome reconoce tu voz dentro del teléfono, sin enviar audio.',
  downloadable: 'Puedes descargar el español para reconocer la voz sin conexión.',
  downloading: 'Descargando el español para reconocimiento sin conexión…',
  unavailable: 'No disponible en este teléfono: el dictado de Chrome usa los servidores de Google.',
  unsupported: 'Este navegador no ofrece reconocimiento en el dispositivo: el dictado de Chrome usa los servidores de Google.',
};

export function VoiceSection() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<VoicePrefs>(readVoicePrefs);
  const [status, setStatus] = useState<OnDeviceStatus | 'sin_comprobar'>('sin_comprobar');
  const update = (p: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    writeVoicePrefs(next);
  };
  return (
    <>
      <SectionTitle>Asistente de voz</SectionTitle>
      <Card>
        <p className="text-sm leading-relaxed text-muted">
          Cuéntale al asistente lo que comiste, cómo te sientes o si fuiste al baño. La interpretación y la ficha se hacen <strong className="text-text">en tu teléfono</strong>, salvo que actives la IA (abajo).
        </p>
        <Button className="mt-3" variant="soft" block onClick={() => navigate('/asistente')}>
          <Mic size={18} /> Abrir el asistente
        </Button>
        {ttsSupported() && <Switch checked={prefs.tts} onChange={(tts) => update({ tts })} label="Leer respuestas en voz alta" description="Usa las voces instaladas en el teléfono." />}
        {recognitionSupported() && (
          <>
            <Switch checked={prefs.autoListen} onChange={(autoListen) => update({ autoListen })} label="Conversación continua" description="Después de cada pregunta vuelve a escuchar sin tocar el micrófono." />
            <div className="py-2">
              <p className="font-medium">Cuándo enviar lo que dictas</p>
              <p className="mb-2 text-sm text-muted">El micrófono sigue escuchando aunque hagas pausas. Elige cuánto silencio esperar antes de enviar solo.</p>
              <Segmented
                label="Pausa antes de enviar"
                value={prefs.pauseSeconds}
                onChange={(pauseSeconds) => update({ pauseSeconds })}
                options={[
                  { value: 3, label: '3 s' },
                  { value: 5, label: '5 s' },
                  { value: 8, label: '8 s' },
                  { value: 0, label: 'Al tocar Listo' },
                ]}
              />
            </div>
            <div className="mt-2 rounded-2xl bg-surface-2 p-3 text-sm">
              <p className="font-semibold">Reconocimiento sin conexión</p>
              {status === 'sin_comprobar' ? (
                <>
                  <p className="text-muted">Comprueba si tu teléfono puede reconocer la voz sin enviar audio a internet.</p>
                  <Button size="sm" variant="secondary" className="mt-2" onClick={async () => setStatus(await onDeviceStatus())}>
                    Comprobar
                  </Button>
                </>
              ) : (
                <p className="text-muted">{STATUS_TEXT[status]}</p>
              )}
              {status === 'downloadable' && (
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={async () => {
                    const ok = await installOnDevice();
                    setStatus(await onDeviceStatus());
                    toast(ok ? 'Descarga iniciada' : 'No se pudo iniciar la descarga', { tone: ok ? 'ok' : 'error' });
                  }}
                >
                  Descargar español
                </Button>
              )}
            </div>
            {prefs.cloudConsent && (
              <Switch checked={prefs.cloudConsent} onChange={(cloudConsent) => update({ cloudConsent })} label="Permitir el dictado de Chrome en la nube" description="Si lo desactivas, el asistente te volverá a preguntar antes de usar el micrófono." />
            )}
          </>
        )}
        {!recognitionSupported() && <p className="mt-3 text-sm text-muted">Este navegador no permite dictado dentro de la app. Usa el micrófono de tu teclado en el campo de texto del asistente.</p>}
      </Card>
    </>
  );
}
