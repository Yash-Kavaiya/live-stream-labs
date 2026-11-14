import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live captions from the browser's own speech recognition (Chrome and Edge). It hears this
 * computer's microphone only, so it captures the teacher, not guests. Chrome ends a session after
 * a pause or about a minute, so a session that ends while captions are on is started again.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const captionsSupported = () => recognitionCtor() !== null;

export const CAPTION_LANGUAGES: { id: string; label: string }[] = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'hi-IN', label: 'हिन्दी' },
  { id: 'gu-IN', label: 'ગુજરાતી' },
  { id: 'mr-IN', label: 'मराठी' },
  { id: 'ta-IN', label: 'தமிழ்' },
  { id: 'es-ES', label: 'Español' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'de-DE', label: 'Deutsch' },
];

const ERRORS: Record<string, string> = {
  'not-allowed': 'The browser was not allowed to use the microphone. Allow it in the address bar, then start again.',
  'service-not-allowed': 'This browser does not offer speech recognition here. Use Chrome or Edge, or paste the transcript.',
  'audio-capture': 'No microphone was found.',
  network: 'Captions need an internet connection (the browser sends audio to its speech service).',
  'language-not-supported': 'That language is not available for captions in this browser.',
};

/**
 * `onFinal` receives each finished phrase; `interim` is the phrase still being heard.
 */
export function useLiveCaptions(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const final = useRef(onFinal);
  final.current = onFinal;

  const stop = useCallback(() => {
    wanted.current = false;
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError(ERRORS['service-not-allowed']!);
      return;
    }
    setError(null);
    wanted.current = true;
    const begin = () => {
      const r = new Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (event) => {
        let pending = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]!;
          const text = result[0].transcript.trim();
          if (!text) continue;
          if (result.isFinal) final.current(text);
          else pending += `${text} `;
        }
        setInterim(pending.trim());
      };
      r.onerror = (event) => {
        // "no-speech" and "aborted" just mean a quiet spell; the restart below handles them.
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        setError(ERRORS[event.error] ?? `Captions stopped (${event.error}).`);
        wanted.current = false;
      };
      r.onend = () => {
        setInterim('');
        if (wanted.current) {
          // Chrome ends sessions on its own; carry on after a breath.
          window.setTimeout(() => wanted.current && begin(), 250);
        } else {
          setListening(false);
        }
      };
      recognition.current = r;
      r.start();
    };
    begin();
    setListening(true);
  }, [lang]);

  // A new language takes effect on the next session.
  useEffect(() => {
    if (wanted.current) {
      stop();
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => stop, [stop]);

  return { listening, interim, error, start, stop };
}

/** The words of a caption file (.vtt or .srt), without cue numbers, timings and tags. */
export function captionFileText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t && t !== 'WEBVTT' && !/^\d+$/.test(t) && !/-->/.test(t) && !/^(NOTE|STYLE|REGION)\b/.test(t);
    })
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
