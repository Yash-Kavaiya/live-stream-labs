import type { RundownItem } from '@studio/shared';
import { Icon, IconButton, Slider } from '@studio/ui';
import { useEffect, useRef, useState } from 'react';

const STORE_KEY = 'studio.teleprompter';
const NUDGE_PX = 80;

interface Prefs {
  /** Scroll speed in pixels a second. */
  speed: number;
  /** Text size in pixels. */
  size: number;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function readPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Prefs>;
    return { speed: clamp(saved.speed, 20, 200, 60), size: clamp(saved.size, 18, 48, 28) };
  } catch {
    return { speed: 60, size: 28 };
  }
}

/** True while the host is typing somewhere, so a space or an arrow belongs to that field. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], md-outlined-text-field, md-filled-text-field, md-outlined-select, md-slider, md-dialog');
}

interface Props {
  item: RundownItem;
  /** "3 of 13" */
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev(): void;
  onNext(): void;
}

/**
 * The words of the item on air, for the host to read. It is part of the studio page and is never
 * drawn on the program canvas, so viewers cannot see it.
 */
export function Teleprompter({ item, position, hasPrev, hasNext, onPrev, onNext }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const [playing, setPlaying] = useState(false);
  const speed = useRef(prefs.speed);
  speed.current = prefs.speed;

  const change = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing: the choice just is not remembered.
    }
  };

  // A new item starts at the top, paused: the host starts it when they begin to speak.
  useEffect(() => {
    setPlaying(false);
    if (box.current) box.current.scrollTop = 0;
  }, [item.id]);

  // Scroll by elapsed time, so the speed is the same on any display.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let position = box.current?.scrollTop ?? 0;
    const step = (now: number) => {
      const el = box.current;
      if (!el) return;
      // The host may have scrolled by hand: carry on from where they left it.
      if (Math.abs(el.scrollTop - position) > 2) position = el.scrollTop;
      position += (speed.current * (now - last)) / 1000;
      last = now;
      el.scrollTop = position;
      if (position >= el.scrollHeight - el.clientHeight) return setPlaying(false);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === ' ') setPlaying((on) => !on);
      else if (event.key === 'ArrowRight') onNext();
      else if (event.key === 'ArrowLeft') onPrev();
      else if (event.key === 'ArrowDown') box.current?.scrollBy({ top: NUDGE_PX });
      else if (event.key === 'ArrowUp') box.current?.scrollBy({ top: -NUDGE_PX });
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onPrev]);

  const paragraphs = item.script.split(/\n+/).filter((p) => p.trim());

  return (
    <section className="teleprompter" aria-label="Teleprompter" data-testid="teleprompter">
      <div className="teleprompter-bar">
        <span className="chip primary"><Icon name="visibility_off" /> Only you see this</span>
        <span className="label-large truncate grow">{item.tag} · {item.headline}</span>
        <IconButton icon="skip_previous" label="Previous item (left arrow)" onClick={onPrev} disabled={!hasPrev} />
        <IconButton icon={playing ? 'pause' : 'play_arrow'} label={playing ? 'Pause scrolling (space)' : 'Start scrolling (space)'} variant="filled" onClick={() => setPlaying(!playing)} data-testid="teleprompter-play" />
        <IconButton icon="skip_next" label="Next item (right arrow)" onClick={onNext} disabled={!hasNext} />
        <span className="label-medium muted" data-testid="teleprompter-position">{position}</span>
      </div>

      <div className="teleprompter-body">
        <div ref={box} className="teleprompter-script" style={{ fontSize: prefs.size }} data-testid="teleprompter-script" tabIndex={0}>
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
          ) : (
            <>
              <p className="label-large muted" style={{ fontSize: '0.6em' }}>No script was written for this item.</p>
              <p>{item.headline}</p>
              {item.subhead && <p>{item.subhead}</p>}
              {item.points.split('\n').filter(Boolean).map((point) => <p key={point}>• {point}</p>)}
            </>
          )}
          {/* Room to scroll the last line up to reading height. */}
          <div style={{ height: '40%' }} />
        </div>
        {item.context && (
          <aside className="teleprompter-notes">
            <h4 className="label-large">Background</h4>
            <p className="body-medium">{item.context}</p>
          </aside>
        )}
      </div>

      <div className="teleprompter-settings">
        <Slider label="Speed" value={prefs.speed} onValue={(value) => change({ speed: value })} min={20} max={200} step={5} data-testid="teleprompter-speed" />
        <Slider label="Text size" value={prefs.size} onValue={(value) => change({ size: value })} min={18} max={48} format={(v) => `${v}px`} data-testid="teleprompter-size" />
      </div>
    </section>
  );
}
