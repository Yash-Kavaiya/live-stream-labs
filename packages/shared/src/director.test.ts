import { describe, expect, it } from 'vitest';
import { Fade, TileAnimator } from './animate';
import { computeLayout } from './layout';
import { DEFAULT_AUTO, DEFAULT_SCENE, normalizeScene } from './scene';
import { applyTemplate, pickAutoLayout, TEMPLATES } from './templates';

const FRAME = 1000 / 30;

function run(animator: TileAnimator, targets: ReturnType<typeof computeLayout>, frames: number) {
  let out = animator.step(targets, FRAME);
  for (let i = 1; i < frames; i++) out = animator.step(targets, FRAME);
  return out;
}

describe('TileAnimator', () => {
  it('fades a new tile in and settles exactly on its target', () => {
    const animator = new TileAnimator();
    const [target] = computeLayout('solo', ['cam:a']);
    const first = animator.step([target!], FRAME)[0]!;
    expect(first.opacity).toBe(0);
    expect(first.width).toBeLessThan(target!.width);

    const settled = run(animator, [target!], 45)[0]!;
    expect(settled.opacity).toBeGreaterThan(0.99);
    expect(settled.width).toBeCloseTo(target!.width, 0);
    expect(settled.x).toBeCloseTo(target!.x, 0);
  });

  it('moves a tile through intermediate positions when the layout changes', () => {
    const animator = new TileAnimator();
    run(animator, computeLayout('solo', ['cam:a']), 45);
    const target = computeLayout('grid', ['cam:a', 'cam:b'])[0]!;

    const mid = animator.step(computeLayout('grid', ['cam:a', 'cam:b']), FRAME).find((t) => t.id === 'cam:a')!;
    expect(mid.width).toBeGreaterThan(target.width);
    expect(mid.width).toBeLessThan(1280);

    const end = run(animator, computeLayout('grid', ['cam:a', 'cam:b']), 45).find((t) => t.id === 'cam:a')!;
    expect(end.width).toBeCloseTo(target.width, 0);
  });

  it('fades a removed tile out underneath the others, then forgets it', () => {
    const animator = new TileAnimator();
    run(animator, computeLayout('grid', ['cam:a', 'cam:b']), 45);
    const next = computeLayout('grid', ['cam:a']);

    const during = animator.step(next, FRAME);
    expect(during.map((t) => t.id)).toEqual(['cam:b', 'cam:a']);
    expect(during[0]!.opacity).toBeLessThan(1);

    expect(run(animator, next, 45).map((t) => t.id)).toEqual(['cam:a']);
  });

  it('brings back a tile that returns while it is still fading out', () => {
    const animator = new TileAnimator();
    const both = computeLayout('grid', ['cam:a', 'cam:b']);
    run(animator, both, 45);
    animator.step(computeLayout('grid', ['cam:a']), FRAME);
    const back = run(animator, both, 45).find((t) => t.id === 'cam:b')!;
    expect(back.opacity).toBeGreaterThan(0.99);
  });
});

describe('Fade', () => {
  it('rises to 1, falls to 0 and never overshoots', () => {
    const fade = new Fade(200);
    expect(fade.step(true, 100)).toBeGreaterThan(0.5);
    expect(fade.step(true, 1000)).toBe(1);
    expect(fade.step(false, 100)).toBeLessThan(1);
    expect(fade.step(false, 1000)).toBe(0);
  });
});

describe('pickAutoLayout', () => {
  const clean = { followSpeaker: false, template: 'none' as const };

  it('fills the frame for one person and shares it for several', () => {
    expect(pickAutoLayout(['cam:a'], clean)).toBe('solo');
    expect(pickAutoLayout(['cam:a', 'cam:b', 'cam:c'], clean)).toBe('grid');
  });

  it('uses spotlight when following the speaker', () => {
    expect(pickAutoLayout(['cam:a', 'cam:b'], { ...clean, followSpeaker: true })).toBe('spotlight');
  });

  it('gives shared content the big slot', () => {
    expect(pickAutoLayout(['cam:a', 'screen:a'], clean)).toBe('screen');
    expect(pickAutoLayout(['cam:a', 'clip:a'], { ...clean, template: 'watchparty' })).toBe('cinema');
  });

  it('keeps a themed backdrop visible around a single person', () => {
    expect(pickAutoLayout(['cam:a'], { followSpeaker: false, template: 'newsroom' })).toBe('grid');
  });
});

describe('templates and scene defaults', () => {
  it('applies accent, layout and a starter scoreboard', () => {
    const scene = applyTemplate({ ...DEFAULT_SCENE, stage: ['cam:a', 'cam:b'] }, 'cricket');
    expect(scene.template).toBe('cricket');
    expect(scene.brand.color).toBe(TEMPLATES.cricket.accent);
    expect(scene.scoreboard?.info).toContain('Overs');
    expect(scene.layout).toBe('grid');
  });

  it('keeps a scoreboard the host already edited', () => {
    const edited = { teamA: 'MI', teamB: 'CSK', scoreA: '182/4', scoreB: '', info: 'Overs 18.2' };
    expect(applyTemplate({ ...DEFAULT_SCENE, scoreboard: edited }, 'sports').scoreboard).toEqual(edited);
  });

  it('fills in new fields for a scene saved before they existed', () => {
    const { template: _t, screen: _s, screenMessage: _m, scoreboard: _b, auto: _a, ...old } = DEFAULT_SCENE;
    const scene = normalizeScene({ ...old, layout: 'pip' });
    expect(scene).toMatchObject({ layout: 'pip', template: 'none', screen: 'live', auto: DEFAULT_AUTO });
  });

  it('falls back when the stored value is not a scene at all', () => {
    expect(normalizeScene('garbage')).toEqual(DEFAULT_SCENE);
  });
});
