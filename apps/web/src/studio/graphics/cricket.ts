import { CRICKET_STRIP, cricketDashboardArea, cricketSplitPanel, cricketStats, type Cricket, type CricketStats, type Scene } from '@studio/shared';
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
  const note = situation(c, stats);
  if (note) label(ctx, note, right, rowB, { size: unit * 2.9, weight: 700, color: '#ffffff', align: 'right', maxWidth: size.width * 0.34 });
}

/** The line that says where the match stands: the feed's own words when live, else worked out. */
function situation(c: Cricket, stats: CricketStats): string {
  return (c.source === 'live' && c.status) || stats.summary || '';
}

/** Score-bug view: the cameras keep the whole frame and a small score box sits in the top-left corner. */
export function drawCricketBug(p: Painter, scene: Scene): void {
  const { ctx, unit } = p;
  const c = scene.cricket;
  const stats = cricketStats(c);
  const accent = scene.brand.color;
  const x = unit * 3;
  const y = unit * 3;
  const w = unit * 62;
  const h = unit * 19;

  fillRound(ctx, x, y, w, h, unit * 1.4, 'rgb(4 16 46 / 0.92)');
  fillRound(ctx, x, y, unit * 1, h, [unit * 1.4, 0, 0, unit * 1.4], accent);

  // Top row: the batting side and its score.
  const rowA = y + unit * 5;
  let cursor = x + unit * 3.4;
  cursor += label(ctx, c.batting.toUpperCase(), cursor, rowA, { size: unit * 3.6, weight: 700, color: '#ffffff', maxWidth: unit * 14 }) + unit * 1.6;
  cursor += label(ctx, `${c.runs}/${c.wickets}`, cursor, rowA, { size: unit * 4.8, weight: 700, color: GOLD }) + unit * 1.6;
  label(ctx, `(${stats.overs})`, cursor, rowA + unit * 0.3, { size: unit * 2.6, color: DIM });
  label(ctx, c.other || `v ${c.bowling.toUpperCase()}`, x + w - unit * 2.4, rowA, { size: unit * 2.4, color: DIM, align: 'right', maxWidth: unit * 22 });

  // Middle row: this over.
  drawOver(p, c, x + unit * 3.4, y + unit * 10.6, unit * 1.5, accent);
  label(ctx, `CRR ${stats.runRate}${stats.requiredRate ? `  RRR ${stats.requiredRate}` : ''}`, x + w - unit * 2.4, y + unit * 10.6, { size: unit * 2.2, color: DIM, align: 'right' });

  // Bottom row: where the match stands, or the striker.
  const striker = c.batters[c.striker];
  const note = situation(c, stats) || `${striker.name} ${striker.runs} (${striker.balls})`;
  label(ctx, note, x + unit * 3.4, y + unit * 15.6, { size: unit * 2.5, weight: 700, color: '#ffffff', maxWidth: w - unit * 6 });
}

/** One row of a small table: a name on the left, figures on the right. */
function tableRow(p: Painter, x: number, y: number, w: number, name: string, figures: string, opts: { bold?: boolean; sub?: string } = {}): void {
  const { ctx, unit } = p;
  const figuresW = label(ctx, figures, x + w, y, { size: unit * 2.9, weight: 700, color: GOLD, align: 'right' });
  const nameW = label(ctx, name, x, y, { size: unit * 2.9, weight: opts.bold ? 700 : 500, color: '#ffffff', maxWidth: w - figuresW - unit * 2 });
  if (opts.sub) label(ctx, opts.sub, x + nameW + unit * 1.4, y + unit * 0.2, { size: unit * 2.1, color: DIM, maxWidth: Math.max(0, w - figuresW - nameW - unit * 4) });
}

