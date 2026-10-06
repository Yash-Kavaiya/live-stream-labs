import { describe, expect, it } from 'vitest';
import { cricketStats, oversText, recordBall, type Ball } from './cricket';
import { PROGRAM_SIZE, type Tile } from './layout';
import { DEFAULT_AUTO, DEFAULT_CRICKET, DEFAULT_SCENE, NEWS_VIEWS, normalizeScene, type Cricket } from './scene';
import { CRICKET_STRIP, computeSceneLayout, newsSafeArea, newsSidePanel } from './scene-layout';
import { applyTemplate, formatCountdown, setScreen, setScreenTimer, TEMPLATES } from './templates';

const cams = (n: number) => Array.from({ length: n }, (_, i) => `cam:p${i}`);
const play = (c: Cricket, balls: Ball[]) => balls.reduce(recordBall, c);

function overlap(a: Tile, b: Tile) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('templates', () => {
  it('applies the accent colour and a fitting layout', () => {
    const scene = applyTemplate({ ...DEFAULT_SCENE, stage: ['cam:a', 'cam:b'] }, 'cricket');
    expect(scene.template).toBe('cricket');
    expect(scene.brand.color).toBe(TEMPLATES.cricket.accent);
    expect(scene.layout).toBe('grid');
  });

  it('fills in new fields for a scene saved before they existed', () => {
    const { template: _t, screen: _s, auto: _a, news: _n, cricket: _c, celebration: _e, ...old } = DEFAULT_SCENE;
    const scene = normalizeScene({ ...old, layout: 'pip' });
    expect(scene).toMatchObject({ layout: 'pip', template: 'none', auto: DEFAULT_AUTO, cricket: DEFAULT_CRICKET });
  });

  it('maps a removed template to the clean look instead of discarding the scene', () => {
    const scene = normalizeScene({ ...DEFAULT_SCENE, template: 'sports', stage: ['cam:a'], scoreboard: { teamA: 'x' } });
    expect(scene.template).toBe('none');
    expect(scene.stage).toEqual(['cam:a']);
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

describe('cricket layouts', () => {
  const cricket = (view: Cricket['view']) => ({
    ...DEFAULT_SCENE,
    template: 'cricket' as const,
    cricket: { ...DEFAULT_CRICKET, view },
  });

  it('match view keeps video above the score strip', () => {
    const stripTop = PROGRAM_SIZE.height * (1 - CRICKET_STRIP / 100);
    for (const t of computeSceneLayout(cricket('match'), cams(4))) {
      expect(t.y + t.height).toBeLessThanOrEqual(stripTop + 1);
    }
  });

  it('dashboard stacks cameras in a column on the right', () => {
    const tiles = computeSceneLayout(cricket('dashboard'), cams(3));
    for (const t of tiles) expect(t.x).toBeGreaterThan(PROGRAM_SIZE.width * 0.65);
    expect(overlap(tiles[0]!, tiles[1]!)).toBe(false);
  });
});

describe('cricket scoring', () => {
  it('adds runs to the team, the striker and the bowler, and rotates strike on odd runs', () => {
    const c = play(DEFAULT_CRICKET, [1, 4]);
    expect(c).toMatchObject({ runs: 5, balls: 2, striker: 1 });
    expect(c.batters[0]).toMatchObject({ runs: 1, balls: 1 });
    expect(c.batters[1]).toMatchObject({ runs: 4, balls: 1 });
    expect(c.bowler).toMatchObject({ runs: 5, balls: 2 });
    expect(c.thisOver).toEqual(['1', '4']);
  });

  it('does not count wides and no-balls as legal deliveries', () => {
    const c = play(DEFAULT_CRICKET, ['wd', 'nb', 0]);
    expect(c).toMatchObject({ runs: 2, balls: 1 });
    expect(c.batters[0]!.balls).toBe(1);
    expect(c.bowler.runs).toBe(2);
  });

  it('takes a wicket: new batter on strike with a blank score', () => {
    const c = play(DEFAULT_CRICKET, [4, 'W']);
    expect(c).toMatchObject({ runs: 4, wickets: 1, balls: 2, striker: 0 });
    expect(c.batters[0]).toEqual({ name: 'Batter 3', runs: 0, balls: 0 });
    expect(c.bowler.wickets).toBe(1);
  });

  it('swaps ends after six legal balls and starts a fresh over on the next ball', () => {
    const over = play(DEFAULT_CRICKET, [0, 0, 0, 0, 0, 0]);
    expect(over).toMatchObject({ balls: 6, striker: 1 });
    expect(over.thisOver).toHaveLength(6);
    expect(oversText(over.balls)).toBe('1.0');
    expect(recordBall(over, 2).thisOver).toEqual(['2']);
  });

  it('stops scoring when the innings is over', () => {
    const allOut = play(DEFAULT_CRICKET, Array<Ball>(10).fill('W'));
    expect(allOut.wickets).toBe(10);
    expect(recordBall(allOut, 6)).toBe(allOut);

    const bowledOut = play({ ...DEFAULT_CRICKET, oversLimit: 1 }, [1, 1, 1, 1, 1, 1]);
    expect(recordBall(bowledOut, 6)).toBe(bowledOut);
  });

  it('works out run rates and what a chase needs', () => {
    const chasing = play({ ...DEFAULT_CRICKET, oversLimit: 2, target: 20 }, [6, 6, 0, 0, 0, 0]);
    const stats = cricketStats(chasing);
    expect(stats.overs).toBe('1.0');
    expect(stats.runRate).toBe('12.00');
    expect(stats.requiredRate).toBe('8.00');
    expect(stats.summary).toBe('Need 8 from 6 balls');
    expect(stats.bowlerFigures).toBe('0-12 (1.0)');
  });

  it('announces the result of a chase', () => {
    const won = play({ ...DEFAULT_CRICKET, target: 6 }, [6]);
    expect(cricketStats(won).summary).toBe('IND won by 10 wickets');
    expect(recordBall(won, 1)).toBe(won);

    const lost = play({ ...DEFAULT_CRICKET, oversLimit: 1, target: 10 }, [1, 1, 1, 1, 1, 1]);
    expect(cricketStats(lost).summary).toBe('AUS won by 3 runs');
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
