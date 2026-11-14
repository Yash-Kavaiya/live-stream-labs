import { SOCIALS, type SocialLink } from '@studio/shared';
import { encode } from 'uqr';
import { ellipsize, FONT, fillRound, label, readableOn, type Painter } from './painter';

/**
 * Social links along the bottom of a holding screen. With QR codes each link is a card (code,
 * platform, handle) that viewers can scan from their phone; without, a row of compact chips.
 */

/** QR codes drawn once per link onto their own canvas, then scaled onto the frame each frame. */
const qrCache = new Map<string, HTMLCanvasElement>();

function qrCanvas(url: string): HTMLCanvasElement {
  let canvas = qrCache.get(url);
  if (canvas) return canvas;
  const { data, size } = encode(url, { border: 2, ecc: 'M' });
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  data.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(x, y, 1, 1)));
  // Links typed while the host edits would otherwise pile up.
  if (qrCache.size > 40) qrCache.delete(qrCache.keys().next().value!);
  qrCache.set(url, canvas);
  return canvas;
}

/** The round platform badge with its short mark. */
function drawMark({ ctx, unit }: Painter, link: SocialLink, cx: number, cy: number, radius: number): void {
  const info = SOCIALS[link.id];
  ctx.fillStyle = info.color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgb(255 255 255 / 0.5)';
  ctx.lineWidth = unit * 0.15;
  ctx.stroke();
  const size = radius * (info.mark.length > 2 ? 0.75 : info.mark.length > 1 ? 0.95 : 1.15);
  label(ctx, info.mark, cx, cy + unit * 0.1, { size, weight: 700, color: readableOn(info.color), align: 'center' });
}

/** Draws the links centred across the frame, starting at `top`. */
export function drawSocialRow(p: Painter, links: SocialLink[], withQr: boolean, top: number): void {
  if (links.length === 0) return;
  const { ctx, unit, size } = p;
  const margin = unit * 6;
  const gap = unit * 2.4;
  const available = size.width - margin * 2;

  if (withQr) {
    // Cards shrink to fit when there are many links, down to a code that still scans on a phone.
    const width = Math.min(unit * 25, (available - gap * (links.length - 1)) / links.length);
    const pad = unit * 1.6;
    const code = width - pad * 2;
    const height = pad + code + unit * 8.6;
    let x = (size.width - (width * links.length + gap * (links.length - 1))) / 2;
    for (const link of links) {
      const info = SOCIALS[link.id];
      fillRound(ctx, x, top, width, height, unit * 1.6, 'rgb(255 255 255 / 0.96)');
      const previous = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qrCanvas(link.url), x + pad, top + pad, code, code);
      ctx.imageSmoothingEnabled = previous;
      const markRadius = unit * 1.5;
      const nameY = top + pad + code + unit * 2.8;
      drawMark(p, link, x + pad + markRadius, nameY, markRadius);
      label(ctx, info.name, x + pad + markRadius * 2 + unit * 1, nameY, {
        size: unit * 2.3,
        weight: 700,
        color: '#1f1f1f',
        maxWidth: width - pad * 2 - markRadius * 2 - unit,
      });
      label(ctx, link.label, x + width / 2, nameY + unit * 3.6, {
        size: unit * 2.2,
        weight: 500,
        color: '#444746',
        align: 'center',
        maxWidth: width - pad * 2,
      });
      x += width + gap;
    }
    return;
  }

  // Chips: badge and handle, wrapped onto a second line when they do not fit on one.
  const height = unit * 6;
  const textSize = unit * 2.8;
  const radius = unit * 2.1;
  ctx.font = `500 ${textSize}px ${FONT}`;
  const maxText = unit * 30;
  const chips = links.map((link) => {
    const text = ctx.measureText(ellipsize(ctx, link.label, maxText)).width;
    return { link, width: unit * 1.2 + radius * 2 + unit * 1.4 + text + unit * 2.2 };
  });
  const rows: (typeof chips)[] = [[]];
  let rowWidth = 0;
  for (const chip of chips) {
    if (rowWidth + chip.width > available && rows.at(-1)!.length) {
      rows.push([]);
      rowWidth = 0;
    }
    rows.at(-1)!.push(chip);
    rowWidth += chip.width + gap;
  }
  rows.forEach((row, r) => {
    const total = row.reduce((sum, c) => sum + c.width, 0) + gap * (row.length - 1);
    let x = (size.width - total) / 2;
    const y = top + r * (height + gap);
    for (const { link, width } of row) {
      fillRound(ctx, x, y, width, height, height / 2, 'rgb(255 255 255 / 0.12)');
      drawMark(p, link, x + unit * 1.2 + radius, y + height / 2, radius);
      label(ctx, link.label, x + unit * 1.2 + radius * 2 + unit * 1.4, y + height / 2 + unit * 0.1, {
        size: textSize,
        color: '#ffffff',
        maxWidth: maxText,
      });
      x += width + gap;
    }
  });
}
