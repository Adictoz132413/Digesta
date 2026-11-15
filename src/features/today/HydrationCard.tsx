/**
 * Tarjeta de hidratación de Hoy. Se adapta a cómo tomas agua:
 * a sorbos (estimado), en botella (fracciones) o por vasos.
 */
import { Droplets, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { patchDailyLog, updateSettings } from '@/db/repo';
import { BOTTLE_SIZES, GLASS_ML, HYDRATION_LEVELS, HYDRATION_MODES, URINE_TIP, formatBottles, formatMl, glassesToMl, mlToGlasses } from '@/domain/hydration';
import type { DailyLog, HydrationLevel, Settings } from '@/domain/types';
import { Card, Chip, cx, errorMessage, toneBg, useToast } from '@/components/ui';

export function HydrationCard({ day, log, settings }: { day: string; log?: DailyLog; settings: Settings }) {
  const toast = useToast();
  const [config, setConfig] = useState(false);
  const water = log?.water ?? 0;
  const goalMl = settings.waterGoal * GLASS_ML;

  const patch = async (p: Partial<Pick<DailyLog, 'water' | 'hydration'>>) => {
    try {
      await patchDailyLog(day, p);
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    }
  };
  const setGlasses = (g: number) => patch({ water: Math.max(0, Math.min(40, Math.round(g * 100) / 100)) });
  const setLevel = (h: HydrationLevel) => patch({ hydration: log?.hydration === h ? undefined : h });

  return (
    <Card className="!p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <Droplets size={15} className="text-primary" /> Hidratación (opcional)
        </p>
        <button type="button" onClick={() => setConfig((c) => !c)} aria-expanded={config} className="-mr-1 -mt-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-primary">
          <Settings2 size={14} /> {HYDRATION_MODES.find((m) => m.value === settings.hydrationMode)?.label}
        </button>
      </div>

      {config && (
        <div className="animate-fade mt-2 rounded-2xl bg-surface-2 p-3">
          <p className="mb-2 text-sm font-semibold">¿Cómo tomas agua?</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Forma de registrar el agua">
            {HYDRATION_MODES.map((m) => (
              <Chip key={m.value} size="sm" role="radio" aria-checked={settings.hydrationMode === m.value} selected={settings.hydrationMode === m.value} onClick={() => void updateSettings({ hydrationMode: m.value })}>
                {m.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{HYDRATION_MODES.find((m) => m.value === settings.hydrationMode)?.description}</p>
          {settings.hydrationMode === 'botella' && (
            <>
              <p className="mb-2 mt-3 text-sm font-semibold">Tamaño de tu botella</p>
              <div className="flex flex-wrap gap-2">
                {BOTTLE_SIZES.map((ml) => (
                  <Chip key={ml} size="sm" selected={settings.bottleMl === ml} onClick={() => void updateSettings({ bottleMl: ml })}>
                    {formatMl(ml)}
                  </Chip>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {settings.hydrationMode === 'sorbos' && (
        <>
          <p className="mt-1 text-[15px] font-bold">¿Cuánta agua has tomado hoy?</p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Cuánta agua has tomado hoy">
            {HYDRATION_LEVELS.map((h) => {
              const sel = log?.hydration === h.value;
              return (
                <button
                  key={h.value}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => void setLevel(h.value)}
                  className={cx('flex min-h-14 flex-col items-center justify-center rounded-2xl border text-sm font-bold transition active:scale-95', sel ? cx('border-transparent ring-2 ring-current', toneBg[h.tone]) : 'border-border bg-surface')}
                >
                  <span aria-hidden>{h.emoji}</span>
                  {h.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">
            A sorbos basta con un estimado; puedes cambiarlo al final del día.{water > 0 ? ` También anotaste ≈ ${formatMl(glassesToMl(water))}.` : ''}
          </p>
        </>
      )}

      {settings.hydrationMode === 'botella' && (
        <BottleCounter
          bottles={glassesToMl(water) / settings.bottleMl}
          bottleMl={settings.bottleMl}
          goalMl={goalMl}
          onChange={(b) => void setGlasses(mlToGlasses(b * settings.bottleMl))}
        />
      )}

      {settings.hydrationMode === 'vasos' && (
        <>
          <div className="mt-1 flex items-center justify-between">
            <p className="tabular text-xl font-extrabold">
              {Number.isInteger(water) ? water : water.toLocaleString('es-CO', { maximumFractionDigits: 1 })} <span className="text-sm font-semibold text-muted">/ {settings.waterGoal} vasos</span>
            </p>
            <div className="flex gap-2">
              <button type="button" aria-label="Quitar un vaso de agua" onClick={() => void setGlasses(Math.max(0, water - 1))} disabled={water === 0} className="size-11 rounded-full border border-border text-xl font-bold disabled:opacity-40">
                −
              </button>
              <button type="button" aria-label="Agregar un vaso de agua" onClick={() => void setGlasses(water + 1)} className="size-11 rounded-full bg-primary text-xl font-bold text-on-primary">
                +
              </button>
            </div>
          </div>
          <div className="mt-3 flex gap-1" aria-hidden>
            {Array.from({ length: settings.waterGoal }, (_, i) => (
              <span key={i} className={cx('h-2 flex-1 rounded-full', i < water ? 'bg-primary' : 'bg-surface-3')} />
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-[11px] leading-snug text-muted">{URINE_TIP}</p>
    </Card>
  );
}

function BottleCounter({ bottles, bottleMl, goalMl, onChange }: { bottles: number; bottleMl: number; goalMl: number; onChange: (b: number) => void }) {
  const q = Math.round(bottles * 4) / 4;
  const ml = q * bottleMl;
  const progress = Math.min(1, ml / goalMl);
  return (
    <>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div>
          <p className="tabular text-xl font-extrabold">
            {formatBottles(q)} <span className="text-sm font-semibold text-muted">{q > 0 && q < 1 ? 'de botella' : q === 1 ? 'botella' : 'botellas'} de {formatMl(bottleMl)}</span>
          </p>
          <p className="text-xs text-muted">
            ≈ {formatMl(ml)} de {formatMl(goalMl)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" aria-label="Quitar un cuarto de botella" onClick={() => onChange(Math.max(0, q - 0.25))} disabled={q === 0} className="h-11 min-w-11 rounded-full border border-border px-2 text-sm font-bold disabled:opacity-40">
            −¼
          </button>
          <button type="button" aria-label="Agregar un cuarto de botella" onClick={() => onChange(q + 0.25)} className="h-11 min-w-11 rounded-full border border-primary px-2 text-sm font-bold text-primary">
            +¼
          </button>
          <button type="button" aria-label="Agregar media botella" onClick={() => onChange(q + 0.5)} className="h-11 min-w-11 rounded-full bg-primary px-2 text-sm font-bold text-on-primary">
            +½
          </button>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
    </>
  );
}
