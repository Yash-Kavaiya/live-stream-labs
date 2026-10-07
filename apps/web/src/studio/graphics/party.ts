import { nextInQueue, playbackPosition, pollLeader, pollTotals, rankedScores, type Party, type Scene } from '@studio/shared';
import { drawEmoji, rand } from './celebration';
import { drawPill, ellipsize, fillRound, FONT, label, readableOn, wrapText, type Painter } from './painter';

const BURST_MS = 4000;
/** A burst older than this when first seen has already played for everyone else. */
const BURST_STALE_MS = 6000;
const PANEL = 'rgb(10 6 24 / 0.82)';
const MUTED = 'rgb(255 255 255 / 0.65)';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** 75 -> "1:15" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The pill, and beside it what is playing, how far in, and what comes next. */
function drawNowPlaying(p: Painter, scene: Scene, now: number, wall: number): void {
  const { ctx, size, unit } = p;
  const { party } = scene;
  const accent = scene.brand.color;
  const y = unit * 3;
  const pillEnd = drawPill(p, unit * 3, y, 'WATCH PARTY', accent, readableOn(accent), now);
  const playing = party.playing;
  if (!party.showBar || !playing) return;

  const x = pillEnd + unit * 1.5;
  const height = unit * 2.6 * 1.9;
  // The brand logo sits in the top-right corner; the bar stops short of it.
  const width = Math.min(size.width * 0.62, size.width - x - unit * 18);
  if (width < unit * 30) return;
  const mid = y + height / 2 + unit * 0.1;
  fillRound(ctx, x, y, width, height, unit, PANEL);

  const paused = playing.pausedAt !== null;
  label(ctx, paused ? '❚❚' : '▶', x + unit * 1.6, mid, { size: unit * 2, weight: 700, color: paused ? MUTED : accent });

  const timed = playing.duration > 0;
  const position = playbackPosition(playing, wall);
  const next = nextInQueue(party, playing.itemId);
  let right = x + width - unit * 1.6;
  if (next) {
    ctx.font = `500 ${unit * 2}px ${FONT}`;
    const text = ellipsize(ctx, `Next: ${next.title}`, width * 0.32);
    right -= label(ctx, text, right, mid, { size: unit * 2, color: MUTED, align: 'right' }) + unit * 1.6;
  }
  if (timed) {
    right -= label(ctx, `${clock(position)} / ${clock(playing.duration)}`, right, mid, { size: unit * 2.1, weight: 700, color: '#ffffff', align: 'right' }) + unit * 1.6;
  }
  label(ctx, playing.title, x + unit * 4.4, mid, { size: unit * 2.4, weight: 700, color: '#ffffff', maxWidth: right - (x + unit * 4.4) });

  if (timed) {
    const line = unit * 0.45;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, unit);
    ctx.clip();
    ctx.fillStyle = 'rgb(255 255 255 / 0.18)';
    ctx.fillRect(x, y + height - line, width, line);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + height - line, width * clamp01(position / playing.duration), line);
    ctx.restore();
  }
}

/** Between two videos: the title of the next one and the seconds until it starts. */
function drawUpNext(p: Painter, scene: Scene, wall: number): void {
  const { ctx, size, unit } = p;
  const { party } = scene;
  if (party.upNextUntil === null || party.upNextUntil <= wall) return;
  const next = nextInQueue(party, party.playing?.itemId ?? null);
  if (!next) return;

  const width = size.width * 0.56;
  const height = unit * 26;
  const x = (size.width - width) / 2;
  const y = (size.height - height) / 2;
  const accent = scene.brand.color;
  ctx.save();
  ctx.fillStyle = 'rgb(6 3 16 / 0.6)';
  ctx.fillRect(0, 0, size.width, size.height);
  fillRound(ctx, x, y, width, height, unit * 2, PANEL);
  fillRound(ctx, x, y, width, unit * 1, [unit * 2, unit * 2, 0, 0], accent);
  label(ctx, 'UP NEXT', size.width / 2, y + unit * 6, { size: unit * 2.6, weight: 700, color: MUTED, align: 'center' });
  ctx.font = `700 ${unit * 5}px ${FONT}`;
  wrapText(ctx, next.title, width - unit * 8, 2).forEach((line, i) => {
    label(ctx, line, size.width / 2, y + unit * 12.5 + i * unit * 6, { size: unit * 5, weight: 700, color: '#ffffff', align: 'center' });
  });
  const seconds = Math.ceil((party.upNextUntil - wall) / 1000);
  label(ctx, `Starts in ${seconds}`, size.width / 2, y + height - unit * 3.6, { size: unit * 2.4, color: accent, align: 'center', weight: 700 });
  ctx.restore();
}

