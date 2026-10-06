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

  it.each(['grid', 'split', 'stack', 'duo', 'mosaic', 'spotlight', 'screen', 'cinema'] as const)('%s tiles never overlap', (layout) => {
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

describe('two-person and custom layouts', () => {
  it('split puts two people side by side at full height', () => {
    const [a, b] = computeLayout('split', cams(2));
    expect(a!.y).toBe(b!.y);
    expect(a!.width).toBe(b!.width);
    expect(a!.height).toBeGreaterThan(PROGRAM_SIZE.height * 0.9);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
  });

  it('stack puts them one above the other at full width', () => {
    const [a, b] = computeLayout('stack', cams(2));
    expect(a!.x).toBe(b!.x);
    expect(a!.width).toBeGreaterThan(PROGRAM_SIZE.width * 0.9);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  });

  it('duo gives the first person the big full-height tile', () => {
    const [lead, guest] = computeLayout('duo', cams(2));
    expect(lead!.width).toBeGreaterThan(guest!.width * 3);
    expect(lead!.height).toBe(guest!.height);
  });

  it('mosaic makes the first tile twice the size of the others', () => {
    const tiles = computeLayout('mosaic', cams(6));
    expect(tiles[0]!.width).toBeGreaterThan(tiles[1]!.width * 2 - 1);
    for (const t of tiles.slice(1)) expect(t.width).toBe(tiles[1]!.width);
  });

  it('honours spacing, margin and corner options', () => {
    const tight = computeLayout('split', cams(2), PROGRAM_SIZE, { gap: 0, padding: 0, radius: 0 });
    expect(tight[0]).toMatchObject({ x: 0, y: 0, width: 640, height: 720, radius: 0 });
    expect(tight[1]!.x).toBe(640);

    const roomy = computeLayout('split', cams(2), PROGRAM_SIZE, { gap: 6, padding: 10, radius: 8 });
    expect(roomy[0]!.x).toBe(72);
    expect(roomy[1]!.x - (roomy[0]!.x + roomy[0]!.width)).toBeCloseTo(43, 0);
    expect(roomy[0]!.radius).toBe(58);
  });

  it('moves the sidebar and resizes the main tile', () => {
    const right = computeLayout('spotlight', cams(3));
    const left = computeLayout('spotlight', cams(3), PROGRAM_SIZE, { sideLeft: true });
    expect(right[1]!.x).toBeGreaterThan(right[0]!.x);
    expect(left[1]!.x).toBeLessThan(left[0]!.x);

    const half = computeLayout('duo', cams(2), PROGRAM_SIZE, { mainShare: 0.5 });
    expect(half[0]!.width).toBeCloseTo(half[1]!.width, 0);
  });

  it('places picture-in-picture tiles in the chosen corner at the chosen size', () => {
    const topLeft = computeLayout('pip', ['screen:a', 'cam:a'], PROGRAM_SIZE, { pipCorner: 'tl', pipSize: 0.3 })[1]!;
    expect(topLeft.x).toBeLessThan(40);
    expect(topLeft.y).toBeLessThan(40);
    expect(topLeft.width).toBe(384);

    const bottomRight = computeLayout('pip', ['screen:a', 'cam:a'])[1]!;
    expect(bottomRight.x + bottomRight.width).toBeGreaterThan(1240);
    expect(bottomRight.y + bottomRight.height).toBeGreaterThan(680);
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
