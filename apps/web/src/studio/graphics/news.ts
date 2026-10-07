import { newsSafeArea, newsSidePanel, type Scene } from '@studio/shared';
import { drawPill, ellipsize, fillRound, FONT, label, readableOn, wrapText, type Painter } from './painter';

const TICKER_HEIGHT = 7.6;
const SUBHEAD_HEIGHT = 6;
const HEADLINE_HEIGHT = 10;

export interface NewsFrame {
  /** Headline to show and how far its bar has wiped in (0 to 1). Null when there is none. */
  headline: { text: string; alpha: number } | null;
  /** True when sources fill the anchor shot's side column, so the story panel must not draw. */
  sideOccupied: boolean;
  now: number;
}

/** Channel bar across the top: station name on the left, clock and date on the right. */
function drawChannelBar(p: Painter, scene: Scene, now: number): void {
  const { ctx, size, unit } = p;
  const accent = scene.brand.color;
  const height = unit * 6.4;
  const y = unit * 3;

  const end = drawPill(p, unit * 4, y + unit * 0.7, scene.news.channel.toUpperCase() || 'NEWS', accent, readableOn(accent), now);
  drawPill(p, end + unit, y + unit * 0.7, 'LIVE', 'rgb(255 255 255 / 0.14)', '#ffffff');

  const date = new Date();
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  const right = size.width - unit * 4;
  const clockWidth = label(ctx, clock, right, y + height / 2, { size: unit * 3.4, weight: 700, color: '#ffffff', align: 'right' });
  label(ctx, day, right - clockWidth - unit * 1.6, y + height / 2, {
    size: unit * 2.2,
    color: 'rgb(255 255 255 / 0.7)',
    align: 'right',
  });
}

/** Headline, subhead and the strip the ticker runs on, stacked from the bottom edge. */
function drawLowerThird(p: Painter, scene: Scene, frame: NewsFrame): void {
  const { ctx, size, unit } = p;
  const accent = scene.brand.color;
  const x = unit * 4;
  const width = size.width - unit * 8;

  // The strip under the ticker: always there, so the frame has a floor even with no ticker running.
  const stripY = size.height - TICKER_HEIGHT * unit;
  ctx.fillStyle = 'rgb(2 6 16 / 0.9)';
  ctx.fillRect(0, stripY, size.width, TICKER_HEIGHT * unit);
  ctx.fillStyle = accent;
  ctx.fillRect(0, stripY, size.width, unit * 0.4);
  label(ctx, scene.news.channel.toUpperCase(), x, stripY + (TICKER_HEIGHT * unit) / 2 + unit * 0.2, {
    size: unit * 2.4,
    weight: 700,
    color: 'rgb(255 255 255 / 0.5)',
  });

  if (!frame.headline) return;
  const { text, alpha } = frame.headline;
  const subhead = scene.news.subhead.trim();
  const subY = stripY - unit * 1.4 - SUBHEAD_HEIGHT * unit;
  const headY = (subhead ? subY : stripY - unit * 1.4) - HEADLINE_HEIGHT * unit;

  ctx.save();
  // Wipe in from the left: clip the whole block to a growing width.
  ctx.beginPath();
  ctx.rect(x, headY - unit, width * alpha, size.height);
  ctx.clip();

  const tag = scene.news.tag.trim().toUpperCase();
  ctx.font = `700 ${unit * 3}px ${FONT}`;
  const tagWidth = tag ? ctx.measureText(tag).width + unit * 4.4 : 0;
  const radius = unit * 0.9;

  fillRound(ctx, x, headY, width, HEADLINE_HEIGHT * unit, subhead ? [radius, radius, 0, 0] : radius, '#ffffff');
  if (tag) {
    fillRound(ctx, x, headY, tagWidth, HEADLINE_HEIGHT * unit, subhead ? [radius, 0, 0, 0] : [radius, 0, 0, radius], accent);
    label(ctx, tag, x + tagWidth / 2, headY + (HEADLINE_HEIGHT * unit) / 2 + unit * 0.2, {
      size: unit * 3,
      weight: 700,
      color: readableOn(accent),
      align: 'center',
    });
  }
  label(ctx, text, x + tagWidth + unit * 2.4, headY + (HEADLINE_HEIGHT * unit) / 2 + unit * 0.2, {
    size: unit * 4.6,
    weight: 700,
    color: '#111318',
    maxWidth: width - tagWidth - unit * 5,
  });

  if (subhead) {
    fillRound(ctx, x, subY, width, SUBHEAD_HEIGHT * unit, [0, 0, radius, radius], 'rgb(8 14 30 / 0.94)');
    label(ctx, subhead, x + unit * 2.4, subY + (SUBHEAD_HEIGHT * unit) / 2 + unit * 0.1, {
      size: unit * 2.8,
      color: '#ffffff',
      maxWidth: width - unit * 5,
    });
  }
  ctx.restore();
}

