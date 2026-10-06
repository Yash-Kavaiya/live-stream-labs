import { CRICKET_STRIP, cricketDashboardArea, cricketStats, type Cricket, type Scene } from '@studio/shared';
import { fillRound, label, readableOn, type Painter } from './painter';

const GOLD = '#fdd663';
const DIM = 'rgb(255 255 255 / 0.62)';
const PANEL = 'rgb(255 255 255 / 0.07)';

/** Colour of a ball in the over tracker: boundaries, wickets and extras stand out. */
function ballColor(ball: string, accent: string): { fill: string; text: string } {
  if (ball === 'W') return { fill: '#d93025', text: '#ffffff' };
  if (ball === '4' || ball === '6') return { fill: GOLD, text: '#1f1f1f' };
  if (ball === 'wd' || ball === 'nb') return { fill: 'rgb(255 255 255 / 0.22)', text: '#ffffff' };
  return { fill: accent, text: readableOn(accent) };
}

/** The balls of the current over as a row of discs. Returns the right edge. */
function drawOver(p: Painter, c: Cricket, x: number, cy: number, radius: number, accent: string): number {
  const { ctx } = p;
  const slots = Math.max(6, c.thisOver.length);
  for (let i = 0; i < slots; i++) {
    const ball = c.thisOver[i];
    const cx = x + radius + i * radius * 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    if (ball === undefined) {
      ctx.strokeStyle = 'rgb(255 255 255 / 0.28)';
      ctx.lineWidth = radius * 0.14;
      ctx.stroke();
      continue;
    }
    const color = ballColor(ball, accent);
    ctx.fillStyle = color.fill;
    ctx.fill();
    label(ctx, ball === '0' ? '•' : ball.toUpperCase(), cx, cy + radius * 0.06, {
      size: radius * (ball.length > 1 ? 0.8 : 1.05),
      weight: 700,
      color: color.text,
      align: 'center',
    });
  }
  return x + slots * radius * 2.5;
}

const batterLine = (c: Cricket, i: 0 | 1) => {
  const batter = c.batters[i];
  return { name: `${batter.name}${c.striker === i ? ' *' : ''}`, score: `${batter.runs} (${batter.balls})` };
};

/** Match view: a two-row score strip under the video. */
export function drawCricketStrip(p: Painter, scene: Scene): void {
  const { ctx, size, unit } = p;
  const c = scene.cricket;
  const stats = cricketStats(c);
  const accent = scene.brand.color;
  const height = CRICKET_STRIP * unit;
  const top = size.height - height;
  const rowA = top + unit * 6;
  const rowB = top + unit * 13;

  ctx.fillStyle = 'rgb(4 16 46 / 0.97)';
  ctx.fillRect(0, top, size.width, height);
  // Saffron, white and blue bands along the top edge of the strip.
  [accent, '#ffffff', '#1a73e8'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, top + i * unit * 0.3, size.width, unit * 0.3);
  });

  // Left block: who is batting and the score, on the accent colour.
  const blockW = unit * 46;
  fillRound(ctx, unit * 3, top + unit * 2.4, blockW, unit * 7.2, unit * 1, accent);
  const on = readableOn(accent);
  let x = unit * 5;
  x += label(ctx, c.batting.toUpperCase(), x, rowA, { size: unit * 3.6, weight: 700, color: on, maxWidth: unit * 16 }) + unit * 2;
  x += label(ctx, `${c.runs}/${c.wickets}`, x, rowA, { size: unit * 4.8, weight: 700, color: on }) + unit * 2;
  label(ctx, `${stats.overs} / ${c.oversLimit} ov`, x, rowA + unit * 0.3, { size: unit * 2.6, color: on, maxWidth: unit * 3 + blockW - (x - unit * 3) - unit * 4 });

  // Middle: the two batters.
  const midX = unit * 3 + blockW + unit * 3;
  const colW = unit * 27;
  for (const i of [0, 1] as const) {
    const line = batterLine(c, i);
    const bx = midX + i * colW;
    const w = label(ctx, line.name, bx, rowA, { size: unit * 3, weight: c.striker === i ? 700 : 500, color: '#ffffff', maxWidth: colW - unit * 12 });
    label(ctx, line.score, bx + w + unit * 1.4, rowA, { size: unit * 3, weight: 700, color: GOLD });
  }

  // Right: the bowler.
  const right = size.width - unit * 3;
  const figures = label(ctx, stats.bowlerFigures, right, rowA, { size: unit * 3, weight: 700, color: GOLD, align: 'right' });
  label(ctx, c.bowler.name, right - figures - unit * 1.4, rowA, { size: unit * 3, color: '#ffffff', align: 'right', maxWidth: unit * 22 });

  // Second row: this over, run rates and what the chase needs.
  label(ctx, 'THIS OVER', unit * 3, rowB, { size: unit * 2, weight: 700, color: DIM });
  const overEnd = drawOver(p, c, unit * 15, rowB, unit * 1.9, accent);
  let info = `v ${c.bowling.toUpperCase()}   ·   CRR ${stats.runRate}`;
  if (stats.requiredRate) info += `   ·   RRR ${stats.requiredRate}`;
  label(ctx, info, overEnd + unit * 3, rowB, { size: unit * 2.5, color: DIM });
  if (stats.summary) label(ctx, stats.summary, right, rowB, { size: unit * 2.9, weight: 700, color: '#ffffff', align: 'right' });
}