/** The poll on the right of the frame: a bar per answer, its number for voting, and its share. */
function drawPoll(p: Painter, scene: Scene): void {
  const poll = scene.party.poll;
  if (!poll?.show) return;
  const { ctx, size, unit } = p;
  const accent = scene.brand.color;
  const width = size.width * 0.3;
  const pad = unit * 2.2;
  const inner = width - pad * 2;
  const rowHeight = unit * 7.6;

  ctx.font = `700 ${unit * 3}px ${FONT}`;
  const question = wrapText(ctx, poll.question, inner, 3);
  const height = pad * 2 + unit * 3.4 + question.length * unit * 3.8 + unit * 1.4 + poll.options.length * rowHeight + unit * 2.6;
  // Clear of the hype meter on the right edge.
  const x = size.width - width - unit * 6.5;
  const y = Math.max(unit * 11, (size.height - height) / 2);

  fillRound(ctx, x, y, width, height, unit * 1.6, PANEL);
  fillRound(ctx, x, y, width, unit * 0.9, [unit * 1.6, unit * 1.6, 0, 0], accent);
  label(ctx, poll.open ? 'POLL' : 'POLL CLOSED', x + pad, y + pad + unit * 1.2, { size: unit * 2.1, weight: 700, color: poll.open ? accent : MUTED });
  let top = y + pad + unit * 5.2;
  for (const line of question) {
    label(ctx, line, x + pad, top, { size: unit * 3, weight: 700, color: '#ffffff' });
    top += unit * 3.8;
  }
  top += unit * 0.6;

  const totals = pollTotals(poll);
  const all = totals.reduce((sum, n) => sum + n, 0);
  const leader = pollLeader(poll);
  poll.options.forEach((option, i) => {
    const share = all > 0 ? totals[i]! / all : 0;
    const winning = !poll.open && leader === i;
    const barY = top + unit * 3.6;
    const barHeight = unit * 2.6;
    label(ctx, `${i + 1}`, x + pad + unit * 1.3, top + unit * 1.5, { size: unit * 2.4, weight: 700, color: accent, align: 'center' });
    label(ctx, option, x + pad + unit * 3.4, top + unit * 1.5, { size: unit * 2.4, weight: winning ? 700 : 500, color: '#ffffff', maxWidth: inner - unit * 13 });
    label(ctx, `${Math.round(share * 100)}%`, x + width - pad, top + unit * 1.5, { size: unit * 2.4, weight: 700, color: '#ffffff', align: 'right' });
    fillRound(ctx, x + pad, barY, inner, barHeight, barHeight / 2, 'rgb(255 255 255 / 0.14)');
    if (share > 0) fillRound(ctx, x + pad, barY, Math.max(barHeight, inner * share), barHeight, barHeight / 2, winning || poll.open ? accent : 'rgb(255 255 255 / 0.45)');
    top += rowHeight;
  });
  const footer = poll.open ? `${all} ${all === 1 ? 'vote' : 'votes'} · type the number in chat` : `${all} ${all === 1 ? 'vote' : 'votes'}`;
  label(ctx, footer, x + pad, top + unit * 0.9, { size: unit * 1.9, color: MUTED, maxWidth: inner });
}

