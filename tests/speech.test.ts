import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecognizer, mergeTranscript } from '@/voice/speech';

/** Reconocimiento falso que imita al de Chrome. */
class FakeSR {
  static instances: FakeSR[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  results: { isFinal: boolean; 0: { transcript: string }; length: number }[] = [];
  constructor() {
    FakeSR.instances.push(this);
  }
  start() {
    this.onstart?.();
  }
  stop() {
    setTimeout(() => this.onend?.(), 10);
  }
  abort() {
    this.onend?.();
  }
  say(text: string, isFinal: boolean) {
    const idx = this.results.length && !this.results[this.results.length - 1].isFinal ? this.results.length - 1 : this.results.length;
    this.results[idx] = { isFinal, 0: { transcript: text }, length: 1 };
    this.onresult?.({ resultIndex: idx, results: Object.assign([...this.results], { length: this.results.length }) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSR.instances = [];
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeSR;
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(silenceMs: number | null = 5000) {
  const finals: string[] = [];
  const ends = vi.fn();
  const rec = createRecognizer({ onDevice: false, silenceMs, onPartial: () => {}, onFinal: (t) => finals.push(t), onError: () => {}, onEnd: ends })!;
  rec.start();
  return { rec, finals, ends, sr: () => FakeSR.instances[FakeSR.instances.length - 1] };
}

describe('unir transcripciones', () => {
  it('no duplica cuando Android repite lo anterior', () => {
    expect(mergeTranscript('comí arroz', 'comí arroz y fríjoles')).toBe('comí arroz y fríjoles');
    expect(mergeTranscript('comí arroz y fríjoles', 'fríjoles')).toBe('comí arroz y fríjoles');
    expect(mergeTranscript('comí arroz', 'y una limonada')).toBe('comí arroz y una limonada');
    expect(mergeTranscript('', 'hola')).toBe('hola');
  });
});

describe('dictado largo', () => {
  it('escucha en modo continuo y no envía en una pausa corta', () => {
    const { finals, sr } = setup(5000);
    expect(sr().continuous).toBe(true);
    sr().say('almorcé arroz', true);
    vi.advanceTimersByTime(3000); // pausa de 3 s: todavía no se envía
    sr().say('fríjoles y carne asada', true);
    vi.advanceTimersByTime(4000);
    expect(finals).toHaveLength(0);
    vi.advanceTimersByTime(1500); // 5 s de silencio
    expect(finals).toEqual(['almorcé arroz fríjoles y carne asada']);
  });

  it('si el navegador corta solo, se reinicia y conserva el texto', () => {
    const { finals, sr, ends } = setup(null);
    sr().say('desayuné dos arepas', true);
    sr().onend?.(); // Android cierra el reconocimiento
    vi.advanceTimersByTime(200);
    expect(FakeSR.instances).toHaveLength(2);
    expect(ends).not.toHaveBeenCalled();
    sr().say('con queso y un tinto', true);
    vi.advanceTimersByTime(60_000); // sin envío automático por silencio
    expect(finals).toHaveLength(0);
  });

  it('«Listo» envía todo lo dictado; «Cancelar» no envía nada', () => {
    const a = setup(null);
    a.sr().say('cené pasta', true);
    a.sr().say('con pollo', false);
    a.rec.stop();
    vi.advanceTimersByTime(50);
    expect(a.finals).toEqual(['cené pasta con pollo']);
    expect(a.ends).toHaveBeenCalledTimes(1);
    const b = setup(null);
    b.sr().say('algo', true);
    b.rec.abort();
    expect(b.finals).toHaveLength(0);
  });

  it('las frases repetidas de Android no se duplican', () => {
    const { finals, sr, rec } = setup(null);
    sr().say('comí arroz', true);
    sr().say('comí arroz con pollo', true);
    rec.stop();
    vi.advanceTimersByTime(50);
    expect(finals).toEqual(['comí arroz con pollo']);
  });
});
