import { hitsStroke, makeStroke, SHAPE_TOOLS, type InkStroke, type InkTool } from '@studio/shared';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ClassRequest } from '../class-ink';
import { drawInk, drawStroke, fitSurface, type Surface } from '../graphics/ink';

export type InkToolId = InkTool | 'eraser';
export type InkSize = 'S' | 'M' | 'L';

export interface InkSettings {
  tool: InkToolId;
  color: string;
  size: InkSize;
}

const WIDTHS: Record<'line' | 'highlighter' | 'text', Record<InkSize, number>> = {
  line: { S: 2.5, M: 4.5, L: 8 },
  highlighter: { S: 14, M: 24, L: 38 },
  text: { S: 22, M: 32, L: 48 },
};

export function strokeWidth(tool: InkTool, size: InkSize): number {
  return tool === 'highlighter' ? WIDTHS.highlighter[size] : tool === 'text' ? WIDTHS.text[size] : WIDTHS.line[size];
}

/** How close the eraser must come to a stroke, as a fraction of the surface width. */
const ERASER_REACH = 0.012;

interface Props {
  surfaceKey: string;
  strokes: InkStroke[];
  /** Paints what sits under the ink: the whiteboard page or the slide. */
  background(ctx: CanvasRenderingContext2D, surface: Surface): void;
  /** Bumped when the background changes in a way the canvas cannot see (an image loaded). */
  backgroundVersion?: unknown;
  settings: InkSettings;
  send(req: ClassRequest): void;
  disabled?: boolean;
  /** Changes when the studio turns a stroke away (the page is full), so the unsaved one goes. */
  resetToken?: unknown;
}

/**
 * A 16:9 surface to draw on with mouse, pen or finger. Strokes go to the studio as they are drawn
 * (so the stream shows them live) and are saved there when the pen lifts.
 */
export function InkCanvas({ surfaceKey, strokes, background, backgroundVersion, settings, send, disabled, resetToken }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const drag = useRef<{ points: number[]; stroke: InkStroke } | null>(null);
  const erasing = useRef<Set<number> | null>(null);
  // A stroke just finished, drawn until the studio's copy arrives, so nothing flickers.
  const [pending, setPending] = useState<InkStroke[]>([]);
  const [text, setText] = useState<{ x: number; y: number; value: string } | null>(null);
  const frame = useRef(0);
  const liveQueued = useRef(false);

  useEffect(() => setPending([]), [strokes, surfaceKey, resetToken]);

  useEffect(() => {
    const el = wrap.current!;
    const observer = new ResizeObserver(() => {
      const surface = fitSurface({ x: 0, y: 0, width: el.clientWidth, height: el.clientHeight });
      setBox({ width: Math.floor(surface.width), height: Math.floor(surface.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const render = () => {
    const el = canvas.current;
    if (!el || box.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== Math.round(box.width * dpr)) {
      el.width = Math.round(box.width * dpr);
      el.height = Math.round(box.height * dpr);
    }
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const surface = { x: 0, y: 0, width: box.width, height: box.height };
    ctx.clearRect(0, 0, box.width, box.height);
    background(ctx, surface);
    const hidden = erasing.current;
    drawInk(ctx, hidden ? strokes.filter((_, i) => !hidden.has(i)) : strokes, surface);
    drawInk(ctx, pending, surface);
    if (drag.current) drawStroke(ctx, drag.current.stroke, surface, drag.current.points);
  };

  // Redraw whenever anything shown changes. Drags redraw themselves through requestAnimationFrame.
  useEffect(render);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const schedule = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      render();
      if (liveQueued.current && drag.current) {
        liveQueued.current = false;
        send({ type: 'live', key: surfaceKey, stroke: drag.current.stroke, points: drag.current.points });
      }
    });
  };

  const at = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height] as const;
  };

  const eraseAt = (x: number, y: number) => {
    const set = erasing.current!;
    strokes.forEach((stroke, i) => {
      if (!set.has(i) && hitsStroke(stroke, x, y, ERASER_REACH)) set.add(i);
    });
  };

  const commitText = () => {
    if (text?.value.trim() && settings.tool === 'text') {
      const stroke = makeStroke('text', settings.color, strokeWidth('text', settings.size), [text.x, text.y], text.value.trim());
      setPending((p) => [...p, stroke]);
      send({ type: 'add', key: surfaceKey, stroke });
    }
    setText(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button > 0) return;
    const [x, y] = at(event);
    if (settings.tool === 'text') {
      // Without this, the mouse-down that follows moves focus off the new text box and closes it.
      event.preventDefault();
      if (text) commitText();
      else setText({ x, y, value: '' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (settings.tool === 'eraser') {
      erasing.current = new Set();
      eraseAt(x, y);
      schedule();
      return;
    }
    const tool = settings.tool;
    drag.current = { points: [x, y], stroke: { t: tool, c: settings.color, w: strokeWidth(tool, settings.size), p: '' } };
    schedule();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (erasing.current) {
      const [x, y] = at(event);
      eraseAt(x, y);
      schedule();
      return;
    }
    const current = drag.current;
    if (!current) return;
    // Pens give many points per frame; take them all for a smooth line.
    const events = 'getCoalescedEvents' in event.nativeEvent ? event.nativeEvent.getCoalescedEvents() : [];
    for (const e of events.length ? events : [event]) {
      const [x, y] = at(e);
      if (SHAPE_TOOLS.includes(current.stroke.t)) current.points = [current.points[0]!, current.points[1]!, x, y];
      else current.points.push(x, y);
    }
    liveQueued.current = true;
    schedule();
  };

  const onPointerUp = () => {
    if (erasing.current) {
      const indices = [...erasing.current];
      erasing.current = null;
      if (indices.length) send({ type: 'erase', key: surfaceKey, indices });
      schedule();
      return;
    }
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const { t } = current.stroke;
    const [ax, ay, bx = ax, by = ay] = current.points as [number, number, number?, number?];
    const tiny = SHAPE_TOOLS.includes(t) && Math.hypot(bx - ax, (by - ay) * (9 / 16)) < 0.004;
    if (tiny) {
      send({ type: 'live-end' });
    } else {
      const stroke = makeStroke(t, current.stroke.c, current.stroke.w, current.points);
      setPending((p) => [...p, stroke]);
      send({ type: 'add', key: surfaceKey, stroke });
    }
    schedule();
  };

  const onTextKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') commitText();
    if (event.key === 'Escape') setText(null);
  };

  const cursor = disabled ? 'not-allowed' : settings.tool === 'text' ? 'text' : settings.tool === 'eraser' ? 'cell' : 'crosshair';

  return (
    <div ref={wrap} className="ink-wrap">
      <div className="ink-surface" style={{ width: box.width, height: box.height }}>
        <canvas
          ref={canvas}
          className="ink-canvas"
          style={{ width: box.width, height: box.height, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="ink-canvas"
          data-strokes={strokes.length}
          data-version={String(backgroundVersion ?? '')}
        />
        {text && (
          <input
            autoFocus
            className="ink-text"
            style={{
              left: text.x * box.width,
              top: text.y * box.height,
              color: settings.color,
              fontSize: (strokeWidth('text', settings.size) / 1000) * box.width,
            }}
            value={text.value}
            maxLength={200}
            placeholder="Type, then Enter"
            onChange={(e) => setText({ ...text, value: e.target.value })}
            onKeyDown={onTextKey}
            onBlur={commitText}
            data-testid="ink-text"
          />
        )}
      </div>
    </div>
  );
}
