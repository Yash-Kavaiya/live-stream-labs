import { z } from 'zod';

/**
 * Ink for the classroom whiteboard and for writing on slides.
 *
 * Every surface is 16:9. Points are stored as fractions of its width and height, quantised to
 * 12 bits and packed three bytes to a point as base64url, so a page of handwriting stays small
 * enough to travel in the scene (the scene rides in LiveKit room metadata, which is size-capped).
 */

export const INK_TOOLS = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text'] as const;
export type InkTool = (typeof INK_TOOLS)[number];

/** Tools drawn from two points: where the drag started and where it ended. */
export const SHAPE_TOOLS: readonly InkTool[] = ['line', 'arrow', 'rect', 'ellipse'];

export const inkStrokeSchema = z.object({
  t: z.enum(INK_TOOLS),
  /** Colour, #rrggbb. */
  c: z.string().regex(/^#[0-9a-f]{6}$/i),
  /** Line width, or text size, in thousandths of the surface width. */
  w: z.number().min(1).max(120),
  /** Packed points; see encodePoints. */
  p: z.string().max(12_000).regex(/^[A-Za-z0-9_-]*$/),
  /** The words of a text stroke. */
  s: z.string().max(200).optional(),
});
export type InkStroke = z.infer<typeof inkStrokeSchema>;

/** Most characters of ink one surface may carry in the scene. */
export const INK_BUDGET = 40_000;
export const MAX_INK_STROKES = 600;

/** The ink on the surface that is on screen: `board:<page>` or `slide:<index>`. */
export const inkLayerSchema = z.object({
  key: z.string().max(24),
  strokes: z.array(inkStrokeSchema).max(MAX_INK_STROKES),
});
export type InkLayer = z.infer<typeof inkLayerSchema>;

export const boardKey = (page: number) => `board:${page}`;
export const slideKey = (index: number) => `slide:${index}`;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((ch, i) => [ch, i]));
const MAX = 4095;

const quantise = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * MAX);

/** Packs [x0, y0, x1, y1, ...] (fractions 0..1) into a string, four characters a point. */
export function encodePoints(points: readonly number[]): string {
  let out = '';
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = quantise(points[i]!);
    const y = quantise(points[i + 1]!);
    out += ALPHABET[x >> 6]! + ALPHABET[x & 63]! + ALPHABET[y >> 6]! + ALPHABET[y & 63]!;
  }
  return out;
}

export function decodePoints(packed: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < packed.length; i += 4) {
    const d = (k: number) => LOOKUP.get(packed[i + k]!) ?? 0;
    out.push(((d(0) << 6) | d(1)) / MAX, ((d(2) << 6) | d(3)) / MAX);
  }
  return out;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Drops points that do not change the line's shape by more than `tolerance` (Ramer-Douglas-
 * Peucker), so a freehand stroke keeps its look in a fraction of the points.
 */
export function simplifyPoints(points: readonly number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i * 2]!, points[i * 2 + 1]!, points[first * 2]!, points[first * 2 + 1]!, points[last * 2]!, points[last * 2 + 1]!);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2]!, points[i * 2 + 1]!);
  return out;
}

/** Builds a stroke ready to store: freehand points simplified, then packed. */
export function makeStroke(tool: InkTool, color: string, width: number, points: readonly number[], text?: string): InkStroke {
  const kept = tool === 'pen' || tool === 'highlighter' ? simplifyPoints(points, 0.0012) : points.slice(0, 4);
  return { t: tool, c: color, w: width, p: encodePoints(kept), ...(text ? { s: text.slice(0, 200) } : {}) };
}

/** How much of the budget a set of strokes uses. */
export function inkSize(strokes: readonly InkStroke[]): number {
  return strokes.reduce((sum, s) => sum + s.p.length + (s.s?.length ?? 0) + 24, 0);
}

/** Whether one more stroke still fits in the scene. */
export function inkFits(strokes: readonly InkStroke[], next: InkStroke): boolean {
  return strokes.length < MAX_INK_STROKES && inkSize(strokes) + inkSize([next]) <= INK_BUDGET;
}

/**
 * True when (x, y) is within `radius` of what the stroke draws. Coordinates are fractions of the
 * surface; `aspect` is width over height, so distances are measured in the same units both ways.
 */
export function hitsStroke(stroke: InkStroke, x: number, y: number, radius: number, aspect = 16 / 9): boolean {
  const raw = decodePoints(stroke.p);
  if (raw.length < 2) return false;
  // Measure in a space where one unit is the surface width both ways.
  const pts = raw.map((v, i) => (i % 2 ? v / aspect : v));
  const px = x;
  const py = y / aspect;
  const reach = radius + stroke.w / 2000;

  if (stroke.t === 'text') {
    const size = stroke.w / 1000;
    const width = (stroke.s?.length ?? 1) * size * 0.55;
    return px >= pts[0]! - reach && px <= pts[0]! + width + reach && py >= pts[1]! - reach && py <= pts[1]! + size * 1.3 + reach;
  }
  if (pts.length === 2) return Math.hypot(px - pts[0]!, py - pts[1]!) <= reach;

  if (stroke.t === 'rect' || stroke.t === 'ellipse') {
    const [ax, ay, bx, by] = pts as [number, number, number, number];
    if (stroke.t === 'rect') {
      const corners = [ax, ay, bx, ay, bx, by, ax, by, ax, ay];
      for (let i = 0; i + 3 < corners.length; i += 2) {
        if (distanceToSegment(px, py, corners[i]!, corners[i + 1]!, corners[i + 2]!, corners[i + 3]!) <= reach) return true;
      }
      return false;
    }
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const rx = Math.max(Math.abs(bx - ax) / 2, 1e-6);
    const ry = Math.max(Math.abs(by - ay) / 2, 1e-6);
    const along = Math.hypot((px - cx) / rx, (py - cy) / ry);
    return Math.abs(along - 1) * Math.min(rx, ry) <= reach;
  }

  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (distanceToSegment(px, py, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!) <= reach) return true;
  }
  return false;
}
