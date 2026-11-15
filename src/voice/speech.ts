/**
 * Voz ↔ texto en el navegador.
 *
 * - Reconocimiento: Web Speech API (`SpeechRecognition`). En Chrome reciente
 *   puede funcionar EN EL DISPOSITIVO (`processLocally`) si el paquete de
 *   idioma está instalado; si no, Chrome envía el audio a los servidores de
 *   Google para transcribirlo. DIGESTA nunca envía nada por su cuenta, y pide
 *   consentimiento antes de usar el modo en la nube.
 * - Lectura en voz alta: `speechSynthesis` (voces del sistema).
 */

// Tipos mínimos (la API no está en todas las versiones de lib.dom)
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [i: number]: SRAlternative;
}
interface SRResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface SRCtor {
  new (): SR;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  availableOnDevice?: (lang: string) => Promise<Availability>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}

export const VOICE_LANG = 'es-CO';

function ctor(): SRCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function recognitionSupported(): boolean {
  return !!ctor();
}

export type OnDeviceStatus = Availability | 'unsupported';

/** ¿Se puede reconocer la voz sin enviar audio fuera del teléfono? */
export async function onDeviceStatus(lang = VOICE_LANG): Promise<OnDeviceStatus> {
  const C = ctor();
  if (!C) return 'unsupported';
  try {
    if (C.available) return await C.available({ langs: [lang], processLocally: true });
    if (C.availableOnDevice) return await C.availableOnDevice(lang);
  } catch {
    /* idioma no soportado en el dispositivo */
    return 'unavailable';
  }
  return 'unsupported';
}

/** Descarga el paquete de idioma para reconocimiento en el dispositivo (lo hace Chrome). */
export async function installOnDevice(lang = VOICE_LANG): Promise<boolean> {
  const C = ctor();
  try {
    if (C?.install) return await C.install({ langs: [lang], processLocally: true });
    if (C?.installOnDevice) return await C.installOnDevice(lang);
  } catch {
    return false;
  }
  return false;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'No hay permiso para usar el micrófono. Actívalo en los permisos del sitio en Chrome.',
  'service-not-allowed': 'El dictado no está permitido en este navegador. Puedes usar el micrófono del teclado.',
  'no-speech': 'No escuché nada. Toca el micrófono e intenta de nuevo.',
  'audio-capture': 'No se encontró un micrófono disponible.',
  network: 'Sin conexión: el dictado de Chrome necesita internet en este teléfono. Puedes usar el micrófono del teclado (dictado sin conexión) o escribir.',
  'language-not-supported': 'El idioma español no está disponible para dictado en este teléfono.',
  aborted: '',
};

export interface Recognizer {
  start(): void;
  stop(): void;
  abort(): void;
}

export function createRecognizer(opts: {
  onDevice: boolean;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string, code: string) => void;
  onStart?: () => void;
  onEnd: () => void;
}): Recognizer | undefined {
  const C = ctor();
  if (!C) return undefined;
  const r = new C();
  r.lang = VOICE_LANG;
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  if (opts.onDevice && 'processLocally' in r) r.processLocally = true;
  let finalText = '';
  r.onstart = () => opts.onStart?.();
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += `${res[0].transcript} `;
      else interim += res[0].transcript;
    }
    opts.onPartial((finalText + interim).trim());
  };
  r.onerror = (e) => {
    const msg = ERRORS[e.error] ?? `Error de reconocimiento de voz (${e.error}).`;
    if (msg) opts.onError(msg, e.error);
  };
  r.onend = () => {
    const t = finalText.trim();
    finalText = '';
    if (t) opts.onFinal(t);
    opts.onEnd();
  };
  return {
    start: () => {
      try {
        r.start();
      } catch {
        /* ya estaba escuchando */
      }
    },
    stop: () => r.stop(),
    abort: () => r.abort(),
  };
}

// ───────── Lectura en voz alta ─────────

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'es-CO') ??
    voices.find((v) => v.lang === 'es-419' || v.lang === 'es-US' || v.lang === 'es-MX') ??
    voices.find((v) => v.lang.startsWith('es'))
  );
}

/** Lee un texto en voz alta. Llama a `onEnd` al terminar (o de inmediato si no hay voz). */
export function speak(text: string, onEnd?: () => void) {
  if (!ttsSupported() || !text) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  // Quitar símbolos que se leen mal
  const clean = text.replace(/[«»"]/g, '').replace(/(\d+)\/10/g, '$1 de 10');
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = VOICE_LANG;
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.05;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  u.onend = finish;
  u.onerror = finish;
  synth.speak(u);
  // Algunos Android no disparan onend: respaldo por duración estimada
  setTimeout(finish, Math.min(20_000, 1500 + clean.length * 70));
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

// ───────── Preferencias (por dispositivo) ─────────

export interface VoicePrefs {
  /** Leer en voz alta las respuestas y preguntas. */
  tts: boolean;
  /** Volver a escuchar automáticamente después de una pregunta. */
  autoListen: boolean;
  /** La persona aceptó usar el dictado de Chrome que puede usar la nube. */
  cloudConsent: boolean;
}

const PREFS_KEY = 'digesta:voz';
export const DEFAULT_VOICE_PREFS: VoicePrefs = { tts: true, autoListen: true, cloudConsent: false };

export function readVoicePrefs(): VoicePrefs {
  try {
    return { ...DEFAULT_VOICE_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_VOICE_PREFS;
  }
}

export function writeVoicePrefs(p: VoicePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: se usan los valores por defecto */
  }
}
