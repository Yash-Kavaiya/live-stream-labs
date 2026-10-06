import type { Size } from '@studio/shared';

export const FONT = "'Google Sans Flex', 'Google Sans', 'Roboto Flex', Roboto, system-ui, sans-serif";

/** What a graphics module needs to draw on the program canvas. */
export interface Painter {
  ctx: CanvasRenderingContext2D;
  size: Size;
  /** One hundredth of the frame height: graphics are sized in these so they scale with the canvas. */
  unit: number;
}

export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? '#1f1f1f' : '#ffffff';
}

export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut--;
  return `${text.slice(0, cut).trimEnd()}…`;
}

/** Greedy word wrap; whatever does not fit in `maxLines` is ellipsized on the last line. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const [i, word] of words.entries()) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      line = `${line} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(line);
    line = word;
  }
  lines.push(ellipsize(ctx, line, maxWidth));
  return lines;
}

export function fillRound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | number[],
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

export interface TextStyle {
  size: number;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Ellipsize to this width. */
  maxWidth?: number;
}

/** Draws one line of text and returns its width. */
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle): number {
  ctx.font = `${style.weight ?? 500} ${style.size}px ${FONT}`;
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'middle';
  ctx.fillStyle = style.color;
  const shown = style.maxWidth === undefined ? text : ellipsize(ctx, text, style.maxWidth);
  ctx.fillText(shown, x, y);
  return ctx.measureText(shown).width;
}

/** A small rounded label; with `pulseAt` it gets a blinking "on air" dot. Returns its right edge. */
export function drawPill(
  { ctx, unit }: Painter,
  x: number,
  y: number,
  text: string,
  fill: string,
  color: string,
  pulseAt?: number,
): number {
  const fontSize = unit * 2.6;
  const height = fontSize * 1.9;
  const padX = fontSize * 0.8;
  const dot = pulseAt === undefined ? 0 : fontSize * 1.1;
  ctx.font = `700 ${fontSize}px ${FONT}`;
  const width = ctx.measureText(text).width + padX * 2 + dot;

  fillRound(ctx, x, y, width, height, unit, fill);
  ctx.fillStyle = color;
  if (pulseAt !== undefined) {
    ctx.save();
    ctx.globalAlpha *= 0.45 + 0.55 * Math.abs(Math.sin(pulseAt / 500));
    ctx.beginPath();
    ctx.arc(x + padX + fontSize * 0.25, y + height / 2, fontSize * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  label(ctx, text, x + padX + dot, y + height / 2 + fontSize * 0.05, { size: fontSize, weight: 700, color });
  return x + width;
}