function statCard(p: Painter, x: number, y: number, w: number, h: number, name: string, value: string): void {
  const { ctx, unit } = p;
  fillRound(ctx, x, y, w, h, unit * 1.2, PANEL);
  label(ctx, name, x + unit * 2, y + unit * 3, { size: unit * 2, weight: 700, color: DIM });
  label(ctx, value, x + unit * 2, y + h - unit * 4, { size: unit * 5, weight: 700, color: '#ffffff', maxWidth: w - unit * 4 });
}

/** Dashboard view: the whole scorecard, with the cameras in a column at the side. */
export function drawCricketDashboard(p: Painter, scene: Scene, hasCameras: boolean): void {
  const { ctx, unit } = p;
  const c = scene.cricket;
  const stats = cricketStats(c);
  const accent = scene.brand.color;
  const area = cricketDashboardArea(p.size, hasCameras);
  const gap = unit * 2;
  const pad = unit * 2.6;

  // Header: match title and the two sides.
  label(ctx, c.title.toUpperCase() || 'MATCH', area.x, area.y + unit * 3, { size: unit * 2.6, weight: 700, color: DIM, maxWidth: area.width * 0.6 });
  label(ctx, `${c.batting.toUpperCase()}  v  ${c.bowling.toUpperCase()}`, area.x + area.width, area.y + unit * 3, {
    size: unit * 2.6,
    weight: 700,
    color: DIM,
    align: 'right',
  });

  // Score hero.
  const heroY = area.y + unit * 7;
  const heroH = unit * 24;
  fillRound(ctx, area.x, heroY, area.width, heroH, unit * 1.6, accent);
  const on = readableOn(accent);
  label(ctx, `${c.batting.toUpperCase()} · BATTING`, area.x + pad, heroY + unit * 4.6, { size: unit * 2.6, weight: 700, color: on });
  const scoreW = label(ctx, `${c.runs}/${c.wickets}`, area.x + pad, heroY + unit * 14.5, { size: unit * 14, weight: 700, color: on });
  label(ctx, `${stats.overs} overs`, area.x + pad + scoreW + unit * 2.4, heroY + unit * 17, { size: unit * 4, color: on });
  label(ctx, `of ${c.oversLimit}`, area.x + pad + scoreW + unit * 2.4, heroY + unit * 12, { size: unit * 2.4, color: on });
  if (stats.summary) {
    label(ctx, stats.summary, area.x + area.width - pad, heroY + heroH - unit * 4.4, {
      size: unit * 3.6,
      weight: 700,
      color: on,
      align: 'right',
      maxWidth: area.width * 0.5,
    });
  }

  // Three numbers.
  const cardsY = heroY + heroH + gap;
  const cardH = unit * 13;
  const cardW = (area.width - gap * 2) / 3;
  statCard(p, area.x, cardsY, cardW, cardH, 'RUN RATE', stats.runRate);
  statCard(p, area.x + cardW + gap, cardsY, cardW, cardH, c.target === null ? 'OVERS LEFT' : 'REQUIRED RATE',
    c.target === null ? String(Math.max(0, c.oversLimit - Math.ceil(c.balls / 6))) : (stats.requiredRate ?? '–'));
  statCard(p, area.x + (cardW + gap) * 2, cardsY, cardW, cardH, 'TARGET', c.target === null ? '–' : String(c.target));

  // Batters and bowler.
  const tableY = cardsY + cardH + gap;
  const tableH = unit * 21;
  const batW = area.width * 0.6 - gap / 2;
  const bowlX = area.x + batW + gap;
  const bowlW = area.width - batW - gap;
  fillRound(ctx, area.x, tableY, batW, tableH, unit * 1.2, PANEL);
  label(ctx, 'BATTERS', area.x + pad, tableY + unit * 3.2, { size: unit * 2, weight: 700, color: DIM });
  label(ctx, 'R (B)', area.x + batW - pad, tableY + unit * 3.2, { size: unit * 2, weight: 700, color: DIM, align: 'right' });
  for (const i of [0, 1] as const) {
    const line = batterLine(c, i);
    const y = tableY + unit * 9 + i * unit * 6.6;
    if (c.striker === i) fillRound(ctx, area.x + unit * 1, y - unit * 2.8, unit * 0.7, unit * 5.6, unit * 0.3, GOLD);
    label(ctx, line.name, area.x + pad, y, { size: unit * 3.4, weight: c.striker === i ? 700 : 500, color: '#ffffff', maxWidth: batW - unit * 22 });
    label(ctx, line.score, area.x + batW - pad, y, { size: unit * 3.4, weight: 700, color: GOLD, align: 'right' });
  }

  fillRound(ctx, bowlX, tableY, bowlW, tableH, unit * 1.2, PANEL);
  label(ctx, 'BOWLING', bowlX + pad, tableY + unit * 3.2, { size: unit * 2, weight: 700, color: DIM });
  label(ctx, c.bowler.name, bowlX + pad, tableY + unit * 9, { size: unit * 3.4, weight: 700, color: '#ffffff', maxWidth: bowlW - pad * 2 });
  label(ctx, stats.bowlerFigures, bowlX + pad, tableY + unit * 15.6, { size: unit * 4.4, weight: 700, color: GOLD });

  // This over.
  const overY = tableY + tableH + gap;
  const overH = area.y + area.height - overY;
  fillRound(ctx, area.x, overY, area.width, overH, unit * 1.2, PANEL);
  label(ctx, 'THIS OVER', area.x + pad, overY + overH / 2, { size: unit * 2, weight: 700, color: DIM });
  drawOver(p, c, area.x + pad + unit * 14, overY + overH / 2, Math.min(unit * 3, overH * 0.32), accent);
}