/** Split view: the cameras on the left and a tall score panel on the right. */
export function drawCricketSplit(p: Painter, scene: Scene): void {
  const { ctx, unit } = p;
  const c = scene.cricket;
  const stats = cricketStats(c);
  const accent = scene.brand.color;
  const on = readableOn(accent);
  const panel = cricketSplitPanel(p.size);
  const pad = unit * 2.4;
  const inner = panel.width - pad * 2;
  const left = panel.x + pad;

  fillRound(ctx, panel.x, panel.y, panel.width, panel.height, unit * 1.6, 'rgb(4 16 46 / 0.9)');
  label(ctx, (c.title || 'MATCH').toUpperCase(), left, panel.y + unit * 3.6, { size: unit * 2, weight: 700, color: DIM, maxWidth: inner });

  // Score hero.
  const heroY = panel.y + unit * 6.4;
  const heroH = unit * 19;
  fillRound(ctx, left, heroY, inner, heroH, unit * 1.4, accent);
  label(ctx, `${c.batting.toUpperCase()} · BATTING`, left + pad, heroY + unit * 3.8, { size: unit * 2.2, weight: 700, color: on, maxWidth: inner - pad * 2 });
  const scoreW = label(ctx, `${c.runs}/${c.wickets}`, left + pad, heroY + unit * 10.6, { size: unit * 9.5, weight: 700, color: on });
  label(ctx, `${stats.overs} ov`, left + pad + scoreW + unit * 1.6, heroY + unit * 12.4, { size: unit * 3, color: on });
  label(ctx, c.other || `v ${c.bowling.toUpperCase()}`, left + pad, heroY + heroH - unit * 2.8, { size: unit * 2.3, weight: 600, color: on, maxWidth: inner - pad * 2 });

  // Batters and bowler.
  let y = heroY + heroH + unit * 3.6;
  label(ctx, 'BATTERS', left, y, { size: unit * 1.9, weight: 700, color: DIM });
  for (const i of [0, 1] as const) {
    y += unit * 4.6;
    const line = batterLine(c, i);
    tableRow(p, left, y, inner, line.name, line.score, { bold: c.striker === i });
  }
  y += unit * 5;
  label(ctx, 'BOWLING', left, y, { size: unit * 1.9, weight: 700, color: DIM });
  y += unit * 4.6;
  tableRow(p, left, y, inner, c.bowler.name, stats.bowlerFigures, { bold: true });

  // This over and the rates.
  y += unit * 5;
  label(ctx, 'THIS OVER', left, y, { size: unit * 1.9, weight: 700, color: DIM });
  drawOver(p, c, left, y + unit * 4.2, Math.min(unit * 1.7, inner / (Math.max(6, c.thisOver.length) * 2.5)), accent);
  y += unit * 8.6;
  label(ctx, `CRR ${stats.runRate}${stats.requiredRate ? `   ·   RRR ${stats.requiredRate}` : ''}${c.target === null ? '' : `   ·   Target ${c.target}`}`, left, y, { size: unit * 2.3, color: DIM, maxWidth: inner });

  const noteH = unit * 6.4;
  const chartTop = y + unit * 3;
  const chartBottom = panel.y + panel.height - pad - noteH - unit * 1.6;
  if (chartBottom - chartTop > unit * 9) drawOversChart(p, c, left, chartTop, inner, chartBottom - chartTop, accent);

  const note = situation(c, stats);
  if (note) {
    const noteY = panel.y + panel.height - pad - noteH;
    fillRound(ctx, left, noteY, inner, noteH, unit * 1.2, PANEL);
    label(ctx, note, left + inner / 2, noteY + noteH / 2, { size: unit * 2.6, weight: 700, color: '#ffffff', align: 'center', maxWidth: inner - pad });
  }
}

