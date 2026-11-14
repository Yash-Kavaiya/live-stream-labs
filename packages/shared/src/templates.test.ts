import { describe, expect, it } from 'vitest';
import { PROGRAM_SIZE, type Tile } from './layout';
import { agendaItems, CLASS_VIEWS, DEFAULT_AUTO, DEFAULT_CLASSROOM, DEFAULT_SCENE, NEWS_VIEWS, normalizeScene, type ClassView } from './scene';
import { classMainArea, classSafeArea, classSideColumn, computeSceneLayout, newsSafeArea, newsSidePanel } from './scene-layout';
import { applyTemplate, formatCountdown, setScreen, setScreenTimer, TEMPLATES } from './templates';

const cams = (n: number) => Array.from({ length: n }, (_, i) => `cam:p${i}`);

function overlap(a: Tile, b: Tile) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('templates', () => {
  it('applies the accent colour and a fitting layout', () => {
    const scene = applyTemplate({ ...DEFAULT_SCENE, stage: ['cam:a', 'cam:b'] }, 'classroom');
    expect(scene.template).toBe('classroom');
    expect(scene.brand.color).toBe(TEMPLATES.classroom.accent);
    expect(scene.layout).toBe('grid');
  });

  it('fills in new fields for a scene saved before they existed', () => {
    const { template: _t, screen: _s, auto: _a, news: _n, classroom: _c, celebration: _e, style: _y, ...old } = DEFAULT_SCENE;
    const scene = normalizeScene({ ...old, layout: 'pip' });
    expect(scene).toMatchObject({ layout: 'pip', template: 'none', auto: DEFAULT_AUTO, classroom: DEFAULT_CLASSROOM });
  });

  it('maps a removed template to the clean look instead of discarding the scene', () => {
    const scene = normalizeScene({ ...DEFAULT_SCENE, template: 'sports', stage: ['cam:a'], scoreboard: { teamA: 'x' } });
    expect(scene.template).toBe('none');
    expect(scene.stage).toEqual(['cam:a']);
  });

  it('opens a scene saved with the old cricket template, dropping its moment', () => {
    const scene = normalizeScene({
      ...DEFAULT_SCENE,
      template: 'cricket',
      stage: ['cam:a'],
      cricket: { view: 'match', runs: 12 },
      celebration: { id: 'x', kind: 'moment', emoji: '', text: 'SIX!', at: 1, moment: 'six' },
    });
    expect(scene.template).toBe('none');
    expect(scene.stage).toEqual(['cam:a']);
    expect(scene.celebration).toBeNull();
    expect(scene).not.toHaveProperty('cricket');
  });

  it('falls back when the stored value is not a scene at all', () => {
    expect(normalizeScene('garbage')).toEqual(DEFAULT_SCENE);
  });
});

describe('news room layouts', () => {
  const news = (view: (typeof NEWS_VIEWS)[number]) => ({
    ...DEFAULT_SCENE,
    template: 'newsroom' as const,
    news: { ...DEFAULT_SCENE.news, view },
  });
  const safe = newsSafeArea();

  it.each(NEWS_VIEWS)('%s keeps video clear of the channel bar and the headline area', (view) => {
    for (let n = 1; n <= 6; n++) {
      for (const t of computeSceneLayout(news(view), cams(n))) {
        expect(t.y, `${view} n=${n}`).toBeGreaterThanOrEqual(Math.floor(safe.y));
        expect(t.y + t.height).toBeLessThanOrEqual(Math.ceil(safe.y + safe.height) + 1);
        expect(t.x + t.width).toBeLessThanOrEqual(PROGRAM_SIZE.width);
      }
    }
  });

  it('anchor: one presenter leaves the side panel free; guests fill it', () => {
    const side = newsSidePanel();
    const [solo] = computeSceneLayout(news('anchor'), cams(1));
    expect(solo!.x + solo!.width).toBeLessThan(side.x);

    const withGuests = computeSceneLayout(news('anchor'), cams(3));
    expect(withGuests).toHaveLength(3);
    expect(withGuests[1]!.x).toBeGreaterThanOrEqual(Math.floor(side.x));
    expect(overlap(withGuests[1]!, withGuests[2]!)).toBe(false);
  });

  it('interview: equal boxes side by side', () => {
    const tiles = computeSceneLayout(news('interview'), cams(2));
    expect(tiles[0]!.width).toBe(tiles[1]!.width);
    expect(tiles[0]!.y).toBe(tiles[1]!.y);
    expect(overlap(tiles[0]!, tiles[1]!)).toBe(false);
  });

  it('headline: only the presenter stays, small in the corner', () => {
    const tiles = computeSceneLayout(news('headline'), cams(3));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.width).toBeLessThan(PROGRAM_SIZE.width * 0.3);
  });
});