/** Anchor shot with nobody beside the presenter: a panel listing the points of the story. */
function drawStoryPanel(p: Painter, scene: Scene): void {
  const { ctx, unit } = p;
  const rect = newsSidePanel(p.size);
  const accent = scene.brand.color;
  const pad = unit * 2.6;
  const points = scene.news.points.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5);

  fillRound(ctx, rect.x, rect.y, rect.width, rect.height, unit * 1.4, 'rgb(255 255 255 / 0.07)');
  fillRound(ctx, rect.x, rect.y, rect.width, unit * 1, [unit * 1.4, unit * 1.4, 0, 0], accent);
  // The panel is headed by the story's own tag, so a repo of the day or a sign-off is not called the top story.
  const heading = points.length ? scene.news.tag.trim().toUpperCase() || 'TOP STORY' : scene.news.channel.toUpperCase();
  label(ctx, heading, rect.x + pad, rect.y + unit * 5.4, {
    size: unit * 2.4,
    weight: 700,
    color: 'rgb(255 255 255 / 0.65)',
  });

  if (points.length === 0) {
    // Nothing to list: a quiet station ident instead of an empty box.
    label(ctx, 'On air', rect.x + pad, rect.y + rect.height / 2, { size: unit * 6, weight: 500, color: '#ffffff' });
    return;
  }

  let y = rect.y + unit * 11;
  for (const point of points) {
    ctx.font = `500 ${unit * 3.1}px ${FONT}`;
    const lines = wrapText(ctx, point, rect.width - pad * 2 - unit * 3, 3);
    fillRound(ctx, rect.x + pad, y - unit * 1.2, unit * 1.1, unit * 1.1, unit * 0.3, accent);
    lines.forEach((line, i) => {
      label(ctx, line, rect.x + pad + unit * 3, y - unit * 0.6 + i * unit * 4, { size: unit * 3.1, color: '#ffffff' });
    });
    y += lines.length * unit * 4 + unit * 2.6;
    if (y > rect.y + rect.height - unit * 6) break;
  }
}

