import { decodePoints, type InkStroke } from '@studio/shared';
import { FONT } from './painter';

export interface Surface {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The largest 16:9 surface that fits in `rect`, centred. */
export function fitSurface(rect: Surface): Surface {
  const width = Math.min(rect.width, (rect.height * 16) / 9);
  const height = (width * 9) / 16;
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}

/** A smooth path through freehand points: quadratic curves between the midpoints. */
function freehand(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  if (pts.length === 2) {
    ctx.lineTo(pts[0]! + 0.01, pts[1]!);
    return;
  }
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i]! + pts[i + 2]!) / 2;
    const my = (pts[i + 1]! + pts[i + 3]!) / 2;
    ctx.quadraticCurveTo(pts[i]!, pts[i + 1]!, mx, my);
  }
  ctx.lineTo(pts.at(-2)!, pts.at(-1)!);
}

/** Draws one stroke. `points` overrides the stored ones (for a stroke still being drawn). */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, surface: Surface, points?: number[]): void {
  const raw = points ?? decodePoints(stroke.p);
  if (raw.length < 2) return;
  const pts = raw.map((v, i) => (i % 2 ? surface.y + v * surface.height : surface.x + v * surface.width));
  const width = Math.max(1, (stroke.w / 1000) * surface.width);

  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = stroke.c;
  ctx.lineWidth = width;
  ctx.lineCap = ctx.lineJoin = 'round';

  switch (stroke.t) {
    case 'pen':
      freehand(ctx, pts);
      ctx.stroke();
      break;
    case 'highlighter':
      ctx.globalAlpha *= 0.35;
      ctx.lineCap = 'square';
      freehand(ctx, pts);
      ctx.stroke();
      break;
    case 'text': {
      ctx.font = `600 ${width}px ${FONT}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(stroke.s ?? '', pts[0]!, pts[1]!);
      break;
    }
    default: {
      if (pts.length < 4) break;
      const [ax, ay, bx, by] = pts as [number, number, number, number];
      ctx.beginPath();
      if (stroke.t === 'rect') {
        ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      } else if (stroke.t === 'ellipse') {
        ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (stroke.t === 'arrow') {
          const angle = Math.atan2(by - ay, bx - ax);
          const head = Math.max(width * 4, surface.width * 0.012);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - head * Math.cos(angle - 0.45), by - head * Math.sin(angle - 0.45));
          ctx.lineTo(bx - head * Math.cos(angle + 0.45), by - head * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

export function drawInk(ctx: CanvasRenderingContext2D, strokes: readonly InkStroke[], surface: Surface): void {
  for (const stroke of strokes) drawStroke(ctx, stroke, surface);
}

/** The whiteboard itself: a white surface with a faint dot grid. */
export function drawBoardSurface(ctx: CanvasRenderingContext2D, surface: Surface, radius: number): void {
  ctx.save();
  ctx.fillStyle = '#fdfdfb';
  ctx.beginPath();
  ctx.roundRect(surface.x, surface.y, surface.width, surface.height, radius);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = 'rgb(26 61 124 / 0.12)';
  const step = surface.width / 40;
  const dot = Math.max(1, surface.width / 900);
  for (let x = surface.x + step; x < surface.x + surface.width; x += step) {
    for (let y = surface.y + step; y < surface.y + surface.height; y += step) {
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
  }
  ctx.restore();
}