/** Card view: the batting card and the bowlers, with the cameras in a column at the side. */
export function drawCricketCard(p: Painter, scene: Scene, hasCameras: boolean): void {
  const { ctx, unit } = p;
  const c = scene.cricket;
  const stats = cricketStats(c);
  const accent = scene.brand.color;
  const on = readableOn(accent);
  const area = cricketDashboardArea(p.size, hasCameras);
  const pad = unit * 2.6;
  const gap = unit * 2;

  // Header bar: the batting side's score, with the match title.
  const headH = unit * 10;
  fillRound(ctx, area.x, area.y, area.width, headH, unit * 1.4, accent);
  let x = area.x + pad;
  x += label(ctx, c.batting.toUpperCase(), x, area.y + headH / 2, { size: unit * 4, weight: 700, color: on, maxWidth: unit * 16 }) + unit * 2;
  x += label(ctx, `${c.runs}/${c.wickets}`, x, area.y + headH / 2, { size: unit * 5.4, weight: 700, color: on }) + unit * 2;
  label(ctx, `(${stats.overs} ov)`, x, area.y + headH / 2 + unit * 0.3, { size: unit * 2.8, color: on });
  label(ctx, c.other || c.title, area.x + area.width - pad, area.y + headH / 2, { size: unit * 2.6, weight: 600, color: on, align: 'right', maxWidth: area.width * 0.34 });

  // Without a live card, the two batters at the crease are all there is to show.
  const batters = c.card.length > 0 ? c.card : c.batters.map((b, i) => ({ name: b.name, how: c.striker === i ? 'on strike' : 'not out', runs: b.runs, balls: b.balls }));
  const bowlers = c.attack.length > 0 ? c.attack : [{ name: c.bowler.name, overs: `${Math.floor(c.bowler.balls / 6)}.${c.bowler.balls % 6}`, runs: c.bowler.runs, wickets: c.bowler.wickets }];

  const note = situation(c, stats);
  const noteH = note ? unit * 6 : 0;
  const bodyY = area.y + headH + gap;
  const bodyH = area.y + area.height - bodyY - (note ? noteH + gap : 0);
  const batW = area.width * 0.62 - gap / 2;
  const bowlX = area.x + batW + gap;
  const bowlW = area.width - batW - gap;

  // Batting.
  fillRound(ctx, area.x, bodyY, batW, bodyH, unit * 1.2, PANEL);
  label(ctx, 'BATTING', area.x + pad, bodyY + unit * 3.2, { size: unit * 1.9, weight: 700, color: DIM });
  label(ctx, 'R (B)', area.x + batW - pad, bodyY + unit * 3.2, { size: unit * 1.9, weight: 700, color: DIM, align: 'right' });
  const batRow = Math.min(unit * 6, (bodyH - unit * 6.5) / Math.max(1, batters.length));
  batters.forEach((batter, i) => {
    const y = bodyY + unit * 6.2 + batRow * (i + 0.5);
    const notOut = batter.how === 'not out' || batter.how === 'on strike';
    if (notOut) fillRound(ctx, area.x + unit * 1, y - batRow * 0.36, unit * 0.6, batRow * 0.72, unit * 0.3, GOLD);
    tableRow(p, area.x + pad, y, batW - pad * 2, batter.name, `${batter.runs} (${batter.balls})`, { bold: notOut, sub: batter.how });
  });

  // Bowling.
  fillRound(ctx, bowlX, bodyY, bowlW, bodyH, unit * 1.2, PANEL);
  label(ctx, 'BOWLING', bowlX + pad, bodyY + unit * 3.2, { size: unit * 1.9, weight: 700, color: DIM });
  label(ctx, 'W-R (O)', bowlX + bowlW - pad, bodyY + unit * 3.2, { size: unit * 1.9, weight: 700, color: DIM, align: 'right' });
  const chartH = c.overs.length > 0 ? Math.min(unit * 24, bodyH * 0.4) : 0;
  const bowlRow = Math.min(unit * 6, (bodyH - chartH - unit * 6.5) / Math.max(1, bowlers.length));
  if (chartH) drawOversChart(p, c, bowlX + pad, bodyY + bodyH - chartH, bowlW - pad * 2, chartH - unit * 1.4, accent);
  bowlers.forEach((bowler, i) => {
    const y = bodyY + unit * 6.2 + bowlRow * (i + 0.5);
    tableRow(p, bowlX + pad, y, bowlW - pad * 2, bowler.name, `${bowler.wickets}-${bowler.runs} (${bowler.overs})`, { bold: bowler.name === c.bowler.name });
  });

  if (note) {
    const noteY = area.y + area.height - noteH;
    fillRound(ctx, area.x, noteY, area.width, noteH, unit * 1.2, PANEL);
    label(ctx, note, area.x + area.width / 2, noteY + noteH / 2, { size: unit * 2.8, weight: 700, color: '#ffffff', align: 'center', maxWidth: area.width - pad * 2 });
  }
}