/** Names by points, down the left of the frame. */
function drawScores(p: Painter, scene: Scene): void {
  const { party } = scene;
  if (!party.showScores || party.scores.length === 0) return;
  const { ctx, size, unit } = p;
  const accent = scene.brand.color;
  const ranked = rankedScores(party.scores);
  const width = size.width * 0.23;
  const pad = unit * 2;
  const row = unit * 5;
  const height = pad * 2 + unit * 3.6 + ranked.length * row;
  const x = unit * 3;
  const y = Math.max(unit * 11, (size.height - height) / 2);

  fillRound(ctx, x, y, width, height, unit * 1.6, PANEL);
  fillRound(ctx, x, y, width, unit * 0.9, [unit * 1.6, unit * 1.6, 0, 0], accent);
  label(ctx, 'SCOREBOARD', x + pad, y + pad + unit * 1.2, { size: unit * 2.1, weight: 700, color: accent });
  const best = ranked[0]!.points;
  ranked.forEach((score, i) => {
    const mid = y + pad + unit * 3.6 + i * row + row / 2;
    const leads = score.points === best && best > 0;
    if (leads) fillRound(ctx, x + pad * 0.5, mid - row * 0.42, width - pad, row * 0.84, unit * 0.9, 'rgb(255 255 255 / 0.1)');
    label(ctx, `${i + 1}`, x + pad + unit * 0.8, mid, { size: unit * 2.2, weight: 700, color: MUTED, align: 'center' });
    label(ctx, score.name, x + pad + unit * 3, mid, { size: unit * 2.6, weight: leads ? 700 : 500, color: '#ffffff', maxWidth: width - pad * 2 - unit * 10 });
    label(ctx, String(score.points), x + width - pad, mid, { size: unit * 2.8, weight: 700, color: leads ? '#FBBC04' : '#ffffff', align: 'right' });
  });
}

/** A bar up the right edge that fills as chat reacts. */
function drawHype(p: Painter, party: Party, now: number): void {
  if (!party.showHype || party.hype <= 0) return;
  const { ctx, size, unit } = p;
  const width = unit * 1.6;
  const height = size.height * 0.44;
  const x = size.width - unit * 3 - width;
  const y = (size.height - height) / 2 + unit * 2;
  const level = party.hype / 100;

  fillRound(ctx, x, y, width, height, width / 2, 'rgb(10 6 24 / 0.7)');
  const fill = Math.max(width, height * level);
  const gradient = ctx.createLinearGradient(0, y + height, 0, y);
  gradient.addColorStop(0, '#FBBC04');
  gradient.addColorStop(0.6, '#FF6D01');
  gradient.addColorStop(1, '#EA4335');
  fillRound(ctx, x, y + height - fill, width, fill, width / 2, gradient as unknown as string);
  // The flame grows and shakes a little as the meter fills.
  const wobble = Math.sin(now / 90) * unit * 0.25 * level;
  drawEmoji(ctx, '🔥', x + width / 2 + wobble, y - unit * 2.6, unit * (3 + level * 2.4));
}

/**
 * Everything the watch party draws over the video. One is kept per compositor, because a reaction
 * burst is played once from the moment this client first sees it.
 */
export class PartyLayer {
  private burst: { id: string; startedAt: number } | null = null;

  /** `now` is the draw clock; `wall` is the time of day, which playback progress is measured in. */
  draw(p: Painter, scene: Scene, now: number, wall: number): void {
    drawNowPlaying(p, scene, now, wall);
    drawScores(p, scene);
    drawPoll(p, scene);
    drawHype(p, scene.party, now);
    this.drawBurst(p, scene.party, now, wall);
    drawUpNext(p, scene, wall);
  }

  /** Emoji from chat rising from the bottom edge. */
  private drawBurst({ ctx, size, unit }: Painter, party: Party, now: number, wall: number): void {
    const next = party.burst;
    if (!next || next.emojis.length === 0) return;
    if (next.id !== this.burst?.id) {
      this.burst = { id: next.id, startedAt: wall - next.at > BURST_STALE_MS ? -Infinity : now };
    }
    const t = now - this.burst.startedAt;
    if (t >= BURST_MS) return;
    // Each emoji in the burst is drawn twice, so a single reaction is still seen.
    const count = next.emojis.length * 2;
    for (let i = 0; i < count; i += 1) {
      const start = rand(i, 11) * BURST_MS * 0.3;
      const age = clamp01((t - start) / (BURST_MS * 0.7));
      if (age <= 0 || age >= 1) continue;
      const x = size.width * (0.08 + rand(i, 12) * 0.84) + Math.sin(age * 6 + i) * unit * 2.5;
      const y = size.height * (1.04 - age * (0.5 + rand(i, 13) * 0.4));
      ctx.save();
      ctx.globalAlpha *= clamp01((1 - age) * 2.4);
      drawEmoji(ctx, next.emojis[i % next.emojis.length]!, x, y, unit * (5 + rand(i, 14) * 4) * easeOutBack(clamp01(age * 5)), Math.sin(age * 4 + i) * 0.3);
      ctx.restore();
    }
  }
}
