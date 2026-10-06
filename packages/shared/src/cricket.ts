import type { Cricket } from './scene';

/** What can happen on one delivery, as the scorer enters it. */
export type Ball = 0 | 1 | 2 | 3 | 4 | 6 | 'W' | 'wd' | 'nb';

export const BALLS: Ball[] = [0, 1, 2, 3, 4, 6, 'W', 'wd', 'nb'];

const BALLS_PER_OVER = 6;

export function inningsOver(c: Cricket): boolean {
  const chased = c.target !== null && c.runs >= c.target;
  return c.wickets >= 10 || c.balls >= c.oversLimit * BALLS_PER_OVER || chased;
}

/** 23 legal balls -> "3.5". */
export function oversText(balls: number): string {
  return `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;
}

const other = (striker: 0 | 1): 0 | 1 => (striker === 0 ? 1 : 0);

/**
 * Scores one delivery and returns the new innings state.
 *
 *   runs 0-6  count for the team, the striker and against the bowler; odd runs swap the strike
 *   W         a wicket to the bowler; a new batter comes in on strike with a blank score
 *   wd, nb    one extra to the team and against the bowler, and the ball is bowled again
 *
 * After the sixth legal ball the batters swap ends. `thisOver` keeps the finished over on screen
 * until the first ball of the next one.
 */
export function recordBall(c: Cricket, ball: Ball): Cricket {
  if (inningsOver(c)) return c;

  const startsNewOver = c.balls > 0 && c.balls % BALLS_PER_OVER === 0 && c.thisOver.length > 0;
  const thisOver = [...(startsNewOver ? [] : c.thisOver), String(ball)].slice(-14);

  if (ball === 'wd' || ball === 'nb') {
    return { ...c, runs: c.runs + 1, bowler: { ...c.bowler, runs: c.bowler.runs + 1 }, thisOver };
  }

  const balls = c.balls + 1;
  const batters: Cricket['batters'] = [{ ...c.batters[0] }, { ...c.batters[1] }];
  const facing = batters[c.striker];
  let striker = c.striker;
  let { runs, wickets } = c;
  const bowler = { ...c.bowler, balls: c.bowler.balls + 1 };

  if (ball === 'W') {
    wickets += 1;
    bowler.wickets += 1;
    batters[c.striker] = { name: `Batter ${wickets + 2}`, runs: 0, balls: 0 };
  } else {
    runs += ball;
    bowler.runs += ball;
    facing.runs += ball;
    facing.balls += 1;
    if (ball % 2 === 1) striker = other(striker);
  }
  if (balls % BALLS_PER_OVER === 0) striker = other(striker);

  return { ...c, runs, wickets, balls, batters, striker, bowler, thisOver };
}

export interface CricketStats {
  overs: string;
  /** Current run rate, runs per over. */
  runRate: string;
  /** Required run rate; null when not chasing or the chase is decided. */
  requiredRate: string | null;
  /** "Need 24 from 12 balls", "IND won by 6 wickets", or the projected total; null if nothing to say. */
  summary: string | null;
  bowlerFigures: string;
}

const rate = (runs: number, balls: number) => (balls > 0 ? ((runs * BALLS_PER_OVER) / balls).toFixed(2) : '0.00');

/** Everything on the scoreboard that is derived rather than entered. */
export function cricketStats(c: Cricket): CricketStats {
  const ballsLeft = Math.max(0, c.oversLimit * BALLS_PER_OVER - c.balls);
  let requiredRate: string | null = null;
  let summary: string | null = null;

  if (c.target !== null) {
    const need = c.target - c.runs;
    if (need <= 0) {
      summary = `${c.batting} won by ${10 - c.wickets} wicket${10 - c.wickets === 1 ? '' : 's'}`;
    } else if (inningsOver(c)) {
      summary = need === 1 ? 'Match tied' : `${c.bowling} won by ${need - 1} run${need === 2 ? '' : 's'}`;
    } else {
      requiredRate = rate(need, ballsLeft);
      summary = `Need ${need} from ${ballsLeft} ball${ballsLeft === 1 ? '' : 's'}`;
    }
  } else if (c.balls >= BALLS_PER_OVER && !inningsOver(c)) {
    const projected = Math.round((c.runs / c.balls) * c.oversLimit * BALLS_PER_OVER);
    summary = `Projected ${projected}`;
  }

  return {
    overs: oversText(c.balls),
    runRate: rate(c.runs, c.balls),
    requiredRate,
    summary,
    bowlerFigures: `${c.bowler.wickets}-${c.bowler.runs} (${oversText(c.bowler.balls)})`,
  };
}
