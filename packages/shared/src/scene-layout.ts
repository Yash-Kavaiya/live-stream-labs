import { ASPECT, computeLayout, PROGRAM_SIZE, tile, type Size, type Tile } from './layout';
import type { NewsView, Scene } from './scene';

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

// ---------- Cricket ----------

/** Height of the score strip in the match view. */
export const CRICKET_STRIP = 17;
/** Share of the frame width the dashboard gives to cameras. */
const CRICKET_CAMERA_COLUMN = 0.27;

/** The area of the dashboard that holds the scorecard (everything left of the camera column). */
export function cricketDashboardArea(canvas: Size = PROGRAM_SIZE, hasCameras = true): Rect {
  const u = unit(canvas);
  const cameras = hasCameras ? canvas.width * CRICKET_CAMERA_COLUMN + 2 * u : 0;
  return { x: 3 * u, y: 3 * u, width: canvas.width - 6 * u - cameras, height: canvas.height - 6 * u };
}

export function computeCricketLayout(scene: Scene, ids: string[], canvas: Size = PROGRAM_SIZE): Tile[] {
  const u = unit(canvas);
  if (scene.cricket.view === 'match') {
    // The usual layout, in the space above the score strip.
    return computeLayout(scene.layout, ids, { width: canvas.width, height: canvas.height - CRICKET_STRIP * u });
  }
  if (ids.length === 0) return [];
  const width = canvas.width * CRICKET_CAMERA_COLUMN;
  const column = { x: canvas.width - width - 3 * u, y: 3 * u, width, height: canvas.height - 6 * u };
  return stackIn(column, ids, 2 * u, 1.4 * u);
}

/** Where every on-stage source goes, taking the template into account. */
export function computeSceneLayout(scene: Scene, ids: string[], canvas: Size = PROGRAM_SIZE): Tile[] {
  if (scene.template === 'newsroom') return computeNewsLayout(scene.news.view, ids, canvas);
  if (scene.template === 'cricket') return computeCricketLayout(scene, ids, canvas);
  return computeLayout(scene.layout, ids, canvas);
}
