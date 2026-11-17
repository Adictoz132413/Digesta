/** Conexión opcional del asistente con una IA real (Claude, de Anthropic). */
import { ExternalLink, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AI_MODELS, AiError, readAiPrefs, testAi, writeAiPrefs, type AiPrefs } from '@/voice/ai';
import { Button, Card, SectionTitle, Switch, cx, inputClass, useToast } from '@/components/ui';

export function AiSection() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<AiPrefs>(readAiPrefs);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const update = (p: Partial<AiPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    writeAiPrefs(next);
    setResult(undefined);
  };
  const keyOk = prefs.apiKey.trim().length > 20;

  return (
    <>
      <SectionTitle>Inteligencia artificial</SectionTitle>
      <Card>
        <div className="flex gap-3">
          <Sparkles className="mt-0.5 shrink-0 text-primary" size={22} />
          <p className="text-sm leading-relaxed text-muted">
            Conecta el asistente a <strong className="text-text">Claude</strong>, la IA de Anthropic, para que entienda frases largas, enredadas o con errores del micrófono. Sin IA, el asistente usa reglas dentro del teléfono.
          </p>
        </div>

        <div className="mt-3 rounded-2xl bg-surface-2 p-3 text-sm leading-relaxed">
          <p className="font-semibold">Qué se envía</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li>Sólo la frase que dictas o escribes, la fecha y hora, el borrador de esa conversación y la pregunta pendiente.</li>
            <li>Nunca tu diario guardado, fotos, copias ni informes: las preguntas sobre tu diario se responden en el teléfono.</li>
            <li>Va directo de tu teléfono a Anthropic con tu propia clave; DIGESTA no tiene servidores.</li>
            <li>Sin internet, o si la IA falla, el asistente sigue funcionando con las reglas locales.</li>
          </ul>
        </div>

        <Switch
          checked={prefs.enabled}
          onChange={(enabled) => {
            update({ enabled });
            if (enabled && !keyOk) toast('Pega tu clave de Anthropic para activarla', { tone: 'info' });
          }}
          label="Usar IA en el asistente"
          description={prefs.enabled && keyOk ? 'Activa' : prefs.enabled ? 'Falta la clave' : 'Desactivada: todo se interpreta en el teléfono'}
        />

        <label className="mt-2 block text-sm font-semibold" htmlFor="ai-key">
          Clave de API de Anthropic
        </label>
        <div className="relative mt-1">
          <input
            id="ai-key"
            type={show ? 'text' : 'password'}
            className={cx(inputClass, 'pr-12 font-mono text-sm')}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            value={prefs.apiKey}
            onChange={(e) => update({ apiKey: e.target.value.trim() })}
          />
          <button type="button" aria-label={show ? 'Ocultar clave' : 'Mostrar clave'} onClick={() => setShow(!show)} className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-muted">
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Créala en{' '}
          <a className="inline-flex items-center gap-0.5 font-semibold text-primary underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener">
            console.anthropic.com <ExternalLink size={11} />
          </a>{' '}
          (API Keys → Create Key). Se cobra por uso a tu cuenta de Anthropic: carga un saldo pequeño y pon un límite de gasto. La clave se guarda sólo en este teléfono y no va en las copias de seguridad.
        </p>

        <p className="mt-4 text-sm font-semibold">Modelo</p>
        <div className="mt-1 space-y-2" role="radiogroup" aria-label="Modelo de IA">
          {AI_MODELS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={prefs.model === m.value}
              onClick={() => update({ model: m.value })}
              className={cx('block w-full rounded-2xl border px-3.5 py-2.5 text-left transition active:scale-[0.99]', prefs.model === m.value ? 'border-primary bg-primary/10' : 'border-border bg-surface')}
            >
              <span className="block text-sm font-semibold">{m.label}</span>
              <span className="block text-xs text-muted">{m.description}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!keyOk || testing}
            onClick={async () => {
              setTesting(true);
              setResult(undefined);
              try {
                setResult({ ok: true, text: await testAi(prefs) });
              } catch (e) {
                setResult({ ok: false, text: e instanceof AiError ? e.message : 'No se pudo conectar.' });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? 'Probando…' : 'Probar conexión'}
          </Button>
          {prefs.apiKey && (
            <Button size="sm" variant="ghost" onClick={() => update({ apiKey: '', enabled: false })}>
              Borrar clave
            </Button>
          )}
        </div>
        {result && <p className={cx('mt-2 text-sm font-medium', result.ok ? 'text-good' : 'text-bad')}>{result.text}</p>}
      </Card>
    </>
  );
}