/** Anchor shot with a source card up: where the story came from, and the line worth reading. */
function drawSourceCard(p: Painter, scene: Scene): void {
  const source = scene.news.source;
  if (!source) return;
  const { ctx, unit } = p;
  const rect = newsSidePanel(p.size);
  const accent = scene.brand.color;
  const pad = unit * 2.6;
  const inner = rect.width - pad * 2;
  const bottom = rect.y + rect.height - pad;

  fillRound(ctx, rect.x, rect.y, rect.width, rect.height, unit * 1.4, 'rgb(255 255 255 / 0.96)');
  fillRound(ctx, rect.x, rect.y, rect.width, unit * 1, [unit * 1.4, unit * 1.4, 0, 0], accent);

  ctx.font = `700 ${unit * 2.2}px ${FONT}`;
  const site = ellipsize(ctx, source.site.toUpperCase(), inner - unit * 4);
  drawPill(p, rect.x + pad, rect.y + unit * 3.4, site, accent, readableOn(accent));

  let y = rect.y + unit * 11.5;
  ctx.font = `700 ${unit * 3.2}px ${FONT}`;
  for (const line of wrapText(ctx, source.title, inner, 3)) {
    label(ctx, line, rect.x + pad, y, { size: unit * 3.2, weight: 700, color: '#111318' });
    y += unit * 4.1;
  }

  // The address sits on the bottom edge; the quote gets whatever room is left above it.
  const address = source.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  label(ctx, address, rect.x + pad, bottom - unit * 1.2, { size: unit * 2, color: '#5f6368', maxWidth: inner });
  ctx.fillStyle = 'rgb(17 19 24 / 0.12)';
  ctx.fillRect(rect.x + pad, bottom - unit * 4, inner, unit * 0.15);

  const quote = source.quote.trim();
  if (!quote) return;
  y += unit * 2.4;
  const lineHeight = unit * 4.8;
  const room = Math.floor((bottom - unit * 5.5 - y) / lineHeight);
  if (room < 1) return;
  ctx.fillStyle = accent;
  ctx.font = `400 ${unit * 3.5}px ${FONT}`;
  const lines = wrapText(ctx, `“${quote}”`, inner - unit * 2, room);
  ctx.fillRect(rect.x + pad, y - lineHeight / 2, unit * 0.5, lines.length * lineHeight);
  lines.forEach((line, i) => {
    label(ctx, line, rect.x + pad + unit * 2, y + i * lineHeight, { size: unit * 3.5, weight: 400, color: '#111318' });
  });
}

/** Headline shot: the story fills the frame; the presenter is a small tile in the corner. */
function drawHeadlineCard(p: Painter, scene: Scene, frame: NewsFrame): void {
  const { ctx, size, unit } = p;
  const safe = newsSafeArea(size);
  const accent = scene.brand.color;
  const width = safe.width * 0.7;
  const tag = (scene.news.tag.trim() || 'HEADLINE').toUpperCase();

  // The tag bar breathes so the shot is never completely still.
  const pulse = 0.85 + 0.15 * Math.sin(frame.now / 600);
  ctx.save();
  ctx.globalAlpha *= pulse;
  ctx.font = `700 ${unit * 3.6}px ${FONT}`;
  const tagWidth = ctx.measureText(tag).width + unit * 5;
  fillRound(ctx, safe.x, safe.y + unit * 2, tagWidth, unit * 7, unit * 0.9, accent);
  ctx.restore();
  label(ctx, tag, safe.x + unit * 2.5, safe.y + unit * 5.7, { size: unit * 3.6, weight: 700, color: readableOn(accent) });

  const headline = frame.headline?.text || 'Add a headline in the Scenes panel';
  ctx.font = `700 ${unit * 8}px ${FONT}`;
  const lines = wrapText(ctx, headline, width, 4);
  lines.forEach((line, i) => {
    label(ctx, line, safe.x, safe.y + unit * 18 + i * unit * 9.6, { size: unit * 8, weight: 700, color: '#ffffff' });
  });

  const below = safe.y + unit * 18 + lines.length * unit * 9.6;
  ctx.fillStyle = accent;
  ctx.fillRect(safe.x, below - unit * 3, unit * 14, unit * 0.8);
  if (scene.news.subhead.trim()) {
    ctx.font = `400 ${unit * 3.6}px ${FONT}`;
    wrapText(ctx, scene.news.subhead, width, 2).forEach((line, i) => {
      label(ctx, line, safe.x, below + unit * 2.5 + i * unit * 4.8, { size: unit * 3.6, weight: 400, color: 'rgb(255 255 255 / 0.85)' });
    });
  }
}

/** Everything a news shot draws on top of the video. */
export function drawNews(p: Painter, scene: Scene, frame: NewsFrame): void {
  drawChannelBar(p, scene, frame.now);
  if (scene.news.view === 'headline') {
    drawHeadlineCard(p, scene, frame);
    // The headline is already the picture; the lower third would only repeat it.
    drawLowerThird(p, scene, { ...frame, headline: null });
    return;
  }
  if (scene.news.view === 'anchor' && !frame.sideOccupied) {
    // A source card takes the story panel's place while it is up.
    if (scene.news.source) drawSourceCard(p, scene);
    else drawStoryPanel(p, scene);
  }
  drawLowerThird(p, scene, frame);
}