describe('classroom layouts', () => {
  const classroom = (view: ClassView) => ({
    ...DEFAULT_SCENE,
    template: 'classroom' as const,
    classroom: { ...DEFAULT_CLASSROOM, view },
  });
  const safe = classSafeArea();
  const column = classSideColumn();

  it.each(CLASS_VIEWS)('%s keeps video clear of the lesson header and the plan strip', (view) => {
    for (let n = 1; n <= 6; n++) {
      const tiles = computeSceneLayout(classroom(view), [...cams(n - 1), 'screen:p0']);
      expect(tiles).toHaveLength(n);
      for (const t of tiles) {
        expect(t.y, `${view} n=${n}`).toBeGreaterThanOrEqual(Math.floor(safe.y));
        expect(t.y + t.height).toBeLessThanOrEqual(Math.ceil(safe.y + safe.height) + 1);
        expect(t.x + t.width).toBeLessThanOrEqual(PROGRAM_SIZE.width);
      }
    }
  });

  it('lecture: one teacher leaves the side column free for the plan; guests fill it', () => {
    const [solo] = computeSceneLayout(classroom('lecture'), cams(1));
    expect(solo!.x + solo!.width).toBeLessThan(column.x);

    const withGuests = computeSceneLayout(classroom('lecture'), cams(3));
    expect(withGuests[1]!.x).toBeGreaterThanOrEqual(Math.floor(column.x));
    expect(overlap(withGuests[1]!, withGuests[2]!)).toBe(false);
  });

  it('slides: the shared screen takes the big slot even when the camera is listed first', () => {
    const tiles = computeSceneLayout(classroom('slides'), ['cam:t', 'screen:t']);
    const screen = tiles.find((t) => t.id === 'screen:t')!;
    const cam = tiles.find((t) => t.id === 'cam:t')!;
    expect(screen.width).toBeGreaterThan(cam.width * 2);
    expect(screen.fit).toBe('contain');
    expect(cam.x).toBeGreaterThanOrEqual(Math.floor(column.x));
    expect(overlap(screen, cam)).toBe(false);
  });

  it('slides: a screen on its own grows to the full height of the safe area', () => {
    const [screen] = computeSceneLayout(classroom('slides'), ['screen:t']);
    expect(screen!.height).toBeGreaterThanOrEqual(Math.floor(safe.height) - 1);
    expect(screen!.x + screen!.width).toBeGreaterThan(classSideColumn().x);
  });

  it.each(['board', 'quiz'] as const)('%s: every camera sits in the side column, clear of the panel', (view) => {
    const main = classMainArea();
    const tiles = computeSceneLayout(classroom(view), cams(3));
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect(t.x).toBeGreaterThanOrEqual(Math.floor(main.x + main.width));
    expect(overlap(tiles[0]!, tiles[1]!)).toBe(false);
  });
});

describe('lesson plan', () => {
  it('lists the parts in order, skipping blank lines and trimming spaces', () => {
    expect(agendaItems({ ...DEFAULT_CLASSROOM, agenda: ' Warm-up \n\nNew idea\nPractice\n' })).toEqual(['Warm-up', 'New idea', 'Practice']);
  });

  it('keeps at most twelve parts', () => {
    const agenda = Array.from({ length: 15 }, (_, i) => `Part ${i + 1}`).join('\n');
    expect(agendaItems({ ...DEFAULT_CLASSROOM, agenda })).toHaveLength(12);
  });

  it('does not accept a quiz with the wrong number of options', () => {
    const scene = normalizeScene({ ...DEFAULT_SCENE, classroom: { ...DEFAULT_CLASSROOM, quiz: { ...DEFAULT_CLASSROOM.quiz, options: ['a'] } } });
    expect(scene).toEqual(DEFAULT_SCENE);
  });
});

describe('holding-screen countdown', () => {
  const NOW = 1_000_000;
  const fiveMinutes = { ...DEFAULT_SCENE, screenTimerSec: 300 };

  it('starts when a countdown screen comes up and clears on the others', () => {
    expect(setScreen(fiveMinutes, 'starting', NOW).screenEndsAt).toBe(NOW + 300_000);
    expect(setScreen(fiveMinutes, 'brb', NOW).screenEndsAt).toBe(NOW + 300_000);
    expect(setScreen(fiveMinutes, 'ending', NOW).screenEndsAt).toBeNull();
    expect(setScreen(setScreen(fiveMinutes, 'brb', NOW), 'live', NOW).screenEndsAt).toBeNull();
  });

  it('stays off when no length is set', () => {
    expect(setScreen(DEFAULT_SCENE, 'starting', NOW).screenEndsAt).toBeNull();
  });

  it('restarts when the length changes during a countdown, and only then', () => {
    const running = setScreen(fiveMinutes, 'starting', NOW);
    expect(setScreenTimer(running, 60, NOW + 5000).screenEndsAt).toBe(NOW + 65_000);
    expect(setScreenTimer(running, 0, NOW).screenEndsAt).toBeNull();
    expect(setScreenTimer(DEFAULT_SCENE, 120, NOW)).toMatchObject({ screenTimerSec: 120, screenEndsAt: null });
  });

  it('formats the time left, rounding up so it never shows 0:00 early', () => {
    expect(formatCountdown(299_400)).toBe('5:00');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(400)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5000)).toBe('0:00');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
  });
});
