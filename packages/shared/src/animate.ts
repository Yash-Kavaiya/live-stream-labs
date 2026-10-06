import type { Tile } from './layout';

export interface AnimatedTile extends Tile {
  /** 0 to 1. Tiles fade in when they join the stage and out when they leave. */
  opacity: number;
}

/** Time constant of the motion: a tile covers about 95% of the distance in three of these. */
const TAU_MS = 120;
const ENTER_SCALE = 0.88;
const GONE = 0.02;

type Rect = Pick<Tile, 'x' | 'y' | 'width' | 'height'>;

function scaled(rect: Rect, factor: number): Rect {
  const width = rect.width * factor;
  const height = rect.height * factor;
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}

/**
 * Turns layout jumps into motion. Feed it the target tiles every frame; it returns where each
 * tile should be drawn right now. Existing tiles glide to their new place, new ones grow and fade
 * in, removed ones shrink and fade out.
 *
 * Exponential smoothing rather than a fixed-length tween, so a change that arrives mid-move
 * (two guests joining a second apart) bends the motion instead of restarting it.
 */
export class TileAnimator {
  private readonly tiles = new Map<string, AnimatedTile & { leaving: Rect | null }>();

  step(targets: Tile[], dtMs: number): AnimatedTile[] {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / TAU_MS);
    const wanted = new Map(targets.map((t) => [t.id, t]));

    for (const target of targets) {
      const current = this.tiles.get(target.id);
      if (!current) {
        this.tiles.set(target.id, { ...target, ...scaled(target, ENTER_SCALE), opacity: 0, leaving: null });
        continue;
      }
      current.leaving = null;
      current.fit = target.fit;
      this.approach(current, target, target.radius, 1, k);
    }

    for (const [id, current] of this.tiles) {
      if (wanted.has(id)) continue;
      current.leaving ??= scaled(current, ENTER_SCALE);
      this.approach(current, current.leaving, current.radius, 0, k);
      if (current.opacity < GONE) this.tiles.delete(id);
    }

    // Leaving tiles are painted first so the ones staying slide over them.
    const order = (t: { id: string }) => (wanted.has(t.id) ? 1 + targets.findIndex((x) => x.id === t.id) : 0);
    return [...this.tiles.values()].sort((a, b) => order(a) - order(b)).map(({ leaving: _leaving, ...tile }) => tile);
  }

  private approach(tile: AnimatedTile, to: Rect, radius: number, opacity: number, k: number): void {
    tile.x += (to.x - tile.x) * k;
    tile.y += (to.y - tile.y) * k;
    tile.width += (to.width - tile.width) * k;
    tile.height += (to.height - tile.height) * k;
    tile.radius += (radius - tile.radius) * k;
    tile.opacity += (opacity - tile.opacity) * k;
  }
}

/** A 0-to-1 value that eases toward "on" or "off"; used to fade overlays in and out. */
export class Fade {
  private value = 0;

  constructor(private readonly durationMs = 280) {}

  step(on: boolean, dtMs: number): number {
    const delta = Math.max(0, dtMs) / this.durationMs;
    this.value = Math.min(1, Math.max(0, this.value + (on ? delta : -delta)));
    // Ease-out cubic: quick start, soft landing.
    return 1 - (1 - this.value) ** 3;
  }
}
