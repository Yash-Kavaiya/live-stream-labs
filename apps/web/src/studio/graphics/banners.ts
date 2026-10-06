import type { Banner } from '@studio/shared';
import { ellipsize, fillRound, FONT, label, readableOn, wrapText, type Painter } from './painter';

/** Where a banner drew, so the compositor can stack other overlays clear of it. */
export interface BannerBox {
  top: number;
  /** Height it takes from the bottom edge, already scaled by how far it has faded in. */
  used: number;
}

/** A full-width strip of scrolling text along the bottom edge. Slides up from below the frame. */
export function drawTicker(p: Painter, banner: Banner, alpha: number, color: string, now: number, inset: number): BannerBox {
  const { ctx, size, unit } = p;
  const fontSize = unit * 4;
  const height = fontSize * 1.9;
  const y = size.height - inset - height * alpha;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, y, size.width, height);
  ctx.beginPath();
  ctx.rect(0, y, size.width, height);
  ctx.clip();
  ctx.font = `500 ${fontSize}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = readableOn(color);
  // Repeat the text with a gap, moving right to left at a speed that is easy to read.
  const text = `${banner.text}     •     `;
  const textWidth = ctx.measureText(text).width;
  const offset = ((now / 1000) * unit * 14) % textWidth;
  for (let x = -offset; x < size.width; x += textWidth) ctx.fillText(text, x, y + height / 2);
  ctx.restore();
  return { top: y, used: height * alpha };
}

/** Shared entrance for the bottom-left banners: fade in while rising a little. */
function rise(p: Painter, alpha: number, height: number, inset: number): number {
  p.ctx.globalAlpha *= alpha;
  return p.size.height - height - p.unit * 6 - inset + (1 - alpha) * p.unit * 4;
}

/** One line in a rounded box, bottom left. The classic. */
export function drawLowerThird(p: Painter, banner: Banner, alpha: number, color: string, inset: number): BannerBox {
  const { ctx, size, unit } = p;
  const fontSize = unit * 4;
  const height = fontSize * 2.1;
  const padX = fontSize * 0.9;
  ctx.save();
  const y = rise(p, alpha, height, inset);
  ctx.font = `500 ${fontSize}px ${FONT}`;
  const text = ellipsize(ctx, banner.text, size.width * 0.8 - padX * 2);
  fillRound(ctx, unit * 4, y, ctx.measureText(text).width + padX * 2, height, unit * 1.6, color);
  label(ctx, text, unit * 4 + padX, y + height / 2 + fontSize * 0.04, { size: fontSize, color: readableOn(color) });
  ctx.restore();
  return { top: y, used: (height + unit * 4) * alpha };
}

/** Two lines: a name on the brand colour and a title on white beneath it. For introducing a guest. */
export function drawNameTitle(p: Painter, banner: Banner, alpha: number, color: string, inset: number): BannerBox {
  const { ctx, size, unit } = p;
  const nameSize = unit * 4.4;
  const titleSize = unit * 2.9;
  const padX = unit * 3;
  const nameH = nameSize * 1.9;
  const titleH = banner.subtitle ? titleSize * 2 : 0;
  const height = nameH + titleH;
  ctx.save();
  const y = rise(p, alpha, height, inset);
  const maxText = size.width * 0.7 - padX * 2;
  ctx.font = `700 ${nameSize}px ${FONT}`;
  const name = ellipsize(ctx, banner.text, maxText);
  const nameW = ctx.measureText(name).width;
  ctx.font = `500 ${titleSize}px ${FONT}`;
  const title = ellipsize(ctx, banner.subtitle, maxText);
  const width = Math.max(nameW, ctx.measureText(title).width) + padX * 2;
  const x = unit * 4;
  const r = unit * 1.2;

  // The box wipes open from the left as it fades in.
  ctx.beginPath();
  ctx.rect(x, y - unit, (width + unit) * Math.min(1, alpha * 1.2), height + unit * 2);
  ctx.clip();
  fillRound(ctx, x, y, width, nameH, titleH ? [r, r, 0, 0] : r, color);
  label(ctx, name, x + padX, y + nameH / 2 + unit * 0.2, { size: nameSize, weight: 700, color: readableOn(color) });
  if (titleH) {
    fillRound(ctx, x, y + nameH, width, titleH, [0, 0, r, r], '#ffffff');
    label(ctx, title, x + padX, y + nameH + titleH / 2 + unit * 0.1, { size: titleSize, color: '#1f1f1f' });
  }
  ctx.restore();
  return { top: y, used: (height + unit * 4) * alpha };
}

/** A handle with a round "@" mark, and the platform or a line of text under it. */
export function drawSocial(p: Painter, banner: Banner, alpha: number, color: string, inset: number): BannerBox {
  const { ctx, size, unit } = p;
  const height = unit * 10;
  const disc = height;
  const padX = unit * 2.6;
  ctx.save();
  const y = rise(p, alpha, height, inset);
  const handle = banner.text.startsWith('@') ? banner.text : `@${banner.text}`;
  const maxText = size.width * 0.6;
  ctx.font = `700 ${unit * 4}px ${FONT}`;
  const top = ellipsize(ctx, handle, maxText);
  const topW = ctx.measureText(top).width;
  ctx.font = `500 ${unit * 2.5}px ${FONT}`;
  const bottom = ellipsize(ctx, banner.subtitle, maxText);
  const width = disc * 0.6 + Math.max(topW, ctx.measureText(bottom).width) + padX * 2;
  const x = unit * 4;

  fillRound(ctx, x + disc * 0.4, y, width, height, [0, height / 2, height / 2, 0], 'rgb(255 255 255 / 0.96)');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + disc / 2, y + height / 2, disc / 2, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, '@', x + disc / 2, y + height / 2 + unit * 0.1, { size: unit * 5.4, weight: 700, color: readableOn(color), align: 'center' });
  const textX = x + disc + padX * 0.6;
  label(ctx, top, textX, bottom ? y + height * 0.36 : y + height / 2, { size: unit * 4, weight: 700, color: '#1f1f1f' });
  if (bottom) label(ctx, bottom, textX, y + height * 0.72, { size: unit * 2.5, color: '#444746' });
  ctx.restore();
  return { top: y, used: (height + unit * 4) * alpha };
}

/** Call to action, bottom right: a button-like pill with a dot that pulses and an arrow that nudges. */
export function drawCta(p: Painter, banner: Banner, alpha: number, color: string, now: number, inset: number): void {
  const { ctx, size, unit } = p;
  const fontSize = unit * 3.8;
  const height = fontSize * 2.3;
  const padX = fontSize * 1.1;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `700 ${fontSize}px ${FONT}`;
  const text = ellipsize(ctx, banner.text, size.width * 0.4);
  const textW = ctx.measureText(text).width;
  const arrowW = fontSize * 1.4;
  const dotW = fontSize * 1.1;
  const width = dotW + textW + arrowW + padX * 2;
  // Slides in from the right edge.
  const x = size.width - width - unit * 4 + (1 - alpha) * unit * 10;
  const y = size.height - height - unit * 6 - inset;
  const on = readableOn(color);

  fillRound(ctx, x, y, width, height, height / 2, color);
  const beat = 0.5 + 0.5 * Math.sin(now / 320);
  ctx.save();
  ctx.globalAlpha *= 0.25 * (1 - beat);
  ctx.fillStyle = on;
  ctx.beginPath();
  ctx.arc(x + padX + fontSize * 0.25, y + height / 2, fontSize * (0.35 + beat * 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = on;
  ctx.beginPath();
  ctx.arc(x + padX + fontSize * 0.25, y + height / 2, fontSize * 0.3, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, text, x + padX + dotW, y + height / 2 + fontSize * 0.05, { size: fontSize, weight: 700, color: on });
  label(ctx, '→', x + width - padX - fontSize * 0.2 + Math.sin(now / 320) * unit * 0.5, y + height / 2, {
    size: fontSize,
    weight: 700,
    color: on,
    align: 'right',
  });
  if (banner.subtitle) {
    label(ctx, banner.subtitle, x + width - unit, y - unit * 2.4, {
      size: unit * 2.5,
      color: '#ffffff',
      align: 'right',
      maxWidth: size.width * 0.5,
    });
  }
  ctx.restore();
}

/** A bar across the top of the frame, for the topic of the show. Slides down from above. */
export function drawHeadline(p: Painter, banner: Banner, alpha: number, color: string, topOffset: number): void {
  const { ctx, size, unit } = p;
  const height = banner.subtitle ? unit * 12 : unit * 8.6;
  const y = topOffset + unit * 3 - (1 - alpha) * (height + unit * 4);
  const x = unit * 4;
  const width = size.width - unit * 8;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha * 1.5);
  fillRound(ctx, x, y, width, height, unit * 1.4, 'rgb(12 14 20 / 0.9)');
  fillRound(ctx, x, y, unit * 1.2, height, [unit * 1.4, 0, 0, unit * 1.4], color);
  const textX = x + unit * 4;
  label(ctx, banner.text, textX, banner.subtitle ? y + unit * 4.3 : y + height / 2 + unit * 0.1, {
    size: unit * 4.2,
    weight: 700,
    color: '#ffffff',
    maxWidth: width - unit * 8,
  });
  if (banner.subtitle) {
    label(ctx, banner.subtitle, textX, y + unit * 8.8, { size: unit * 2.7, color: 'rgb(255 255 255 / 0.78)', maxWidth: width - unit * 8 });
  }
  ctx.restore();
}

/** A small label in the top-left corner: NEW, LIVE Q&A, EPISODE 12. It breathes slightly. */
export function drawBadge(p: Painter, banner: Banner, alpha: number, color: string, now: number, topOffset: number): void {
  const { ctx, unit } = p;
  const fontSize = unit * 3;
  const height = fontSize * 2.1;
  const padX = fontSize * 0.9;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `700 ${fontSize}px ${FONT}`;
  const text = ellipsize(ctx, banner.text.toUpperCase(), unit * 50);
  const width = ctx.measureText(text).width + padX * 2;
  const x = unit * 4;
  const y = topOffset + unit * 4;
  // Pop in from a little smaller, then breathe.
  const scale = (0.8 + 0.2 * alpha) * (1 + 0.025 * Math.sin(now / 500));
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(-0.035);
  ctx.scale(scale, scale);
  fillRound(ctx, -width / 2, -height / 2, width, height, unit * 0.9, color);
  label(ctx, text, 0, fontSize * 0.06, { size: fontSize, weight: 700, color: readableOn(color), align: 'center' });
  ctx.restore();
}

/** A title card in the middle of the frame over a dimmed picture: chapter titles, big announcements. */
export function drawTitleCard(p: Painter, banner: Banner, alpha: number, color: string): void {
  const { ctx, size, unit } = p;
  const cx = size.width / 2;
  const maxWidth = size.width * 0.74;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = 'rgb(6 8 12 / 0.62)';
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.font = `700 ${unit * 8.4}px ${FONT}`;
  const lines = wrapText(ctx, banner.text, maxWidth, 3);
  const lineH = unit * 10;
  const blockH = lines.length * lineH + (banner.subtitle ? unit * 8 : 0);
  let y = size.height / 2 - blockH / 2 + lineH / 2 + (1 - alpha) * unit * 3;

  // An accent rule grows out from the centre above the title.
  const rule = unit * 14 * alpha;
  ctx.fillStyle = color;
  ctx.fillRect(cx - rule / 2, y - lineH * 0.85, rule, unit * 0.9);
  for (const line of lines) {
    label(ctx, line, cx, y, { size: unit * 8.4, weight: 700, color: '#ffffff', align: 'center' });
    y += lineH;
  }
  if (banner.subtitle) {
    label(ctx, banner.subtitle, cx, y + unit * 1.4, { size: unit * 3.8, color: 'rgb(255 255 255 / 0.84)', align: 'center', maxWidth });
  }
  ctx.restore();
}