const WICKET = '#d93025';

/**
 * Runs in each over of the innings as a bar chart, with a marked disc above an over for each
 * wicket that fell in it. A limited-overs innings shows a slot for every over still to come, so
 * the chart also says how far the innings has gone.
 */
function drawOversChart(p: Painter, c: Cricket, x: number, y: number, w: number, h: number, accent: string): void {
  const { ctx, unit } = p;
  if (c.overs.length === 0) return;
  label(ctx, 'RUNS PER OVER', x, y + unit * 1.2, { size: unit * 1.9, weight: 700, color: DIM });

  const lastOver = c.overs[c.overs.length - 1]!.over;
  const slots = Math.max(lastOver, c.oversLimit <= 50 ? c.oversLimit : 0, 6);
  const firstOver = Math.max(1, lastOver - 49);
  const shown = slots - firstOver + 1;
  const top = y + unit * 6.4;
  const base = y + h - unit * 2.8;
  const plotH = Math.max(unit * 2, base - top);
  const step = w / shown;
  const barW = Math.max(unit * 0.5, Math.min(unit * 3, step - Math.max(2, unit * 0.3)));
  const peak = Math.max(12, ...c.overs.map((o) => o.runs));
  const best = c.overs.reduce((a, b) => (b.runs > a.runs ? b : a));
  const current = c.overs[c.overs.length - 1]!;

  ctx.fillStyle = 'rgb(255 255 255 / 0.16)';
  ctx.fillRect(x, base, w, Math.max(1, unit * 0.12));

  for (let over = firstOver; over <= slots; over++) {
    const cx = x + (over - firstOver + 0.5) * step;
    // Over numbers along the bottom: the first, every fifth and the last.
    if (over === firstOver || over % 5 === 0 || over === slots) label(ctx, String(over), cx, base + unit * 1.7, { size: unit * 1.5, color: DIM, align: 'center' });
    const data = c.overs.find((o) => o.over === over);
    if (!data) continue;

    const barH = Math.max(unit * 0.4, (data.runs / peak) * plotH);
    const radius = Math.min(unit * 0.6, barW / 2);
    fillRound(ctx, cx - barW / 2, base - barH, barW, barH, [radius, radius, 0, 0], data === current ? GOLD : accent);
    let above = base - barH - unit * 1.4;
    // Only the biggest over and the one in progress carry their number; the rest read off the scale of those two.
    if (data === best || data === current) {
      label(ctx, String(data.runs), cx, above, { size: unit * 1.7, weight: 700, color: '#ffffff', align: 'center' });
      above -= unit * 2;
    }
    for (let i = 0; i < data.wickets; i++) {
      const r = Math.min(unit * 0.95, barW * 0.6);
      ctx.beginPath();
      ctx.arc(cx, above - i * r * 2.3, r, 0, Math.PI * 2);
      ctx.fillStyle = WICKET;
      ctx.fill();
      label(ctx, 'W', cx, above - i * r * 2.3 + r * 0.08, { size: r * 1.25, weight: 700, color: '#ffffff', align: 'center' });
    }
  }
}

/** A team's badge: its colour as a disc with the short name on it. */
function teamBadge(p: Painter, cx: number, cy: number, radius: number, name: string, color: string): void {
  const { ctx } = p;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = radius * 0.12;
  ctx.strokeStyle = 'rgb(255 255 255 / 0.85)';
  ctx.stroke();
  label(ctx, name.toUpperCase().slice(0, 4), cx, cy + radius * 0.05, { size: radius * (name.length > 3 ? 0.6 : 0.74), weight: 700, color: readableOn(color), align: 'center' });
}

