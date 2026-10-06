import { describe, expect, it } from 'vitest';
import { howOutFromText, liveView, mergeBalls, parseBall, parseScoreboard, pickDefaultMatch, type MatchRef } from './cricket-feed';

const player = (id: string, name: string, totalRuns = 0, faced = 0) => ({ athlete: { id, displayName: name }, totalRuns, faced, fours: 0, sixes: 0 });

interface EntryOptions {
  play?: string;
  score?: number;
  runs: number;
  wickets?: number;
  period?: number;
  target?: number;
  out?: string;
  wide?: boolean;
}

/** One commentary entry shaped like the feed's, for the given ball of a 120-ball innings. */
function entry(n: number, opts: EntryOptions) {
  const over = Math.floor((n - 1) / 6) + 1;
  return {
    id: String(n + (opts.period ?? 1) * 1000),
    sequence: n,
    period: opts.period ?? 1,
    playType: { description: opts.play ?? 'run' },
    scoreValue: opts.score ?? 0,
    shortText: 'Bowler to Batter',
    batsman: player('b1', 'Batter One', 10, 8),
    otherBatsman: player('b2', 'Batter Two', 4, 5),
    bowler: { athlete: { id: 'p1', displayName: 'Bowler One' }, overs: 1.2, maidens: 0, conceded: 9, wickets: 0 },
    innings: { runs: opts.runs, wickets: opts.wickets ?? 0, balls: n, ballLimit: 120, remainingBalls: 120 - n, target: opts.target ?? 0 },
    over: { number: over, overs: `${over - 1}.${((n - 1) % 6) + 1}`, runs: opts.score ?? 0, wide: opts.wide ? 1 : 0, noBall: 0, byes: 0, legByes: 0 },
    dismissal: opts.out ? { dismissal: true, text: opts.out, batsman: { athlete: { id: 'b1' } } } : { dismissal: false },
  };
}

describe('parseBall', () => {
  it('labels runs, boundaries, wickets and extras', () => {
    const label = (opts: EntryOptions) => parseBall(entry(1, opts))?.label;
    expect(label({ play: 'no run', runs: 0 })).toBe('•');
    expect(label({ play: 'run', score: 2, runs: 2 })).toBe('2');
    expect(label({ play: 'four', score: 4, runs: 4 })).toBe('4');
    expect(label({ play: 'six', score: 6, runs: 6 })).toBe('6');
    expect(label({ play: 'out', runs: 0, wickets: 1, out: 'A Batter b Bowler 0 (1m 1b)' })).toBe('W');
    expect(label({ play: 'wide', score: 1, runs: 1, wide: true })).toBe('wd');
  });

  it('skips entries that are not balls, such as the innings break', () => {
    const breakEntry = { id: '9', period: 2, innings: { runs: 0, number: 2 }, over: { number: 0, overs: 0 }, playType: { description: 'no run' } };
    expect(parseBall(breakEntry)).toBeNull();
    expect(parseBall({ id: '1', text: 'Welcome' })).toBeNull();
  });
});

describe('liveView', () => {
  const balls = [
    entry(1, { play: 'four', score: 4, runs: 4 }),
    entry(2, { play: 'out', runs: 4, wickets: 1, out: 'AB Opener c Keeper b Bowler 4 (3m 2b 1x4 0x6) SR: 200' }),
    entry(7, { play: 'six', score: 6, runs: 10, wickets: 1 }),
  ].map((e) => parseBall(e)!);

  it('works out the rate, the overs, the fall of wickets and the partnership', () => {
    const view = liveView(balls, 0);
    expect(view.runRate).toBe('8.57');
    expect(view.overs.map((o) => o.over)).toEqual([1, 2]);
    expect(view.overs[0]!.wickets).toBe(1);
    expect(view.fallOfWickets).toEqual([{ wicket: 1, runs: 4, overs: '0.2', name: 'AB Opener' }]);
    expect(view.partnership).toEqual({ runs: 6, balls: 5 });
    expect(view.projected).toBe(171);
    expect(view.equation).toBeNull();
  });

  it('gives the equation and required rate in a chase', () => {
    const chase = [parseBall(entry(108, { runs: 150, wickets: 4, period: 2, target: 172 }))!];
    const view = liveView(chase, 172);
    expect(view.equation).toBe('Need 22 from 12 balls');
    expect(view.requiredRate).toBe('11.00');
    expect(view.projected).toBeNull();
  });

  it('follows the latest innings only', () => {
    const second = parseBall(entry(1, { runs: 1, score: 1, period: 2, target: 11 }))!;
    const view = liveView(mergeBalls(balls, [second, second]), 11);
    expect(view.period).toBe(2);
    expect(view.recent).toHaveLength(1);
  });
});

describe('howOutFromText', () => {
  it('pulls the dismissal out of the feed sentence', () => {
    expect(howOutFromText('AJ Hosein c Ishan Kishan b Patel 15 (17m 9b 1x4 1x6) SR: 166.66')).toBe('c Ishan Kishan b Patel');
    expect(howOutFromText('RL Chase lbw b Kuldeep Yadav 5 (4m 3b 1x4 0x6) SR: 166.66')).toBe('lbw b Kuldeep Yadav');
    expect(howOutFromText('nothing useful')).toBe('');
  });
});

describe('parseScoreboard', () => {
  const competitor = (id: string, abbr: string, linescores: object[]) => ({ team: { id, abbreviation: abbr, displayName: abbr, color: '123456' }, linescores });
  const data = {
    leagues: [{ name: 'A series' }],
    events: [
      {
        id: '7',
        shortName: 'IND v WI',
        competitions: [
          {
            description: '1st T20I',
            status: { summary: 'India won toss & fielded', type: { state: 'in', description: 'Innings break' } },
            competitors: [
              competitor('6', 'IND', [{ period: 1, isBatting: false, runs: 0, wickets: 0, overs: 19.1 }]),
              competitor('4', 'WI', [{ period: 1, isBatting: true, isCurrent: 1, runs: 171, wickets: 10, overs: 19.1, description: 'all out' }]),
            ],
          },
        ],
      },
    ],
  };

  it('puts the side that batted first in front and reads its score', () => {
    const board = parseScoreboard(data, '7')!;
    expect(board.teams.map((t) => t.abbr)).toEqual(['WI', 'IND']);
    expect(board.teams[0]).toMatchObject({ runs: 171, wickets: 10, overs: '19.1', allOut: true, batted: true, color: '#123456' });
    expect(board.teams[1]!.batted).toBe(false);
    expect(board.status).toBe('Innings break');
  });

  it('returns null for a match the feed does not list', () => {
    expect(parseScoreboard(data, 'nope')).toBeNull();
  });
});

describe('pickDefaultMatch', () => {
  const match = (title: string, state: MatchRef['state']): MatchRef => ({ league: '1', event: title, title, series: '', state, status: '' });
  it('prefers a live India match, then any live match', () => {
    expect(pickDefaultMatch([match('AUS v ENG', 'in'), match('IND v WI', 'in')])?.title).toBe('IND v WI');
    expect(pickDefaultMatch([match('IND19 v AUS19', 'post'), match('AUS v ENG', 'in')])?.title).toBe('AUS v ENG');
    expect(pickDefaultMatch([])).toBeUndefined();
  });
});
