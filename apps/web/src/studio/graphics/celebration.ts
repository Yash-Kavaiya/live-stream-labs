import type { Celebration } from '@studio/shared';
import { FONT, label, type Painter } from './painter';

export const CELEBRATION_MS: Record<Celebration['kind'], number> = { winner: 6500, reaction: 3800, moment: 3600 };

const CONFETTI_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#A142F4', '#FFFFFF'];
const EMOJI_FONT = `'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', ${FONT}`;

/** A repeatable pseudo-random number for particle `i`: the same on every client and every frame. */
export function rand(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Overshoots a little, then settles: the "pop" of something landing. */
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

const SPRITE_PX = 160;
const sprites = new Map<string, HTMLCanvasElement>();

/**
 * Colour emoji are slow to rasterise, and a celebration draws dozens per frame at changing sizes
 * and angles. Each glyph is rendered once to a small canvas and then stamped with drawImage.
 */
function sprite(glyph: string): HTMLCanvasElement {
  let canvas = sprites.get(glyph);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = SPRITE_PX;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${SPRITE_PX * 0.78}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, SPRITE_PX / 2, SPRITE_PX * 0.54);
    sprites.set(glyph, canvas);
  }
  return canvas;
}

/** Stamps one emoji centred on a point. */
export function drawEmoji(ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, size: number, rotation = 0): void {
  if (size <= 0) return;
  const box = size * 1.28;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(sprite(glyph), -box / 2, -box / 2, box, box);
  ctx.restore();
}

/** Two cannons in the bottom corners fire paper that arcs up, tumbles and falls. */
export function drawConfetti({ ctx, size, unit }: Painter, t: number, fade: number): void {
  const seconds = t / 1000;
  const gravity = size.height * 0.9;
  ctx.save();
  ctx.globalAlpha *= fade;
  for (let i = 0; i < 120; i++) {
    const fromLeft = i % 2 === 0;
    // A second, smaller volley follows the first.
    const delay = i % 5 === 0 ? 0.9 : rand(i, 1) * 0.25;
    const age = seconds - delay;
    if (age <= 0) continue;

    const speed = size.height * (0.95 + rand(i, 2) * 0.75);
    const angle = (fromLeft ? 1 : -1) * (0.25 + rand(i, 3) * 0.6);
    const x = (fromLeft ? 0 : size.width) + Math.sin(angle) * speed * age + Math.sin(age * 3 + i) * unit * 1.5;
    const y = size.height - Math.cos(angle) * speed * age + 0.5 * gravity * age * age;
    if (y > size.height + unit * 4 || y < -unit * 4) continue;

    const w = unit * (1 + rand(i, 4) * 1.4);
    const spin = age * (3 + rand(i, 5) * 6) * (fromLeft ? 1 : -1);
    // Squashing the height fakes the paper turning edge-on as it tumbles.
    const flip = Math.cos(age * (5 + rand(i, 6) * 5));
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    ctx.setTransform(cos, sin, -sin * flip, cos * flip, x, y);
    ctx.fillStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    ctx.fillRect(-w / 2, -w * 0.3, w, w * 0.6);
  }
  ctx.restore();
}

function drawWinner(p: Painter, celebration: Celebration, t: number): void {
  const { ctx, size, unit } = p;
  const total = CELEBRATION_MS.winner;
  const fade = clamp01(t / 350) * clamp01((total - t) / 900);
  const cx = size.width / 2;
  const cy = size.height * 0.42;

  // Dim the video and put a slow sunburst behind the trophy.
  ctx.save();
  ctx.globalAlpha *= fade * 0.55;
  ctx.fillStyle = '#0b0218';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= fade * 0.16;
  ctx.translate(cx, cy);
  ctx.rotate(t / 4000);
  ctx.fillStyle = '#FBBC04';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-unit * 5, -size.width * 0.6);
    ctx.lineTo(unit * 5, -size.width * 0.6);
    ctx.fill();
  }
  ctx.restore();

  drawConfetti(p, t, fade);

  ctx.save();
  ctx.globalAlpha *= fade;
  const pop = easeOutBack(clamp01(t / 650));
  const bob = Math.sin(t / 280) * unit * 0.8;
  drawEmoji(ctx, celebration.emoji || '🏆', cx, cy - unit * 6 + bob, unit * 26 * pop, Math.sin(t / 420) * 0.08);

  const textPop = easeOutBack(clamp01((t - 350) / 550));
  if (textPop > 0) {
    ctx.translate(cx, cy + unit * 17);
    ctx.scale(textPop, textPop);
    label(ctx, 'W I N N E R', 0, 0, { size: unit * 4, weight: 700, color: '#FBBC04', align: 'center' });
    if (celebration.text) {
      // A hard offset copy stands in for a drop shadow: readable on any video, and nearly free.
      label(ctx, celebration.text, unit * 0.4, unit * 9.4, { size: unit * 9, weight: 700, color: 'rgb(0 0 0 / 0.55)', align: 'center', maxWidth: size.width * 0.8 });
      label(ctx, celebration.text, 0, unit * 9, { size: unit * 9, weight: 700, color: '#ffffff', align: 'center', maxWidth: size.width * 0.8 });
    }
  }
  ctx.restore();

  // Sparkle emoji drifting up the sides.
  const extras = ['🎉', '✨', '🎊', '⭐', '🥳'];
  for (let i = 0; i < 14; i++) {
    const age = clamp01((t - rand(i, 7) * 1800) / 3400);
    if (age <= 0 || age >= 1) continue;
    const side = i % 2 === 0 ? 0.04 + rand(i, 8) * 0.22 : 0.74 + rand(i, 8) * 0.22;
    ctx.save();
    ctx.globalAlpha *= fade * Math.sin(age * Math.PI);
    drawEmoji(ctx, extras[i % extras.length]!, size.width * side + Math.sin(age * 6 + i) * unit * 2, size.height * (1 - age * 0.9), unit * (5 + rand(i, 9) * 4), Math.sin(age * 5 + i) * 0.4);
    ctx.restore();
  }
}

/** A shower of one emoji rising from the bottom edge. */
function drawReaction({ ctx, size, unit }: Painter, celebration: Celebration, t: number): void {
  const total = CELEBRATION_MS.reaction;
  for (let i = 0; i < 28; i++) {
    const start = rand(i, 1) * total * 0.45;
    const life = total * 0.55;
    const age = clamp01((t - start) / life);
    if (age <= 0 || age >= 1) continue;
    const scale = easeOutBack(clamp01(age * 5));
    const x = size.width * (0.04 + rand(i, 2) * 0.92) + Math.sin(age * 7 + i) * unit * 3;
    const y = size.height * (1.05 - age * (0.55 + rand(i, 3) * 0.5));
    ctx.save();
    ctx.globalAlpha *= clamp01((1 - age) * 2.2);
    drawEmoji(ctx, celebration.emoji, x, y, unit * (6 + rand(i, 4) * 7) * scale, Math.sin(age * 4 + i) * 0.3);
    ctx.restore();
  }
}

/** Draws one frame of a celebration, `elapsedMs` after it began. */
export function drawCelebration(p: Painter, celebration: Celebration, elapsedMs: number): void {
  if (celebration.kind === 'winner') drawWinner(p, celebration, elapsedMs);
  else drawReaction(p, celebration, elapsedMs);
}
