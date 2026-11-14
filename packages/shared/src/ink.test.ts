import { describe, expect, it } from 'vitest';
import {
  decodePoints,
  encodePoints,
  hitsStroke,
  INK_BUDGET,
  inkFits,
  inkSize,
  makeStroke,
  simplifyPoints,
  type InkStroke,
} from './ink';
import { computeClassLayout } from './scene-layout';
import { DEFAULT_CLASSROOM, DEFAULT_SCENE, sceneSchema, visibleInkKey } from './scene';

describe('ink points', () => {
  it('round-trips points to within one step of 4096', () => {
    const points = [0, 0, 1, 1, 0.25, 0.75, 0.123456, 0.987654];
    const back = decodePoints(encodePoints(points));
    back.forEach((v, i) => expect(Math.abs(v - points[i]!)).toBeLessThan(1 / 4000));
    expect(encodePoints(points)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('clamps points that fall off the surface', () => {
    expect(decodePoints(encodePoints([-0.5, 1.5]))).toEqual([0, 1]);
  });

  it('simplifies a straight freehand line to its two ends', () => {
    const line = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5]).flat();
    expect(simplifyPoints(line, 0.001)).toEqual([0, 0.5, 1, 0.5]);
  });

  it('keeps the corner of an L', () => {
    const l = [...Array.from({ length: 20 }, (_, i) => [0.1, 0.1 + i * 0.02]).flat(), ...Array.from({ length: 20 }, (_, i) => [0.1 + (i + 1) * 0.02, 0.48]).flat()];
    const kept = simplifyPoints(l, 0.001);
    expect(kept.length).toBe(6);
    expect(kept.slice(2, 4)).toEqual([0.1, expect.closeTo(0.48, 5)]);
  });

  it('keeps only the two ends of a shape', () => {
    const rect = makeStroke('rect', '#ff0000', 4, [0.1, 0.1, 0.2, 0.2, 0.5, 0.5]);
    expect(decodePoints(rect.p)).toHaveLength(4);
  });
});

describe('ink budget', () => {
  it('stops accepting strokes once the page is full', () => {
    const big: InkStroke = { t: 'pen', c: '#000000', w: 3, p: 'A'.repeat(4000) };
    const strokes = Array.from({ length: Math.floor(INK_BUDGET / inkSize([big])) }, () => big);
    expect(inkFits(strokes.slice(0, -1), big)).toBe(true);
    expect(inkFits(strokes, big)).toBe(false);
  });
});

describe('eraser hits', () => {
  const pen = makeStroke('pen', '#000000', 4, [0.1, 0.5, 0.9, 0.5]);
  it('hits a line near it and misses one far away', () => {
    expect(hitsStroke(pen, 0.5, 0.51, 0.01)).toBe(true);
    expect(hitsStroke(pen, 0.5, 0.7, 0.01)).toBe(false);
  });
  it('hits the outline of a rectangle, not its empty middle', () => {
    const rect = makeStroke('rect', '#000000', 4, [0.2, 0.2, 0.8, 0.8]);
    expect(hitsStroke(rect, 0.2, 0.5, 0.01)).toBe(true);
    expect(hitsStroke(rect, 0.5, 0.5, 0.01)).toBe(false);
  });
  it('hits the ring of an ellipse', () => {
    const ellipse = makeStroke('ellipse', '#000000', 4, [0.2, 0.2, 0.8, 0.8]);
    expect(hitsStroke(ellipse, 0.8, 0.5, 0.01)).toBe(true);
    expect(hitsStroke(ellipse, 0.5, 0.5, 0.01)).toBe(false);
  });
  it('hits inside a text box', () => {
    const text = makeStroke('text', '#000000', 30, [0.1, 0.1], 'Newton');
    expect(hitsStroke(text, 0.15, 0.12, 0.005)).toBe(true);
    expect(hitsStroke(text, 0.6, 0.6, 0.005)).toBe(false);
  });
});

describe('classroom surfaces', () => {
  it('names the surface on screen', () => {
    expect(visibleInkKey({ ...DEFAULT_CLASSROOM, view: 'board', boardPage: 2 })).toBe('board:2');
    expect(visibleInkKey({ ...DEFAULT_CLASSROOM, view: 'slides' })).toBeNull();
    expect(visibleInkKey({ ...DEFAULT_CLASSROOM, view: 'slides', slides: ['/assets/a.jpg', '/assets/b.jpg'], slide: 1 })).toBe('slide:1');
    expect(visibleInkKey({ ...DEFAULT_CLASSROOM, view: 'quiz' })).toBeNull();
  });

  it('reads a classroom saved before pages and slides existed', () => {
    const { boardPages: _a, boardPage: _b, slides: _c, slide: _d, ink: _e, ...old } = DEFAULT_CLASSROOM;
    const parsed = sceneSchema.parse({ ...DEFAULT_SCENE, classroom: old });
    expect(parsed.classroom).toMatchObject({ boardPages: 1, boardPage: 0, slides: [], slide: 0, ink: null });
  });

  it('puts every camera in the side column when a deck is showing', () => {
    const ids = ['cam:a', 'screen:b'];
    const withDeck = computeClassLayout('slides', ids, undefined, true);
    const without = computeClassLayout('slides', ids);
    expect(withDeck.every((t) => t.width === withDeck[0]!.width)).toBe(true);
    expect(without[0]!.width).toBeGreaterThan(without[1]!.width);
  });
});
