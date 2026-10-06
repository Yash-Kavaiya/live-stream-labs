import { describe, expect, it } from 'vitest';
import { computeLayout, fitRect, PROGRAM_SIZE, type Tile } from './layout';
import { LAYOUT_IDS } from './scene';

const cams = (n: number) => Array.from({ length: n }, (_, i) => `cam:p${i}`);

function inside(t: Tile) {
  return (
    t.x >= 0 &&
    t.y >= 0 &&
    t.x + t.width <= PROGRAM_SIZE.width + 1 &&
    t.y + t.height <= PROGRAM_SIZE.height + 1
  );
}

function overlap(a: Tile, b: Tile) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('computeLayout', () => {
  it('returns nothing for an empty stage', () => {
    for (const layout of LAYOUT_IDS) expect(computeLayout(layout, [])).toEqual([]);
  });

  it.each(LAYOUT_IDS)('%s keeps every tile on the canvas for 1 to 10 sources', (layout) => {
    for (let n = 1; n <= 10; n++) {
      const tiles = computeLayout(layout, cams(n));
      expect(tiles.length).toBe(layout === 'solo' ? 1 : n);
      for (const t of tiles) {
        expect(inside(t), `${layout} n=${n} ${JSON.stringify(t)}`).toBe(true);
        expect(t.width).toBeGreaterThan(40);
        expect(t.height).toBeGreaterThan(20);
      }
    }
  });

  it.each(['grid', 'spotlight', 'screen', 'cinema'] as const)('%s tiles never overlap', (layout) => {
    for (let n = 2; n <= 10; n++) {
      const tiles = computeLayout(layout, cams(n));
      for (let i = 0; i < tiles.length; i++)
        for (let j = i + 1; j < tiles.length; j++)
          expect(overlap(tiles[i]!, tiles[j]!), `${layout} n=${n} ${i}/${j}`).toBe(false);
    }
  });

  it('solo fills the canvas with the first source', () => {
    expect(computeLayout('solo', cams(3))).toEqual([
      { id: 'cam:p0', x: 0, y: 0, width: 1280, height: 720, fit: 'cover', radius: 0 },
    ]);
  });

  it('grid tiles are 16:9 and equally sized', () => {
    const tiles = computeLayout('grid', cams(5));
    for (const t of tiles) {
      expect(t.width / t.height).toBeCloseTo(16 / 9, 1);
      expect(t.width).toBe(tiles[0]!.width);
    }
  });

  it('screen layout makes the screen share the main tile wherever it sits in the order', () => {
    const tiles = computeLayout('screen', ['cam:a', 'cam:b', 'screen:a']);
    expect(tiles[0]!.id).toBe('screen:a');
    expect(tiles[0]!.fit).toBe('contain');
    expect(tiles[0]!.width).toBeGreaterThan(tiles[1]!.width * 3);
  });

  it('pip draws the main source full-bleed underneath the small tiles', () => {
    const tiles = computeLayout('pip', ['cam:a', 'screen:b']);
    expect(tiles[0]).toMatchObject({ id: 'screen:b', x: 0, y: 0, width: 1280, height: 720 });
    expect(tiles[1]!.id).toBe('cam:a');
  });

  it('scales with the canvas size', () => {
    const small = computeLayout('grid', cams(4), { width: 640, height: 360 });
    const large = computeLayout('grid', cams(4), { width: 1920, height: 1080 });
    expect(large[0]!.width / small[0]!.width).toBeCloseTo(3, 1);
  });
});

describe('fitRect', () => {
  const dst = { x: 0, y: 0, width: 160, height: 90 };

  it('cover crops a 4:3 frame vertically', () => {
    const r = fitRect(640, 480, { ...dst, fit: 'cover' });
    expect(r.sw).toBe(640);
    expect(r.sh).toBeCloseTo(360);
    expect(r.sy).toBeCloseTo(60);
    expect([r.dw, r.dh]).toEqual([160, 90]);
  });

  it('contain letterboxes a tall frame', () => {
    const r = fitRect(90, 160, { ...dst, fit: 'contain' });
    expect(r.dh).toBe(90);
    expect(r.dw).toBeCloseTo(50.6, 1);
    expect(r.dx).toBeCloseTo((160 - r.dw) / 2);
  });
});
