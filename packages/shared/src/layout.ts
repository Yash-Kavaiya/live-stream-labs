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

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** The geometry a host can tune. Lengths are in hundredths of the frame height. */
export interface LayoutOptions {
  /** Space between tiles. */
  gap: number;
  /** Corner rounding of tiles. */
  radius: number;
  /** Margin between the tiles and the edge of the frame. */
  padding: number;
  /** Share of the width the main tile takes in layouts that have one (0.5 to 0.85). */
  mainShare: number;
  /** Put the side column on the left instead of the right. */
  sideLeft: boolean;
  /** Where the small tiles sit in picture-in-picture. */
  pipCorner: Corner;
  /** Width of a picture-in-picture tile as a share of the frame width. */
  pipSize: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  gap: 2.2,
  radius: 2.2,
  padding: 2.2,
  mainShare: 0.78,
  sideLeft: false,
  pipCorner: 'br',
  pipSize: 0.2,
};

export const PROGRAM_SIZE: Size = { width: 1280, height: 720 };

export const ASPECT = 16 / 9;

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

function fitFor(id: string): Tile['fit'] {
  const { kind } = parseSourceId(id);
  return kind === 'cam' ? 'cover' : 'contain';
}

export function tile(id: string, x: number, y: number, width: number, height: number, radius: number): Tile {
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

/** Equal 16:9 cells, as large as fit, centred in the area. The last row is centred too. */
function grid(ids: string[], area: Area, gap: number, radius: number): Tile[] {
  const n = ids.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = Math.min((area.width - gap * (cols - 1)) / cols, ((area.height - gap * (rows - 1)) / rows) * ASPECT);
  const h = w / ASPECT;
  const top = area.y + (area.height - (rows * h + (rows - 1) * gap)) / 2;

  return ids.map((id, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const left = area.x + (area.width - (inRow * w + (inRow - 1) * gap)) / 2;
    return tile(id, left + (i - row * cols) * (w + gap), top + row * (h + gap), w, h, radius);
  });
}

interface SideOptions {
  gap: number;
  radius: number;
  share: number;
  sideLeft: boolean;
  /** True: every tile fills its slot edge to edge. False: tiles keep 16:9 and are centred. */
  fill: boolean;
}

/** One main tile and the rest in a column beside it. */
function mainWithSidebar(main: string, rest: string[], area: Area, o: SideOptions): Tile[] {
  if (rest.length === 0) return [tile(main, area.x, area.y, area.width, area.height, o.radius)];

  const mainW = (area.width - o.gap) * o.share;
  const sideW = area.width - o.gap - mainW;
  const mainX = o.sideLeft ? area.x + sideW + o.gap : area.x;
  const sideX = o.sideLeft ? area.x : area.x + mainW + o.gap;
  const mainH = o.fill ? area.height : Math.min(area.height, mainW / ASPECT);
  const tiles = [tile(main, mainX, area.y + (area.height - mainH) / 2, mainW, mainH, o.radius)];

  const slotH = (area.height - o.gap * (rest.length - 1)) / rest.length;
  const sideH = o.fill ? slotH : Math.min(sideW / ASPECT, slotH);
  const top = area.y + (area.height - (rest.length * sideH + (rest.length - 1) * o.gap)) / 2;
  rest.forEach((id, i) => tiles.push(tile(id, sideX, top + i * (sideH + o.gap), sideW, sideH, o.radius)));
  return tiles;
}

/** A 3-column grid whose first tile is double size, so one person or screen leads without a sidebar. */
function mosaic(ids: string[], area: Area, gap: number, radius: number): Tile[] {
  if (ids.length === 1) return [tile(ids[0]!, area.x, area.y, area.width, area.height, radius)];
  const cols = 3;
  // The big tile takes a 2x2 block; the others fill the cells around and below it.
  const rows = Math.max(2, 2 + Math.ceil((ids.length - 3) / cols));
  const w = Math.min((area.width - gap * (cols - 1)) / cols, ((area.height - gap * (rows - 1)) / rows) * ASPECT);
  const h = w / ASPECT;
  const left = area.x + (area.width - (cols * w + (cols - 1) * gap)) / 2;
  const top = area.y + (area.height - (rows * h + (rows - 1) * gap)) / 2;
  const cell = (col: number, row: number) => ({ x: left + col * (w + gap), y: top + row * (h + gap) });

  const tiles = [tile(ids[0]!, left, top, 2 * w + gap, 2 * h + gap, radius)];
  ids.slice(1).forEach((id, i) => {
    const at = i < 2 ? cell(2, i) : cell((i - 2) % cols, 2 + Math.floor((i - 2) / cols));
    tiles.push(tile(id, at.x, at.y, w, h, radius));
  });
  return tiles;
}

/**
 * Maps the ordered stage sources to rectangles on the program canvas.
 * Pure and deterministic: the studio preview, guests and the server-side renderer all call it.
 * Tiles are returned in paint order (later tiles draw on top).
 */
export function computeLayout(
  layout: LayoutId,
  ids: string[],
  canvas: Size = PROGRAM_SIZE,
  options: Partial<LayoutOptions> = {},
): Tile[] {
  if (ids.length === 0) return [];
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const unit = canvas.height / 100;
  const gap = Math.round(o.gap * unit);
  const radius = Math.round(o.radius * unit);
  const pad = Math.round(o.padding * unit);
  const area: Area = { x: pad, y: pad, width: canvas.width - 2 * pad, height: canvas.height - 2 * pad };
  const side = { gap, radius, share: o.mainShare, sideLeft: o.sideLeft };
  const full = (id: string) => tile(id, 0, 0, canvas.width, canvas.height, 0);
  const n = ids.length;

  switch (layout) {
    case 'solo':
      return [full(ids[0]!)];

    case 'grid':
      return grid(ids, area, gap, radius);

    case 'split': {
      // Side by side, full height: the classic two-person conversation.
      const w = (area.width - gap * (n - 1)) / n;
      return ids.map((id, i) => tile(id, area.x + i * (w + gap), area.y, w, area.height, radius));
    }

    case 'stack': {
      // One above the other, full width.
      const h = (area.height - gap * (n - 1)) / n;
      return ids.map((id, i) => tile(id, area.x, area.y + i * (h + gap), area.width, h, radius));
    }

    case 'duo': {
      // Host large, guests in a full-height column: an interview where one side leads.
      const [main, ...rest] = ids;
      return mainWithSidebar(main!, rest, area, { ...side, fill: true });
    }

    case 'mosaic':
      return mosaic(ids, area, gap, radius);

    case 'spotlight': {
      const [main, ...rest] = ids;
      return mainWithSidebar(main!, rest, area, { ...side, fill: false });
    }

    case 'screen': {
      const main = pickMain(ids);
      return mainWithSidebar(main, ids.filter((id) => id !== main), area, { ...side, fill: false });
    }

    case 'pip': {
      const main = pickMain(ids);
      const rest = ids.filter((id) => id !== main);
      const edge = Math.max(pad, gap);
      // Shrink the small tiles when there are too many to fit along the edge.
      const w = Math.min(canvas.width * o.pipSize, (canvas.width - 2 * edge - gap * (rest.length - 1)) / Math.max(1, rest.length));
      const h = w / ASPECT;
      const y = o.pipCorner[0] === 't' ? edge : canvas.height - edge - h;
      const tiles = [full(main)];
      rest.forEach((id, i) => {
        const offset = edge + i * (w + gap);
        tiles.push(tile(id, o.pipCorner[1] === 'l' ? offset : canvas.width - offset - w, y, w, h, radius));
      });
      return tiles;
    }

    case 'cinema': {
      const [main, ...rest] = ids;
      if (rest.length === 0) return [full(main!)];
      const w = Math.min(area.height * 0.2 * ASPECT, (area.width - gap * (rest.length - 1)) / rest.length);
      const h = w / ASPECT;
      const mainH = area.height - h - gap;
      const mainW = Math.min(area.width, mainH * ASPECT);
      const tiles = [tile(main!, area.x + (area.width - mainW) / 2, area.y, mainW, mainH, radius)];
      const left = area.x + (area.width - (rest.length * w + (rest.length - 1) * gap)) / 2;
      rest.forEach((id, i) => tiles.push(tile(id, left + i * (w + gap), area.y + mainH + gap, w, h, radius)));
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
