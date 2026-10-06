import type { LayoutId } from './scene';
import { parseSourceId } from './scene';

export interface Size {
  width: number;
  height: number;
}

export interface Tile {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** cover crops to fill (cameras); contain letterboxes (screens, images). */
  fit: 'cover' | 'contain';
  /** Corner radius in canvas pixels. */
  radius: number;
}

export const PROGRAM_SIZE: Size = { width: 1280, height: 720 };

const ASPECT = 16 / 9;

function fitFor(id: string): Tile['fit'] {
  const { kind } = parseSourceId(id);
  return kind === 'cam' ? 'cover' : 'contain';
}

function tile(id: string, x: number, y: number, width: number, height: number, radius: number): Tile {
  return {
    id,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    fit: fitFor(id),
    radius,
  };
}

/** The first screen share, clip or image if there is one, otherwise the first source. */
function pickMain(ids: string[]): string {
  return ids.find((id) => parseSourceId(id).kind !== 'cam') ?? ids[0]!;
}

function grid(ids: string[], canvas: Size, gap: number, radius: number): Tile[] {
  const n = ids.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  // Largest 16:9 cell that fits both ways.
  const maxW = (canvas.width - gap * (cols + 1)) / cols;
  const maxH = (canvas.height - gap * (rows + 1)) / rows;
  const w = Math.min(maxW, maxH * ASPECT);
  const h = w / ASPECT;
  const blockH = rows * h + (rows - 1) * gap;
  const top = (canvas.height - blockH) / 2;

  return ids.map((id, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const rowW = inRow * w + (inRow - 1) * gap;
    const left = (canvas.width - rowW) / 2;
    const col = i - row * cols;
    return tile(id, left + col * (w + gap), top + row * (h + gap), w, h, radius);
  });
}

/** One large tile on the left and the rest stacked in a column on the right. */
function mainWithSidebar(main: string, rest: string[], canvas: Size, gap: number, radius: number) {
  if (rest.length === 0) {
    return [tile(main, gap, gap, canvas.width - 2 * gap, canvas.height - 2 * gap, radius)];
  }
  const sideW = canvas.width * 0.2;
  const mainW = canvas.width - sideW - 3 * gap;
  const mainH = Math.min(canvas.height - 2 * gap, mainW / ASPECT);
  const tiles = [tile(main, gap, (canvas.height - mainH) / 2, mainW, mainH, radius)];

  const sideH = Math.min(sideW / ASPECT, (canvas.height - gap * (rest.length + 1)) / rest.length);
  const blockH = rest.length * sideH + (rest.length - 1) * gap;
  const top = (canvas.height - blockH) / 2;
  rest.forEach((id, i) => {
    tiles.push(tile(id, mainW + 2 * gap, top + i * (sideH + gap), sideW, sideH, radius));
  });
  return tiles;
}

/**
 * Maps the ordered stage sources to rectangles on the program canvas.
 * Pure and deterministic: the studio preview, guests and the server-side renderer all call it.
 * Tiles are returned in paint order (later tiles draw on top).
 */
export function computeLayout(layout: LayoutId, ids: string[], canvas: Size = PROGRAM_SIZE): Tile[] {
  if (ids.length === 0) return [];
  const gap = Math.round(canvas.height * 0.022);
  const radius = Math.round(canvas.height * 0.022);
  const full = (id: string) => tile(id, 0, 0, canvas.width, canvas.height, 0);

  switch (layout) {
    case 'solo':
      return [full(ids[0]!)];

    case 'grid':
      return grid(ids, canvas, gap, radius);

    case 'spotlight': {
      const [main, ...rest] = ids;
      return mainWithSidebar(main!, rest, canvas, gap, radius);
    }

    case 'screen': {
      const main = pickMain(ids);
      return mainWithSidebar(main, ids.filter((id) => id !== main), canvas, gap, radius);
    }

    case 'pip': {
      const main = pickMain(ids);
      const rest = ids.filter((id) => id !== main);
      // Shrink the small tiles when there are too many to fit along the bottom edge.
      const fitW = (canvas.width - gap * (rest.length + 1)) / Math.max(1, rest.length);
      const w = Math.min(canvas.width * 0.2, fitW);
      const h = w / ASPECT;
      const tiles = [full(main)];
      rest.forEach((id, i) => {
        const x = canvas.width - gap - (i + 1) * w - i * gap;
        tiles.push(tile(id, x, canvas.height - gap - h, w, h, radius));
      });
      return tiles;
    }

    case 'cinema': {
      const [main, ...rest] = ids;
      if (rest.length === 0) return [full(main!)];
      const stripH = canvas.height * 0.2;
      const w = Math.min(stripH * ASPECT, (canvas.width - gap * (rest.length + 1)) / rest.length);
      const h = w / ASPECT;
      const mainH = canvas.height - h - 3 * gap;
      const mainW = mainH * ASPECT;
      const tiles = [tile(main!, (canvas.width - mainW) / 2, gap, mainW, mainH, radius)];
      const rowW = rest.length * w + (rest.length - 1) * gap;
      const left = (canvas.width - rowW) / 2;
      rest.forEach((id, i) => {
        tiles.push(tile(id, left + i * (w + gap), mainH + 2 * gap, w, h, radius));
      });
      return tiles;
    }
  }
}

/** Source rectangle to draw from a `srcW x srcH` frame so it fills or fits the tile. */
export function fitRect(
  srcW: number,
  srcH: number,
  dst: Pick<Tile, 'x' | 'y' | 'width' | 'height' | 'fit'>,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const srcAspect = srcW / srcH;
  const dstAspect = dst.width / dst.height;
  if (dst.fit === 'cover') {
    const sw = srcAspect > dstAspect ? srcH * dstAspect : srcW;
    const sh = srcAspect > dstAspect ? srcH : srcW / dstAspect;
    return {
      sx: (srcW - sw) / 2,
      sy: (srcH - sh) / 2,
      sw,
      sh,
      dx: dst.x,
      dy: dst.y,
      dw: dst.width,
      dh: dst.height,
    };
  }
  const dw = srcAspect > dstAspect ? dst.width : dst.height * srcAspect;
  const dh = srcAspect > dstAspect ? dst.width / srcAspect : dst.height;
  return {
    sx: 0,
    sy: 0,
    sw: srcW,
    sh: srcH,
    dx: dst.x + (dst.width - dw) / 2,
    dy: dst.y + (dst.height - dh) / 2,
    dw,
    dh,
  };
}
