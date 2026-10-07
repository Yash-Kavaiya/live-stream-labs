import { momentFor, type Celebration, type Cricket, type CricketMoment, type Scene } from '@studio/shared';
import { useEffect, useRef } from 'react';
import { fetchMatches, liveView, pickDefaultMatch, withLatestBall, type Ball, type InningsCard, type Scoreboard, type TeamScore } from '../lib/cricket-feed';
import { useLiveMatch } from '../lib/use-live-match';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const count = (n: number) => Math.max(0, Math.min(9999, Math.round(n) || 0));

/** "3.2" overs → 20 balls. */
function ballsFromOvers(overs: string): number {
  const [whole = '0', part = '0'] = overs.split('.');
  return count(Number(whole) * 6 + Number(part));
}

const scoreLine = (team: TeamScore) => `${team.abbr} ${team.runs}${team.allOut ? '' : `/${team.wickets}`} (${team.overs} ov)`;

/** A cricket moment as a celebration, which every client plays once. */
export function momentCelebration(moment: CricketMoment, detail = '', text = '', emoji = ''): Celebration {
  return { id: crypto.randomUUID(), kind: 'moment', moment, emoji, text: text.slice(0, 40), detail: detail.slice(0, 40), at: Date.now() };
}

/** Puts the innings as it now stands into the scene, with the moment the change earned when moments are automatic. */
export function withInnings(scene: Scene, next: Cricket, announce = true): Scene {
  const cue = announce && next.autoMoments ? momentFor(scene.cricket, next) : null;
  return { ...scene, cricket: next, ...(cue && { celebration: momentCelebration(cue.moment, cue.detail) }) };
}

/**
 * Turns what the score feed says into the innings the cricket template draws. The view and the
 * choice of match are the host's and are kept; everything else is replaced.
 */
export function liveToCricket(current: Cricket, feedBoard: Scoreboard, balls: Ball[], cards: InningsCard[]): Cricket {
  const view = liveView(balls, feedBoard.target);
  const last = view.last;
  const board = withLatestBall(feedBoard, last);
  const batting = board.teams.find((t) => t.batting) ?? board.teams.find((t) => t.abbr === last?.team) ?? board.teams[0];
  const bowling = board.teams.find((t) => t !== batting);
  const chase = board.target || (view.period > 1 ? (last?.target ?? 0) : 0);

  // Where the match stands, in the order a viewer cares: the result, the equation, the target, the toss.
  let status = board.summary || board.status;
  const [first, second] = board.teams;
  if (board.state !== 'post') {
    if (view.equation && last) status = `${last.team} ${view.equation.toLowerCase()}`;
    else if (first && second && !second.batted && (last?.ballLimit ?? 0) > 0 && (first.allOut || last?.remainingBalls === 0)) status = `${second.abbr} need ${first.runs + 1} to win`;
  }

  const card = cards.find((c) => c.period === view.period);
  const batter = (player: Ball['batter'], fallback: string) => ({ name: clip(player?.name ?? fallback, 24), runs: count(player?.runs ?? 0), balls: count(player?.balls ?? 0) });

  return {
    ...current,
    title: clip([board.title, board.description].filter(Boolean).join(' · '), 40),
    batting: clip(batting?.abbr ?? '', 24),
    bowling: clip(bowling?.abbr ?? '', 24),
    runs: count(last?.runs ?? batting?.runs ?? 0),
    wickets: Math.min(10, count(last?.wickets ?? batting?.wickets ?? 0)),
    balls: count(last?.balls ?? 0),
    // A match without an overs limit (a Test) gets the longest the scoreboard allows.
    oversLimit: last && last.ballLimit > 0 ? Math.max(1, Math.min(90, Math.ceil(last.ballLimit / 6))) : 90,
    target: chase > 0 ? count(chase) : null,
    batters: [batter(last?.batter ?? null, 'Batter 1'), batter(last?.partner ?? null, 'Batter 2')],
    // The feed names the batter who faced the last ball first.
    striker: 0,
    bowler: {
      name: clip(last?.bowler?.name ?? 'Bowler', 24),
      balls: ballsFromOvers(last?.bowler?.overs ?? '0'),
      runs: count(last?.bowler?.runs ?? 0),
      wickets: count(last?.bowler?.wickets ?? 0),
    },
    thisOver: view.thisOver.slice(-14).map((ball) => (ball.label === '•' ? '0' : ball.label.slice(0, 3))),
    status: clip(status, 80),
    other: bowling?.batted ? clip(scoreLine(bowling), 40) : '',
    card: (card?.batters ?? []).slice(0, 11).map((b) => ({ name: clip(b.name, 24), how: clip(b.howOut, 40), runs: count(b.runs), balls: count(b.balls) })),
    attack: (card?.bowlers ?? []).slice(0, 8).map((b) => ({ name: clip(b.name, 24), overs: b.overs.slice(0, 6), runs: count(b.runs), wickets: count(b.wickets) })),
    overs: view.overs.slice(-50).map((o) => ({ over: count(o.over), runs: count(o.runs), wickets: Math.min(10, count(o.wickets)) })),
    partnership: view.partnership ? { runs: count(view.partnership.runs), balls: count(view.partnership.balls) } : null,
    projected: view.projected === null ? null : count(view.projected),
    colors: batting && bowling ? [batting.color, bowling.color] : null,
  };
}

/**
 * While the cricket template follows a live match, copies the feed into the scene every time it
 * changes. Only the host runs this; guests and the stream get the score with the rest of the scene.
 * Returns when the feed last answered and why it last failed, for the controls to show.
 */
export function useLiveCricket(scene: Scene, update: SceneUpdater, enabled: boolean): { updatedAt: number | null; error: string | null } {
  const { source, liveMatch, view } = scene.cricket;
  const wanted = enabled && scene.template === 'cricket' && source === 'live';
  const following = wanted && liveMatch !== null;

  // No match chosen yet: follow the live India match if there is one, else whatever is live.
  useEffect(() => {
    if (!wanted || liveMatch) return;
    const abort = new AbortController();
    fetchMatches(abort.signal).then(
      (matches) => {
        const first = pickDefaultMatch(matches);
        if (first) update((s) => (s.cricket.liveMatch ? s : { ...s, cricket: { ...s.cricket, liveMatch: { league: first.league, event: first.event } } }));
      },
      () => undefined,
    );
    return () => abort.abort();
  }, [wanted, liveMatch, update]);
  const data = useLiveMatch(following ? liveMatch.league : '', following ? liveMatch.event : '', view === 'card');
  /** The match whose score is already in the scene. Its first copy is catching up, not news. */
  const seeded = useRef('');

  useEffect(() => {
    const board = data.scoreboard;
    if (!following || !board) return;
    const match = `${liveMatch.league}/${liveMatch.event}`;
    const announce = seeded.current === match;
    seeded.current = match;
    update((s) => {
      if (s.cricket.source !== 'live') return s;
      const next = liveToCricket(s.cricket, board, data.balls, data.cards);
      // Most refreshes bring nothing new; an unchanged scene is not saved or sent again.
      return JSON.stringify(next) === JSON.stringify(s.cricket) ? s : withInnings(s, next, announce);
    });
  }, [following, liveMatch, data.scoreboard, data.balls, data.cards, update]);

  return following ? { updatedAt: data.updatedAt, error: data.error } : { updatedAt: null, error: null };
}
