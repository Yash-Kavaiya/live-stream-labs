import { Icon, Switch } from '@studio/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { BACKDROPS, backdropUrl, pictureToDataUrl } from './backdrops';
import type { CameraEffect, MicPrefs } from './camera-effects';

const POPOVER_WIDTH = 340;

/**
 * A panel that opens above the control it belongs to. It closes on Escape or a press outside.
 * On a phone the stylesheet turns it into a sheet across the bottom of the screen.
 */
export function Popover({
  open,
  onClose,
  anchor,
  label,
  children,
  'data-testid': testId,
}: {
  open: boolean;
  onClose(): void;
  anchor: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  'data-testid'?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: 8, bottom: 8 });

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      setPlace({
        left: Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8)),
        bottom: window.innerHeight - rect.top + 12,
      });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: PointerEvent) => {
      // composedPath sees through the shadow DOM of the Material controls inside the panel.
      const path = event.composedPath();
      if (panel.current && !path.includes(panel.current) && !(anchor.current && path.includes(anchor.current))) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <div
      ref={panel}
      className="popover col"
      role="dialog"
      aria-label={label}
      data-testid={testId}
      style={{ '--popover-left': `${place.left}px`, '--popover-bottom': `${place.bottom}px`, width: POPOVER_WIDTH } as React.CSSProperties}
    >
      <h2 className="title-small">{label}</h2>
      {children}
    </div>
  );
}

/** The small arrow beside a control-bar button that opens its options. */
export function OptionsCaret({
  label,
  open,
  onClick,
  ref,
  'data-testid': testId,
}: {
  label: string;
  open: boolean;
  onClick(): void;
  ref: RefObject<HTMLButtonElement | null>;
  'data-testid'?: string;
}) {
  return (
    <button ref={ref} type="button" className="control-caret" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} onClick={onClick} data-testid={testId}>
      <Icon name={open ? 'expand_more' : 'expand_less'} />
    </button>
  );
}

// ---------- Microphone ----------

export function MicOptions({ prefs, onChange }: { prefs: MicPrefs; onChange(prefs: MicPrefs): void }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <Switch label="Noise suppression" selected={prefs.noiseSuppression} onChange={(noiseSuppression) => onChange({ ...prefs, noiseSuppression })} data-testid="mic-noise" />
      <Switch label="Echo cancellation" selected={prefs.echoCancellation} onChange={(echoCancellation) => onChange({ ...prefs, echoCancellation })} data-testid="mic-echo" />
      <Switch label="Automatic volume" selected={prefs.autoGainControl} onChange={(autoGainControl) => onChange({ ...prefs, autoGainControl })} data-testid="mic-gain" />
      <p className="body-small muted">Turn these off for music or a studio microphone with its own processing.</p>
    </div>
  );
}

/**
 * A live input level bar. `getTrack` is asked again every half second because the microphone
 * track is replaced whenever the device or its processing changes.
 */
export function MicLevel({ getTrack }: { getTrack(): MediaStreamTrack | null | undefined }) {
  const bar = useRef<HTMLDivElement>(null);
  const read = useRef(getTrack);
  read.current = getTrack;

  useEffect(() => {
    const Context = window.AudioContext;
    if (!Context) return;
    const audio = new Context();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    const samples = new Float32Array(analyser.fftSize);
    let source: MediaStreamAudioSourceNode | null = null;
    let current: MediaStreamTrack | null = null;
    let level = 0;
    let frame = 0;

    const connect = () => {
      const track = read.current() ?? null;
      if (track === current) return;
      source?.disconnect();
      current = track;
      source = track ? audio.createMediaStreamSource(new MediaStream([track])) : null;
      source?.connect(analyser);
    };
    connect();
    const poll = setInterval(connect, 500);

    const draw = () => {
      frame = requestAnimationFrame(draw);
      let peak = 0;
      if (current?.enabled && current.readyState === 'live') {
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      // Rise at once, fall slowly, so the bar is readable.
      level = Math.max(peak, level * 0.92);
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, level * 1.6).toFixed(3)})`;
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(poll);
      source?.disconnect();
      void audio.close();
    };
  }, []);

  return (
    <div className="mic-level" role="img" aria-label="Microphone level" data-testid="mic-level">
      <div ref={bar} className="mic-level-bar" />
    </div>
  );
}

// ---------- Camera ----------

function sameEffect(a: CameraEffect, b: CameraEffect): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'blur') return a.strength === (b as typeof a).strength;
  if (a.kind === 'backdrop') return a.id === (b as typeof a).id;
  return true;
}

/** Every camera background on offer, as a grid of pictures. */
export function EffectPicker({
  effect,
  onChange,
  supported,
  onError,
}: {
  effect: CameraEffect;
  onChange(effect: CameraEffect): void;
  supported: boolean;
  onError(err: unknown): void;
}) {
  // The user's own picture stays on offer after they pick something else.
  const [own, setOwn] = useState(effect.kind === 'image' ? effect.url : null);

  if (!supported) {
    return <p className="body-small muted" data-testid="effects-unsupported">Camera backgrounds are not available in this browser.</p>;
  }

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await pictureToDataUrl(file);
      setOwn(url);
      onChange({ kind: 'image', url });
    } catch (err) {
      onError(err);
    }
  };

  const choices: { id: string; label: string; value: CameraEffect; icon?: string; picture?: string | null }[] = [
    { id: 'none', label: 'None', value: { kind: 'none' }, icon: 'block' },
    { id: 'blur-light', label: 'Light blur', value: { kind: 'blur', strength: 'light' }, icon: 'blur_on' },
    { id: 'blur-medium', label: 'Medium blur', value: { kind: 'blur', strength: 'medium' }, icon: 'blur_circular' },
    { id: 'blur-strong', label: 'Strong blur', value: { kind: 'blur', strength: 'strong' }, icon: 'lens_blur' },
    ...BACKDROPS.map((b) => ({ id: b.id, label: b.label, value: { kind: 'backdrop' as const, id: b.id }, picture: backdropUrl(b.id, 160, 90) })),
    ...(own ? [{ id: 'own', label: 'Your picture', value: { kind: 'image' as const, url: own }, picture: own }] : []),
  ];

  return (
    <div className="effect-grid" role="group" aria-label="Camera background">
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className="effect-tile"
          title={choice.label}
          aria-label={choice.label}
          aria-pressed={sameEffect(effect, choice.value)}
          data-testid={`effect-${choice.id}`}
          onClick={() => onChange(choice.value)}
        >
          {choice.picture ? <img src={choice.picture} alt="" /> : <Icon name={choice.icon!} />}
          <span className="label-medium effect-name">{choice.label}</span>
        </button>
      ))}
      <label className="effect-tile upload" title="Use your own picture">
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} data-testid="effect-upload" />
        <Icon name="add_photo_alternate" />
        <span className="label-medium effect-name">Upload</span>
      </label>
    </div>
  );
}