function statCard(p: Painter, x: number, y: number, w: number, h: number, name: string, value: string, hint = ''): void {
  const { ctx, unit } = p;
  fillRound(ctx, x, y, w, h, unit * 1.2, PANEL);
  label(ctx, name, x + unit * 1.8, y + unit * 2.8, { size: unit * 1.8, weight: 700, color: DIM, maxWidth: w - unit * 3.6 });
  const valueW = label(ctx, value, x + unit * 1.8, y + h - unit * 3.6, { size: unit * 4.6, weight: 700, color: '#ffffff', maxWidth: w - unit * 3.6 });
  if (hint) label(ctx, hint, x + unit * 2.6 + valueW, y + h - unit * 3.2, { size: unit * 1.9, color: DIM, maxWidth: Math.max(0, w - valueW - unit * 4.4) });
}

/** Dashboard view: both sides, the numbers, who is at the crease and the over-by-over chart, with the cameras in a column at the side. */
export function drawCricketDashboard(p: Painter, scene: Scene, hasCameras: boolean): void {
  const { ctx, unit } = p;
  const c = scene.cricket;
  const stats = cricketStats(c);
  const accent = scene.brand.color;
  const [battingColor, bowlingColor] = c.colors ?? [accent, '#5f6368'];
  const area = cricketDashboardArea(p.size, hasCameras);
  const gap = unit * 2;
  const pad = unit * 2.4;

  label(ctx, (c.title || 'MATCH').toUpperCase(), area.x, area.y + unit * 1.6, { size: unit * 2.2, weight: 700, color: DIM, maxWidth: area.width });

  // The two sides. The one batting is lit up and carries the big score.
  const heroY = area.y + unit * 4.6;
  const heroH = unit * 17;
  const sideW = (area.width - gap) / 2;
  const badgeR = unit * 5;
  const side = (x: number, name: string, color: string, score: string, detail: string, batting: boolean) => {
    fillRound(ctx, x, heroY, sideW, heroH, unit * 1.6, batting ? 'rgb(255 255 255 / 0.13)' : PANEL);
    if (batting) fillRound(ctx, x, heroY, sideW, unit * 0.7, [unit * 1.6, unit * 1.6, 0, 0], GOLD);
    teamBadge(p, x + pad + badgeR, heroY + heroH / 2, badgeR, name, color);
    const tx = x + pad + badgeR * 2 + unit * 2.4;
    const room = sideW - (tx - x) - pad;
    label(ctx, batting ? `${name.toUpperCase()} · BATTING` : name.toUpperCase(), tx, heroY + unit * 3.6, { size: unit * 2, weight: 700, color: batting ? GOLD : DIM, maxWidth: room });
    const scoreW = label(ctx, score, tx, heroY + unit * 9.6, { size: batting ? unit * 8.4 : unit * 6, weight: 700, color: '#ffffff', maxWidth: room });
    label(ctx, detail, batting ? tx : tx + scoreW + unit * 1.4, batting ? heroY + unit * 14.8 : heroY + unit * 10.2, { size: unit * 2.3, color: DIM, maxWidth: batting ? room : Math.max(0, room - scoreW - unit * 1.4) });
  };
  // "WI 171 (19.1 ov)" → "171" and "(19.1 ov)".
  const other = /^\S+\s+(\S+)\s*(.*)$/.exec(c.other);
  side(area.x, c.batting, battingColor, `${c.runs}/${c.wickets}`, `${stats.overs} of ${c.oversLimit} overs`, true);
  side(area.x + sideW + gap, c.bowling, bowlingColor, other ? other[1]! : '–', other ? other[2]! : c.source === 'live' ? 'Yet to bat' : 'Bowling', false);

  // Where the match stands.
  const noteY = heroY + heroH + unit * 1.2;
  const noteH = unit * 5.4;
  const note = situation(c, stats);
  fillRound(ctx, area.x, noteY, area.width, noteH, unit * 1.2, 'rgb(253 214 99 / 0.16)');
  label(ctx, note || `${c.batting.toUpperCase()} v ${c.bowling.toUpperCase()}`, area.x + area.width / 2, noteY + noteH / 2, { size: unit * 2.8, weight: 700, color: '#ffffff', align: 'center', maxWidth: area.width - pad * 2 });

  // Four numbers.
  const cardsY = noteY + noteH + gap;
  const cardH = unit * 11;
  const cardW = (area.width - gap * 3) / 4;
  const chasing = c.target !== null;
  statCard(p, area.x, cardsY, cardW, cardH, 'RUN RATE', stats.runRate);
  if (chasing) statCard(p, area.x + cardW + gap, cardsY, cardW, cardH, 'REQUIRED RATE', stats.requiredRate ?? '–');
  else statCard(p, area.x + cardW + gap, cardsY, cardW, cardH, 'PROJECTED', c.projected === null ? '–' : String(c.projected));
  if (chasing) statCard(p, area.x + (cardW + gap) * 2, cardsY, cardW, cardH, 'TARGET', String(c.target));
  else statCard(p, area.x + (cardW + gap) * 2, cardsY, cardW, cardH, 'OVERS LEFT', String(Math.max(0, c.oversLimit - Math.ceil(c.balls / 6))));
  statCard(p, area.x + (cardW + gap) * 3, cardsY, cardW, cardH, 'PARTNERSHIP', c.partnership ? String(c.partnership.runs) : '–', c.partnership ? `${c.partnership.balls} balls` : '');

  // Batters and bowler.
  const tableY = cardsY + cardH + gap;
  const tableH = unit * 17.5;
  const batW = area.width * 0.6 - gap / 2;
  const bowlX = area.x + batW + gap;
  const bowlW = area.width - batW - gap;
  fillRound(ctx, area.x, tableY, batW, tableH, unit * 1.2, PANEL);
  label(ctx, 'BATTERS', area.x + pad, tableY + unit * 2.8, { size: unit * 1.8, weight: 700, color: DIM });
  label(ctx, 'R (B)', area.x + batW - pad, tableY + unit * 2.8, { size: unit * 1.8, weight: 700, color: DIM, align: 'right' });
  for (const i of [0, 1] as const) {
    const line = batterLine(c, i);
    const y = tableY + unit * 7.6 + i * unit * 5.6;
    if (c.striker === i) fillRound(ctx, area.x + unit * 1, y - unit * 2.2, unit * 0.6, unit * 4.4, unit * 0.3, GOLD);
    label(ctx, line.name, area.x + pad, y, { size: unit * 3.1, weight: c.striker === i ? 700 : 500, color: '#ffffff', maxWidth: batW - unit * 22 });
    label(ctx, line.score, area.x + batW - pad, y, { size: unit * 3.1, weight: 700, color: GOLD, align: 'right' });
  }
  fillRound(ctx, bowlX, tableY, bowlW, tableH, unit * 1.2, PANEL);
  label(ctx, 'BOWLING', bowlX + pad, tableY + unit * 2.8, { size: unit * 1.8, weight: 700, color: DIM });
  label(ctx, c.bowler.name, bowlX + pad, tableY + unit * 7.6, { size: unit * 3.1, weight: 700, color: '#ffffff', maxWidth: bowlW - pad * 2 });
  label(ctx, stats.bowlerFigures, bowlX + pad, tableY + unit * 13.2, { size: unit * 3.8, weight: 700, color: GOLD });

  // This over, and the innings over by over when the feed supplies it.
  const lastY = tableY + tableH + gap;
  const lastH = area.y + area.height - lastY;
  const charted = c.overs.length > 0;
  const overW = charted ? area.width * 0.34 - gap / 2 : area.width;
  fillRound(ctx, area.x, lastY, overW, lastH, unit * 1.2, PANEL);
  label(ctx, 'THIS OVER', area.x + pad, lastY + unit * 2.8, { size: unit * 1.8, weight: 700, color: DIM });
  const slots = Math.max(6, c.thisOver.length);
  drawOver(p, c, area.x + pad, lastY + lastH / 2 + unit * 1.4, Math.min(unit * 2.6, lastH * 0.24, (overW - pad * 2) / (slots * 2.5)), accent);
  if (charted) {
    const chartX = area.x + overW + gap;
    const chartW = area.width - overW - gap;
    fillRound(ctx, chartX, lastY, chartW, lastH, unit * 1.2, PANEL);
    drawOversChart(p, c, chartX + pad, lastY + unit * 1.6, chartW - pad * 2, lastH - unit * 2.4, accent);
  }
}
