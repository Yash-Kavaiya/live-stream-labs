import { ASPECT, computeLayout, PROGRAM_SIZE, tile, type Size, type Tile } from './layout';
import type { ClassView, NewsView, Scene } from './scene';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Template graphics are measured in hundredths of the frame height, like the compositor does. */
const unit = (canvas: Size) => canvas.height / 100;

// ---------- News room ----------

/** Height kept free at the top for the channel bar and at the bottom for headline, subhead and ticker. */
const NEWS_TOP = 12;
const NEWS_BOTTOM = 28;

/** The part of the frame that video may use in a news shot. */
export function newsSafeArea(canvas: Size = PROGRAM_SIZE): Rect {
  const u = unit(canvas);
  return {
    x: 4 * u,
    y: NEWS_TOP * u,
    width: canvas.width - 8 * u,
    height: canvas.height - (NEWS_TOP + NEWS_BOTTOM) * u,
  };
}

/** Where the anchor shot puts its side column: other sources if there are any, else the story panel. */
export function newsSidePanel(canvas: Size = PROGRAM_SIZE): Rect {
  const safe = newsSafeArea(canvas);
  const gap = 2 * unit(canvas);
  const mainWidth = safe.width * 0.62;
  return { x: safe.x + mainWidth + gap, y: safe.y, width: safe.width - mainWidth - gap, height: safe.height };
}

function stackIn(rect: Rect, ids: string[], gap: number, radius: number): Tile[] {
  const height = Math.min(rect.width / ASPECT, (rect.height - gap * (ids.length - 1)) / ids.length);
  const block = ids.length * height + (ids.length - 1) * gap;
  const top = rect.y + (rect.height - block) / 2;
  return ids.map((id, i) => tile(id, rect.x, top + i * (height + gap), rect.width, height, radius));
}

export function computeNewsLayout(view: NewsView, ids: string[], canvas: Size = PROGRAM_SIZE): Tile[] {
  if (ids.length === 0) return [];
  const u = unit(canvas);
  const gap = 2 * u;
  const radius = 1.4 * u;
  const safe = newsSafeArea(canvas);

  switch (view) {
    case 'anchor': {
      const [anchor, ...rest] = ids;
      const width = safe.width * 0.62;
      const height = Math.min(safe.height, width / ASPECT);
      const main = tile(anchor!, safe.x, safe.y + (safe.height - height) / 2, width, height, radius);
      return rest.length ? [main, ...stackIn(newsSidePanel(canvas), rest, gap, radius)] : [main];
    }

    case 'interview': {
      // Equal boxes in one row. Two guests get taller, closer crops, as on a news double-box.
      const n = ids.length;
      const width = (safe.width - gap * (n - 1)) / n;
      const height = Math.min(safe.height, width / (n <= 2 ? 1.3 : ASPECT));
      const top = safe.y + (safe.height - height) / 2;
      return ids.map((id, i) => ({
        ...tile(id, safe.x + i * (width + gap), top, width, height, radius),
        fit: 'cover' as const,
      }));
    }

    case 'panel':
      return computeLayout('grid', ids, { width: safe.width, height: safe.height }).map((t) => ({
        ...t,
        x: t.x + Math.round(safe.x),
        y: t.y + Math.round(safe.y),
        radius,
      }));

    case 'headline': {
      // The headline graphic owns the frame; the presenter sits in the top-right corner.
      const width = canvas.width * 0.24;
      return [tile(ids[0]!, safe.x + safe.width - width, safe.y, width, width / ASPECT, radius)];
    }
  }
}

// ---------- Classroom ----------

/** Height kept free at the top for the lesson header and at the bottom for the lesson plan strip. */
export const CLASS_TOP = 11;
export const CLASS_BOTTOM = 9;
/** Share of the safe width that the side column takes. */
const CLASS_COLUMN = 0.27;

/** The part of the frame that video and panels may use in a classroom scene. */
export function classSafeArea(canvas: Size = PROGRAM_SIZE): Rect {
  const u = unit(canvas);
  return { x: 3 * u, y: CLASS_TOP * u, width: canvas.width - 6 * u, height: canvas.height - (CLASS_TOP + CLASS_BOTTOM) * u };
}

/** The column down the right: cameras beside the slides, the board and the quiz; the plan in a lecture. */
export function classSideColumn(canvas: Size = PROGRAM_SIZE): Rect {
  const safe = classSafeArea(canvas);
  const width = safe.width * CLASS_COLUMN;
  return { x: safe.x + safe.width - width, y: safe.y, width, height: safe.height };
}

/** The big area left of the side column, or the whole safe area when no column is needed. */
export function classMainArea(canvas: Size = PROGRAM_SIZE, withColumn = true): Rect {
  const safe = classSafeArea(canvas);
  if (!withColumn) return safe;
  return { ...safe, width: classSideColumn(canvas).x - 2 * unit(canvas) - safe.x };
}

/** The largest 16:9 tile that fits in `rect`, centred. */
function fitIn(id: string, rect: Rect, radius: number): Tile {
  const width = Math.min(rect.width, rect.height * ASPECT);
  const height = width / ASPECT;
  return tile(id, rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height, radius);
}

/** `hasDeck`: a slide deck is loaded, so in the slides view the deck, not a source, takes the big slot. */
export function computeClassLayout(view: ClassView, ids: string[], canvas: Size = PROGRAM_SIZE, hasDeck = false): Tile[] {
  if (ids.length === 0) return [];
  const u = unit(canvas);
  const gap = 2 * u;
  const radius = 1.4 * u;
  const column = classSideColumn(canvas);

  switch (view) {
    case 'lecture': {
      const [teacher, ...rest] = ids;
      const main = fitIn(teacher!, classMainArea(canvas), radius);
      return rest.length ? [main, ...stackIn(column, rest, gap, radius)] : [main];
    }
    case 'slides': {
      if (hasDeck) return stackIn(column, ids, gap, radius);
      // Shared content takes the big slot wherever it is on stage; cameras go to the column.
      const main = ids.find((id) => !id.startsWith('cam:')) ?? ids[0]!;
      const rest = ids.filter((id) => id !== main);
      const big = fitIn(main, classMainArea(canvas, rest.length > 0), radius);
      return rest.length ? [big, ...stackIn(column, rest, gap, radius)] : [big];
    }
    case 'board':
    case 'quiz':
      // The board or the quiz owns the main area.
      return stackIn(column, ids, gap, radius);
  }
}

/** Where every on-stage source goes, taking the template into account. */
export function computeSceneLayout(scene: Scene, ids: string[], canvas: Size = PROGRAM_SIZE): Tile[] {
  if (scene.template === 'newsroom') return computeNewsLayout(scene.news.view, ids, canvas);
  if (scene.template === 'classroom') return computeClassLayout(scene.classroom.view, ids, canvas, scene.classroom.slides.length > 0);
  return computeLayout(scene.layout, ids, canvas, scene.style);
}
