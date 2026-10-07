import { MOMENT_HEADLINES, type Celebration, type CricketMoment } from '@studio/shared';
import { CELEBRATION_MS, drawConfetti, drawEmoji, rand } from './celebration';
import { FONT, fillRound, label, readableOn, type Painter } from './painter';

const MOMENT_MS = CELEBRATION_MS.moment;

/** The slab colour of each moment. A custom banner takes the brand colour instead. */
const MOMENT_COLORS: Record<Exclude<CricketMoment, 'custom'>, string> = {
  four: '#1a73e8',
  six: '#f9ab00',
  wicket: '#d93025',
  fifty: '#0d9488',
  hundred: '#7c3aed',
  freehit: '#ff6d01',
};

const SKIN = '#f2c09a';
const INK = '#1f2937';
const GOLD = '#fdd663';
const WOOD = '#e8c48a';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Ctx = CanvasRenderingContext2D;

// ---------- Cartoon parts ----------
// These draw in "figure units": the caller scales the canvas so a standing figure is about 38 tall,
// with its feet at y = 18 and the middle of its chest at the origin.

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function limb(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** A four-pointed sparkle. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string, turn = 0): void {
  if (r <= 0) return;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = turn + (i * Math.PI) / 4;
    const d = i % 2 === 0 ? r : r * 0.32;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A spiky "pow" shape for an impact. */
function burst(ctx: Ctx, x: number, y: number, r: number, color: string, points = 10): void {
  if (r <= 0) return;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points;
    const d = i % 2 === 0 ? r : r * 0.55;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function ball(ctx: Ctx, x: number, y: number, r: number, spin: number): void {
  disc(ctx, x, y, r, '#c62828');
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.28, r * 0.94, 0, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  disc(ctx, -r * 0.42, -r * 0.42, r * 0.2, 'rgb(255 255 255 / 0.5)');
  ctx.restore();
}

/** A bat held at (x, y), its blade pointing away from the hand at `angle` (0 is straight up). */
function bat(ctx: Ctx, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  fillRound(ctx, -0.7, -5, 1.4, 6.5, 0.6, '#374151');
  fillRound(ctx, -2, -17, 4, 12.5, [1.2, 1.2, 1.8, 1.8], WOOD);
  fillRound(ctx, -2, -11.5, 4, 1.2, 0, '#d93025');
  ctx.restore();
}

function helmet(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.14, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(0 0 0 / 0.35)';
  ctx.fill();
}

interface Figure {
  shirt: string;
  legs: string;
  head: 'hat' | 'helmet' | 'bare';
  /** Arm angles: 0 hangs down, half a turn points straight up. */
  armL: number;
  armR: number;
  cheering?: boolean;
  helmetColor?: string;
}

/** Draws a person facing the camera and returns where their hands ended up. */
function figure(ctx: Ctx, f: Figure): { left: [number, number]; right: [number, number] } {
  const reach = 10.5;
  const left: [number, number] = [-5 - Math.sin(f.armL) * reach, -5 + Math.cos(f.armL) * reach];
  const right: [number, number] = [5 + Math.sin(f.armR) * reach, -5 + Math.cos(f.armR) * reach];

  ctx.beginPath();
  ctx.ellipse(0, 18.4, 8.5, 1.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(0 0 0 / 0.25)';
  ctx.fill();

  for (const side of [-1, 1]) {
    limb(ctx, side * 2.6, 6, side * 3.4, 15.6, 3.8, f.legs);
    ctx.beginPath();
    ctx.ellipse(side * 4, 17, 2.7, 1.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  fillRound(ctx, -5.6, -7.6, 11.2, 14.8, 4, f.shirt);
  limb(ctx, -5, -5, left[0], left[1], 3.3, f.shirt);
  limb(ctx, 5, -5, right[0], right[1], 3.3, f.shirt);
  disc(ctx, left[0], left[1], 1.95, SKIN);
  disc(ctx, right[0], right[1], 1.95, SKIN);

  disc(ctx, 0, -12.6, 5.3, SKIN);
  disc(ctx, -3.3, -11.4, 1.1, 'rgb(234 67 53 / 0.3)');
  disc(ctx, 3.3, -11.4, 1.1, 'rgb(234 67 53 / 0.3)');
  disc(ctx, -1.9, -13.1, 0.7, INK);
  disc(ctx, 1.9, -13.1, 0.7, INK);
  if (f.cheering) {
    ctx.beginPath();
    ctx.ellipse(0, -10.5, 1.7, 1.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1f';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, -11.9, 2, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineWidth = 0.6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5b2c0f';
    ctx.stroke();
  }

  if (f.head === 'hat') {
    fillRound(ctx, -4.7, -21, 9.4, 5.2, [3.2, 3.2, 0, 0], '#ffffff');
    fillRound(ctx, -4.7, -17.6, 9.4, 1.1, 0, INK);
    ctx.beginPath();
    ctx.ellipse(0, -16.3, 7.8, 1.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else if (f.head === 'helmet') {
    helmet(ctx, 0, -13.9, 5.9, f.helmetColor ?? '#0b3d91');
  } else {
    ctx.beginPath();
    ctx.arc(0, -13.4, 5.5, Math.PI * 1.04, Math.PI * 1.96);
    ctx.fillStyle = '#2b1a12';
    ctx.fill();
  }
  return { left, right };
}

/** A gold coin with a number on it, flipping into place. */
function coin(ctx: Ctx, x: number, y: number, r: number, text: string, t: number): void {
  const land = clamp01((t - 500) / 600);
  if (land <= 0) return;
  const flip = Math.cos((1 - easeOut(land)) * Math.PI * 3);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(easeOutBack(land) * (Math.abs(flip) * 0.92 + 0.08), easeOutBack(land));
  disc(ctx, 0, 0, r, '#b06000');
  disc(ctx, 0, 0, r * 0.92, GOLD);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = '#b06000';
  ctx.stroke();
  if (flip > 0) label(ctx, text, 0, r * 0.06, { size: r * (text.length > 2 ? 0.72 : 0.92), weight: 700, color: '#5a3200', align: 'center' });
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    const twinkle = Math.max(0, Math.sin(t / 170 + i * 2.1)) * land;
    sparkle(ctx, x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.3, r * 0.34 * twinkle, '#ffffff', t / 900);
  }
}

// ---------- The seven cartoons ----------
// Each draws in figure units around the origin, `t` milliseconds into the moment. `reach` is how far
// the frame extends to the right of the cartoon, for things that travel across the banner.

function drawFour(ctx: Ctx, t: number, reach: number): void {
  figure(ctx, { shirt: '#f8fafc', legs: INK, head: 'hat', armL: 0.3, armR: Math.PI / 2 + Math.sin(t / 130) * 0.38 });

  // The ball skids along the grass to the boundary cushion and bobbles off it.
  const rope = reach - 14;
  const run = clamp01((t - 300) / 1300);
  const x = lerp(16, rope - 4.6, easeOut(run));
  const after = Math.max(0, t - 1600) / 1000;
  const hop = run < 1 ? Math.abs(Math.sin(run * Math.PI * 4)) * (1 - run) * 3 : Math.abs(Math.sin(after * 9)) * 4 * Math.exp(-after * 3);
  ctx.beginPath();
  ctx.moveTo(rope, 18.6);
  ctx.lineTo(rope + 4, 11);
  ctx.lineTo(rope + 8, 18.6);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  fillRound(ctx, rope + 1.6, 14.6, 4.8, 1.6, 0.4, '#1a73e8');
  if (run < 1) for (let i = 1; i <= 3; i++) disc(ctx, x - i * 3.4, 17.2, 1.5 - i * 0.3, `rgb(255 255 255 / ${0.4 - i * 0.1})`);
  ball(ctx, x - after * 5 * Math.exp(-after * 2), 16 - hop, 2.4, x * 0.4);
  if (run >= 1 && after < 0.45) burst(ctx, rope + 0.5, 13, 5.5 * easeOut(after / 0.45), `rgb(255 255 255 / ${1 - after / 0.45})`);
}

function drawSix(ctx: Ctx, t: number, reach: number): void {
  ctx.save();
  ctx.translate(0, -Math.abs(Math.sin(t / 210)) * 1.6);
  const wave = Math.PI - 0.14 + Math.sin(t / 150) * 0.1;
  figure(ctx, { shirt: '#f8fafc', legs: INK, head: 'hat', armL: wave, armR: wave, cheering: true });
  ctx.restore();

  // The ball climbs out of the ground over the banner, leaving a dotted trail.
  const at = (q: number): [number, number] => [lerp(14, reach + 6, q), 10 - 60 * Math.sin((q * Math.PI) / 2)];
  const flight = clamp01((t - 350) / 1250);
  if (flight > 0 && flight < 1) {
    for (let i = 1; i <= 9; i++) {
      const q = flight - i * 0.035;
      if (q > 0) disc(ctx, ...at(q), 1.2 - i * 0.1, `rgb(255 255 255 / ${0.75 - i * 0.075})`);
    }
    ball(ctx, ...at(flight), 2.6, t / 60);
  }
  // Fireworks where it landed in the crowd.
  [1500, 1850, 2250].forEach((start, n) => {
    const age = (t - start) / 800;
    if (age <= 0 || age >= 1) return;
    const cx = reach * (0.5 + n * 0.19);
    const cy = -36 + (n % 2) * 6;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 + n;
      const d = easeOut(age) * 11;
      limb(ctx, cx + Math.cos(a) * d * 0.55, cy + Math.sin(a) * d * 0.55, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.9 * (1 - age), i % 2 ? GOLD : '#ffffff');
    }
  });
}

function drawWicket(ctx: Ctx, t: number): void {
  const HIT = 520;
  const age = Math.max(0, t - HIT) / 1000;
  const hit = t >= HIT;
  // Whatever is knocked loose hangs in the air a while, then fades before it can fall out of the banner.
  const loose = clamp01(1.7 - age);

  // The umpire's finger goes up as the stumps go down.
  ctx.save();
  ctx.translate(-9, 0);
  const finger = lerp(0.3, Math.PI - 0.2, easeOutBack(clamp01(age * 2.4)));
  const hands = figure(ctx, { shirt: '#f8fafc', legs: INK, head: 'hat', armL: 0.3, armR: finger });
  if (hit) limb(ctx, hands.right[0], hands.right[1], hands.right[0] + 0.6, hands.right[1] - 3.4, 1.3, SKIN);
  ctx.restore();

  ctx.save();
  ctx.translate(17, 3);
  ctx.scale(0.82, 0.82);
  limb(ctx, -13, 18.6, 13, 18.6, 0.9, '#ffffff');
  ctx.beginPath();
  ctx.ellipse(0, 19.2, 12, 1.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(0 0 0 / 0.22)';
  ctx.fill();

  // Off and leg stumps stay in the ground and lean; the middle one is knocked clean out.
  const stump = (x: number, lean: number, fly: boolean) => {
    ctx.save();
    if (fly) {
      ctx.globalAlpha *= loose;
      ctx.translate(x + age * 7, 18 - age * 30 + 20 * age * age);
      ctx.rotate(age * 5);
      fillRound(ctx, -1.1, -22, 2.2, 22, 0.8, WOOD);
    } else {
      ctx.translate(x, 18);
      ctx.rotate(lean * easeOut(clamp01(age * 4)));
      fillRound(ctx, -1.1, -22, 2.2, 22, 0.8, WOOD);
      fillRound(ctx, -1.1, -15, 2.2, 1.4, 0, '#d93025');
    }
    ctx.restore();
  };
  stump(-5.5, -0.16, false);
  stump(5.5, 0.34, false);
  stump(0, 0, hit);

  // The bails sit in the grooves until the ball arrives, then spin away.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.globalAlpha *= loose;
    ctx.translate(side * 2.75 + side * age * 8, -4.6 - age * 24 + 16 * age * age);
    ctx.rotate(side * age * 9);
    fillRound(ctx, -2.5, -0.6, 5, 1.2, 0.6, '#f5d9a0');
    ctx.restore();
  }

  const approach = clamp01((t - 150) / (HIT - 150));
  if (approach > 0 && !hit) {
    for (let i = 1; i <= 4; i++) disc(ctx, lerp(64, 2, approach) + i * 4, lerp(-10, 6, approach) - i, 1.4 - i * 0.25, `rgb(255 255 255 / ${0.5 - i * 0.1})`);
    ball(ctx, lerp(64, 2, approach), lerp(-10, 6, approach), 2.5, t / 40);
  } else if (hit) {
    ctx.save();
    ctx.globalAlpha *= clamp01(1 - age * 1.6);
    ball(ctx, 2 + age * 14, 6 - age * 26 + 30 * age * age, 2.5, t / 60);
    ctx.restore();
    if (age < 0.4) {
      burst(ctx, 0, 4, 13 * easeOut(age / 0.4), `rgb(253 214 99 / ${1 - age / 0.4})`, 12);
      burst(ctx, 0, 4, 7 * easeOut(age / 0.4), `rgb(255 255 255 / ${1 - age / 0.4})`, 8);
    }
  }
  ctx.restore();
}

function drawFifty(ctx: Ctx, t: number): void {
  const raise = Math.PI - 0.42 + Math.sin(t / 240) * 0.1;
  const hands = figure(ctx, { shirt: '#1a73e8', legs: '#f8fafc', head: 'helmet', armL: 0.32, armR: raise });
  bat(ctx, hands.right[0], hands.right[1], 0.28 + Math.sin(t / 240) * 0.1);
  coin(ctx, 23, -17, 8.5, '50', t);
}

function drawHundred(ctx: Ctx, t: number): void {
  ctx.save();
  ctx.translate(0, -Math.abs(Math.sin(t / 250)) * 2.6);
  const sway = Math.sin(t / 250) * 0.08;
  const hands = figure(ctx, { shirt: '#1a73e8', legs: '#f8fafc', head: 'bare', armL: Math.PI - 0.5 - sway, armR: Math.PI - 0.4 + sway, cheering: true });
  bat(ctx, hands.right[0], hands.right[1], 0.3 + sway);
  // The helmet comes off for a hundred.
  helmet(ctx, hands.left[0], hands.left[1] - 0.6, 4.6, '#0b3d91');
  ctx.restore();
  coin(ctx, 25, -17, 10, '100', t);
}

function drawFreeHit(ctx: Ctx, t: number): void {
  const hands = figure(ctx, { shirt: '#f8fafc', legs: INK, head: 'hat', armL: 0.3, armR: Math.PI - 0.3 + Math.sin(t / 150) * 0.22 });
  // The signal: one arm circling above the head.
  const turn = t / 190;
  const [hx, hy] = hands.right;
  ctx.beginPath();
  ctx.arc(hx, hy - 4.5, 4.4, turn, turn + Math.PI * 1.45);
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  const tip = turn + Math.PI * 1.45;
  sparkle(ctx, hx + Math.cos(tip) * 4.4, hy - 4.5 + Math.sin(tip) * 4.4, 1.9, '#ffffff', tip);

  // A beacon with two beams sweeping round.
  const bx = 24;
  const by = -15;
  ctx.save();
  ctx.translate(bx, by - 3);
  ctx.rotate(t / 260);
  for (const side of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 15, side - 0.3, side + 0.3);
    ctx.closePath();
    ctx.fillStyle = 'rgb(255 255 255 / 0.28)';
    ctx.fill();
  }
  ctx.restore();
  fillRound(ctx, bx - 5.5, by + 1.5, 11, 3, 1, INK);
  fillRound(ctx, bx - 4, by - 8, 8, 9.5, [4, 4, 0, 0], '#d93025');
  disc(ctx, bx, by - 3, 2 + Math.abs(Math.sin(t / 130)) * 1.2, `rgb(255 255 255 / ${0.55 + Math.abs(Math.sin(t / 130)) * 0.45})`);
}

function drawCustom(ctx: Ctx, t: number, emoji: string): void {
  const pop = easeOutBack(clamp01((t - 150) / 500));
  drawEmoji(ctx, emoji || '📣', 4, 0, 30 * pop, Math.sin(t / 300) * 0.12);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    const twinkle = Math.max(0, Math.sin(t / 190 + i * 1.9));
    sparkle(ctx, 4 + Math.cos(a) * 22, Math.sin(a) * 19, 3.2 * twinkle * pop, i % 2 ? GOLD : '#ffffff', t / 700);
  }
}

// ---------- The banner ----------

/** Text leaning forward with a hard shadow, shrunk to fit `maxWidth`. */
function headline(ctx: Ctx, text: string, x: number, y: number, size: number, maxWidth: number, color: string): void {
  ctx.font = `700 ${size}px ${FONT}`;
  const fit = Math.min(1, maxWidth / ctx.measureText(text).width);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.16, 1, 0, 0);
  const shadow = color === '#ffffff' ? 'rgb(0 0 0 / 0.4)' : 'rgb(255 255 255 / 0.45)';
  label(ctx, text, size * fit * 0.045, size * fit * 0.05, { size: size * fit, weight: 700, color: shadow });
  label(ctx, text, 0, 0, { size: size * fit, weight: 700, color });
  ctx.restore();
}

/**
 * Draws one frame of a cricket moment: a slab of colour that sweeps across the middle of the
 * frame carrying the headline, with the cartoon standing out of its left end.
 */
export function drawMoment(p: Painter, celebration: Celebration, t: number, accent: string): void {
  const { ctx, size, unit } = p;
  const moment = celebration.moment ?? 'custom';
  const color = moment === 'custom' ? accent : MOMENT_COLORS[moment];
  const ink = readableOn(color);
  const cy = size.height * 0.5;
  const slabH = unit * 34;
  const skew = unit * 7;

  const enter = easeOut(clamp01(t / 380));
  const leave = easeIn(clamp01((t - (MOMENT_MS - 450)) / 450));
  const shown = clamp01((MOMENT_MS - t) / 250);
  const span = size.width + skew * 2 + unit * 20;

  ctx.save();
  ctx.globalAlpha *= enter * shown * 0.3;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.restore();

  if (moment === 'wicket' && t < 260) {
    ctx.save();
    ctx.globalAlpha *= (1 - t / 260) * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.restore();
  }

  const slab = (grow: number, progress: number) => {
    const left = -skew - unit * 10 + leave * span;
    const right = -skew - unit * 10 + progress * span;
    ctx.beginPath();
    ctx.moveTo(left + skew, cy - slabH / 2 - grow);
    ctx.lineTo(right + skew, cy - slabH / 2 - grow);
    ctx.lineTo(right, cy + slabH / 2 + grow);
    ctx.lineTo(left, cy + slabH / 2 + grow);
    ctx.closePath();
  };

  ctx.save();
  ctx.globalAlpha *= shown;
  slab(unit * 1.1, easeOut(clamp01((t - 60) / 380)));
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  slab(0, enter);
  ctx.fillStyle = color;
  ctx.fill();
  const shade = ctx.createLinearGradient(0, cy - slabH / 2, 0, cy + slabH / 2);
  shade.addColorStop(0, 'rgb(0 0 0 / 0)');
  shade.addColorStop(1, 'rgb(0 0 0 / 0.32)');
  ctx.fillStyle = shade;
  ctx.fill();

  // Streaks rushing along the slab.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = ink === '#ffffff' ? 'rgb(255 255 255 / 0.16)' : 'rgb(255 255 255 / 0.4)';
  for (let i = 0; i < 9; i++) {
    const length = unit * (14 + rand(i, 1) * 26);
    const x = ((t * size.width * (0.5 + rand(i, 2) * 0.7)) / 1000 + rand(i, 3) * size.width * 1.4) % (size.width * 1.4) - length;
    ctx.fillRect(x, cy - slabH / 2 + rand(i, 4) * slabH, length, unit * (0.25 + rand(i, 5) * 0.4));
  }
  ctx.restore();

  // The cartoon and the words ride on the slab: they arrive just after it and leave with it.
  ctx.translate(leave * span, 0);
  ctx.globalAlpha *= clamp01((t - 120) / 220);

  if (moment === 'hundred') drawConfetti(p, Math.max(0, t - 300), 1);

  const figureUnit = unit * 1.12;
  const artX = size.width * 0.17;
  ctx.save();
  ctx.translate(artX, cy + unit * 1.5);
  const pop = easeOutBack(clamp01((t - 140) / 460));
  ctx.scale(figureUnit * pop, figureUnit * pop);
  const reach = (size.width - artX) / figureUnit;
  if (moment === 'four') drawFour(ctx, t, reach);
  else if (moment === 'six') drawSix(ctx, t, reach);
  else if (moment === 'wicket') drawWicket(ctx, t);
  else if (moment === 'fifty') drawFifty(ctx, t);
  else if (moment === 'hundred') drawHundred(ctx, t);
  else if (moment === 'freehit') drawFreeHit(ctx, t);
  else drawCustom(ctx, t, celebration.emoji);
  ctx.restore();

  const textX = size.width * 0.37;
  const room = size.width * 0.58;
  const detail = celebration.detail;
  const words = (celebration.text || MOMENT_HEADLINES[moment] || 'HOWZAT!').toUpperCase();
  const punch = easeOutBack(clamp01((t - 220) / 420)) * (1 + Math.sin(t / 170) * 0.012);
  if (punch > 0) {
    ctx.save();
    ctx.translate(textX, cy);
    ctx.scale(punch, punch);
    headline(ctx, words, 0, detail ? -unit * 3.4 : unit * 0.6, unit * 19, room, ink);
    if (detail) {
      ctx.font = `700 ${unit * 4}px ${FONT}`;
      const width = Math.min(room, ctx.measureText(detail).width + unit * 5);
      fillRound(ctx, 0, unit * 7.6, width, unit * 7, unit * 3.5, 'rgb(0 0 0 / 0.42)');
      label(ctx, detail, unit * 2.5, unit * 11.2, { size: unit * 4, weight: 700, color: '#ffffff', maxWidth: width - unit * 5 });
    }
    ctx.restore();
  }
  ctx.restore();
}
