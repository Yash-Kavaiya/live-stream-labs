/**
 * Live cricket from ESPN's public site feed. It needs no key and allows browser requests, but it
 * is undocumented and can change, so everything read from it is treated as untrusted JSON: each
 * field is checked, and a missing one becomes a blank rather than an exception.
 */

// The `site.web` host answers browsers from any origin; the plain `site.api` host refuses them.
const SITE = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
const HEADER = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in&lang=en';

/** At most this many pages of commentary (25 entries each) are loaded: about two T20 innings. */
const MAX_PAGES = 14;

// ---------- Reading untrusted JSON ----------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

async function getJson(url: string, signal?: AbortSignal): Promise<Json> {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`The score feed answered ${res.status}`);
  return obj(await res.json());
}

// ---------- What the page works with ----------

export type MatchState = 'pre' | 'in' | 'post';

export interface MatchRef {
  league: string;
  event: string;
  /** "IND v WI" */
  title: string;
  series: string;
  state: MatchState;
  /** "Innings break", "India won by 6 wickets" */
  status: string;
}

export interface TeamScore {
  id: string;
  abbr: string;
  name: string;
  color: string;
  logo: string;
  /** False until the team has started an innings. */
  batted: boolean;
  batting: boolean;
  runs: number;
  wickets: number;
  /** "19.1" */
  overs: string;
  allOut: boolean;
}

export interface Scoreboard {
  title: string;
  /** "1st T20I" */
  description: string;
  series: string;
  venue: string;
  state: MatchState;
  /** "Innings break", "Live" */
  status: string;
  /** The line under the score: the toss, the equation, or the result. */
  summary: string;
  /** In batting order of the match: the side that batted first comes first. */
  teams: TeamScore[];
  /** Runs the chasing side needs to win; 0 when nobody is chasing. */
  target: number;
}

export type BallKind = 'dot' | 'run' | 'four' | 'six' | 'wicket' | 'extra';

export interface Ball {
  id: string;
  sequence: number;
  /** 1 for the first innings of the match, 2 for the second, and so on. */
  period: number;
  /** The batting side, e.g. "IND". */
  team: string;
  /** 1-based over number. */
  over: number;
  /** "18.3" */
  overs: string;
  label: string;
  kind: BallKind;
  /** "Patel to Hosein, OUT" */
  short: string;
  text: string;
  /** Innings score after this ball. */
  runs: number;
  wickets: number;
  balls: number;
  ballLimit: number;
  remainingBalls: number;
  target: number;
  overRuns: number;
  batter: CreasePlayer | null;
  partner: CreasePlayer | null;
  bowler: CreaseBowler | null;
  /** "AJ Hosein c Ishan Kishan b Patel 15 (17m 9b 1x4 1x6) SR: 166.66" on a wicket. */
  dismissal: string;
  dismissedId: string;
}

export interface CreasePlayer {
  id: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
}

export interface CreaseBowler {
  id: string;
  name: string;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
}

export interface BatterLine extends CreasePlayer {
  strikeRate: string;
  out: boolean;
  /** "c Ishan Kishan b Patel", "not out" */
  howOut: string;
  captain: boolean;
  keeper: boolean;
}

export interface BowlerLine extends CreaseBowler {
  economy: string;
  dots: number;
}

export interface InningsCard {
  period: number;
  battingAbbr: string;
  bowlingAbbr: string;
  batters: BatterLine[];
  /** Names of players in the XI who have not batted. */
  yetToBat: string[];
  bowlers: BowlerLine[];
}

// ---------- Match list ----------

export async function fetchMatches(signal?: AbortSignal): Promise<MatchRef[]> {
  const data = await getJson(HEADER, signal);
  const matches: MatchRef[] = [];
  for (const sport of arr(data.sports)) {
    for (const league of arr(obj(sport).leagues)) {
      for (const event of arr(obj(league).events)) {
        const e = obj(event);
        const state = str(e.status);
        matches.push({
          league: str(obj(league).id),
          event: str(e.id),
          title: str(e.shortName) || str(e.name),
          series: str(obj(league).name),
          state: state === 'in' || state === 'post' ? state : 'pre',
          status: str(e.summary) || str(obj(e.fullStatus).summary),
        });
      }
    }
  }
  // Live matches first, then finished, then upcoming; the feed's own order within each.
  const rank: Record<MatchState, number> = { in: 0, post: 1, pre: 2 };
  return matches.filter((m) => m.league && m.event).sort((a, b) => rank[a.state] - rank[b.state]);
}

/** The match to open when the address names none: India live, else anything live, else the first. */
export function pickDefaultMatch(matches: MatchRef[]): MatchRef | undefined {
  const india = (m: MatchRef) => /\bIND\b/.test(m.title);
  return matches.find((m) => m.state === 'in' && india(m)) ?? matches.find((m) => m.state === 'in') ?? matches.find(india) ?? matches[0];
}

// ---------- Scoreboard ----------

function colour(value: unknown, fallback: string): string {
  const hex = str(value).replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : fallback;
}

export function parseScoreboard(data: Json, eventId: string): Scoreboard | null {
  const event = arr(data.events).map(obj).find((e) => str(e.id) === eventId);
  if (!event) return null;
  const competition = obj(arr(event.competitions)[0]);
  const status = obj(competition.status);
  const type = obj(status.type);
  let target = 0;

  const teams = arr(competition.competitors).map((raw, index): TeamScore & { order: number } => {
    const competitor = obj(raw);
    const team = obj(competitor.team);
    // A side has one entry per innings of the match; the ones it batted in are flagged.
    const innings = arr(competitor.linescores).map(obj).filter((l) => l.isBatting === true);
    const latest = innings[innings.length - 1];
    const current = arr(competitor.linescores).map(obj).some((l) => l.isBatting === true && num(l.isCurrent) === 1);
    if (latest && num(latest.target) > 0) target = num(latest.target);
    return {
      id: str(team.id),
      abbr: str(team.abbreviation) || str(team.shortDisplayName),
      name: str(team.displayName) || str(team.name),
      color: colour(team.color, index === 0 ? '#0B57D0' : '#B3261E'),
      logo: str(team.logo),
      batted: Boolean(latest),
      batting: current,
      runs: latest ? num(latest.runs) : 0,
      wickets: latest ? num(latest.wickets) : 0,
      overs: latest ? str(latest.overs) : '',
      allOut: latest ? str(latest.description) === 'all out' : false,
      order: latest ? num(latest.period) : 99,
    };
  });
  teams.sort((a, b) => a.order - b.order);

  const state = str(type.state);
  return {
    title: str(event.shortName) || str(event.name),
    description: str(competition.description),
    series: str(obj(arr(data.leagues)[0]).name),
    venue: str(obj(competition.venue).fullName),
    state: state === 'in' || state === 'post' ? state : 'pre',
    status: str(type.description),
    summary: str(status.summary),
    teams: teams.map(({ order: _order, ...team }) => team),
    target,
  };
}

/**
 * The scoreboard brought up to the latest ball. The ball-by-ball feed runs a little ahead of the
 * scoreboard, most visibly at the start of an innings, so the batting side's score is taken from
 * the last ball when there is one.
 */
export function withLatestBall(board: Scoreboard, last: Ball | null): Scoreboard {
  if (!last || board.state !== 'in' || !board.teams.some((t) => t.abbr === last.team)) return board;
  const teams = board.teams.map((team) =>
    team.abbr === last.team
      ? { ...team, batted: true, batting: true, runs: last.runs, wickets: last.wickets, overs: last.overs, allOut: last.wickets >= 10 }
      : { ...team, batting: false },
  );
  // Whoever is batting now did not bat first, unless this is the first innings.
  if (last.period > 1) teams.sort((a, b) => Number(a.abbr === last.team) - Number(b.abbr === last.team));
  return { ...board, teams, target: board.target || (last.period > 1 ? last.target : 0) };
}

export async function fetchScoreboard(league: string, event: string, signal?: AbortSignal): Promise<Scoreboard | null> {
  return parseScoreboard(await getJson(`${SITE}/${league}/scoreboard`, signal), event);
}

// ---------- Ball by ball ----------

function creasePlayer(raw: unknown): CreasePlayer | null {
  const player = obj(raw);
  const athlete = obj(player.athlete);
  if (!athlete.id) return null;
  return {
    id: str(athlete.id),
    name: str(athlete.displayName) || str(athlete.name),
    runs: num(player.totalRuns),
    balls: num(player.faced),
    fours: num(player.fours),
    sixes: num(player.sixes),
  };
}

function creaseBowler(raw: unknown): CreaseBowler | null {
  const bowler = obj(raw);
  const athlete = obj(bowler.athlete);
  if (!athlete.id) return null;
  return {
    id: str(athlete.id),
    name: str(athlete.displayName) || str(athlete.name),
    overs: str(bowler.overs),
    maidens: num(bowler.maidens),
    runs: num(bowler.conceded),
    wickets: num(bowler.wickets),
  };
}

/** One commentary entry as a ball, or null for the entries that are only talk between balls. */
export function parseBall(raw: unknown): Ball | null {
  const item = obj(raw);
  const over = obj(item.over);
  const innings = obj(item.innings);
  // Entries between balls (the innings break, a drinks interval) carry an empty over and nobody
  // at the crease; counting one as a ball would blank the score.
  const batter = creasePlayer(item.batsman);
  const bowler = creaseBowler(item.bowler);
  if (!item.id || !item.over || !item.innings || !batter || !bowler) return null;

  const play = str(obj(item.playType).description).toLowerCase();
  const runs = num(item.scoreValue);
  const dismissal = obj(item.dismissal);
  const wicket = dismissal.dismissal === true || play === 'out';
  let label: string;
  let kind: BallKind;
  if (wicket) [label, kind] = ['W', 'wicket'];
  else if (num(over.wide) > 0) [label, kind] = [runs > 1 ? `${runs}wd` : 'wd', 'extra'];
  else if (num(over.noBall) > 0) [label, kind] = [runs > 1 ? `${runs}nb` : 'nb', 'extra'];
  else if (num(over.byes) > 0) [label, kind] = [`${runs}b`, 'extra'];
  else if (num(over.legByes) > 0) [label, kind] = [`${runs}lb`, 'extra'];
  else if (play === 'six' || runs === 6) [label, kind] = ['6', 'six'];
  else if (play === 'four' || runs === 4) [label, kind] = ['4', 'four'];
  else if (runs === 0) [label, kind] = ['•', 'dot'];
  else [label, kind] = [String(runs), 'run'];

  return {
    id: str(item.id),
    sequence: num(item.sequence),
    period: num(item.period) || num(innings.number),
    team: str(obj(item.team).abbreviation),
    over: num(over.number),
    overs: str(over.overs),
    label,
    kind,
    short: str(item.shortText),
    text: str(item.text).replace(/<[^>]+>/g, ''),
    runs: num(innings.runs),
    wickets: num(innings.wickets),
    balls: num(innings.balls),
    ballLimit: num(innings.ballLimit),
    remainingBalls: num(innings.remainingBalls),
    target: num(innings.target),
    overRuns: num(over.runs),
    batter,
    partner: creasePlayer(item.otherBatsman),
    bowler,
    dismissal: wicket ? str(dismissal.text) : '',
    dismissedId: wicket ? str(obj(obj(dismissal.batsman).athlete).id) : '',
  };
}

export interface CommentaryPage {
  balls: Ball[];
  pageCount: number;
}

export async function fetchCommentaryPage(league: string, event: string, page: number, signal?: AbortSignal): Promise<CommentaryPage> {
  const data = await getJson(`${SITE}/${league}/playbyplay?event=${event}&page=${page}`, signal);
  const commentary = obj(data.commentary);
  return {
    balls: arr(commentary.items).map(parseBall).filter((b): b is Ball => b !== null),
    pageCount: Math.max(1, num(commentary.pageCount)),
  };
}

/** Everything bowled so far (up to the most recent {@link MAX_PAGES} pages), oldest first. */
export async function fetchAllBalls(league: string, event: string, signal?: AbortSignal): Promise<CommentaryPage> {
  const first = await fetchCommentaryPage(league, event, 1, signal);
  const from = Math.max(2, first.pageCount - MAX_PAGES + 2);
  const pages = Array.from({ length: Math.max(0, first.pageCount - from + 1) }, (_, i) => from + i);
  const rest = await Promise.all(pages.map((page) => fetchCommentaryPage(league, event, page, signal)));
  return { balls: mergeBalls(first.pageCount > MAX_PAGES ? [] : first.balls, rest.flatMap((p) => p.balls)), pageCount: first.pageCount };
}

/** Adds newly fetched balls to the ones already held, without duplicates, in bowling order. */
export function mergeBalls(held: Ball[], fresh: Ball[]): Ball[] {
  const byId = new Map(held.map((b) => [b.id, b]));
  for (const ball of fresh) byId.set(ball.id, ball);
  return [...byId.values()].sort((a, b) => a.period - b.period || a.sequence - b.sequence);
}

// ---------- Scorecards ----------

function statsOf(raw: unknown): Record<string, string> {
  const stats: Record<string, string> = {};
  for (const category of arr(obj(obj(raw).statistics).categories)) {
    for (const stat of arr(obj(category).stats)) stats[str(obj(stat).name)] = str(obj(stat).displayValue);
  }
  return stats;
}

const DISMISSAL_CODES: Record<string, string> = { c: 'caught', b: 'bowled', lbw: 'lbw', ro: 'run out', st: 'stumped', hw: 'hit wicket', rh: 'retired hurt', ro1: 'run out' };

/** "AJ Hosein c Ishan Kishan b Patel 15 (17m 9b ...)" → "c Ishan Kishan b Patel". */
export function howOutFromText(text: string): string {
  const match = /\s((?:c & b|c|b|lbw|st|run out|hit wicket|retired|obstructing|handled|timed out)\b.*?)\s\d+\s\(/.exec(text);
  return match ? match[1]!.replace(/†/g, '').trim() : '';
}

/** Builds one card per innings from the match summary's rosters. `balls` supplies how each batter got out. */
export function parseCards(summary: Json, balls: Ball[]): InningsCard[] {
  const rosters = arr(summary.rosters).map(obj);
  const howOut = new Map<string, string>();
  for (const ball of balls) if (ball.dismissedId) howOut.set(`${ball.period}:${ball.dismissedId}`, howOutFromText(ball.dismissal));

  const cards = new Map<number, InningsCard>();
  const cardFor = (period: number): InningsCard => {
    let card = cards.get(period);
    if (!card) cards.set(period, (card = { period, battingAbbr: '', bowlingAbbr: '', batters: [], yetToBat: [], bowlers: [] }));
    return card;
  };
  const positions = new Map<object, number>();

  for (const roster of rosters) {
    const abbr = str(obj(roster.team).abbreviation);
    for (const raw of arr(roster.roster)) {
      const player = obj(raw);
      const athlete = obj(player.athlete);
      const name = str(athlete.displayName) || str(athlete.name);
      for (const line of arr(player.linescores)) {
        const period = num(obj(line).period);
        const stats = statsOf(line);
        if (!period) continue;
        const card = cardFor(period);

        if (num(stats.batted) > 0) {
          card.battingAbbr = abbr;
          const out = num(stats.outs) > 0;
          const batter: BatterLine = {
            id: str(athlete.id),
            name,
            runs: num(stats.runs),
            balls: num(stats.ballsFaced),
            fours: num(stats.fours),
            sixes: num(stats.sixes),
            strikeRate: stats.strikeRate && stats.strikeRate !== '-' ? stats.strikeRate : '0.00',
            out,
            howOut: out ? howOut.get(`${period}:${str(athlete.id)}`) || DISMISSAL_CODES[stats.dismissalCard ?? ''] || 'out' : 'not out',
            captain: player.captain === true,
            keeper: str(obj(player.position).abbreviation) === 'WK',
          };
          positions.set(batter, num(stats.battingPosition) || 99);
          card.batters.push(batter);
        } else if (num(stats.inningsFielded) === 0 && stats.batted !== undefined && num(stats.inningsBowled) === 0) {
          // In the XI for this innings' batting side, but not yet at the crease.
          card.yetToBat.push(name);
        }

        if (num(stats.inningsBowled) > 0 || num(stats.balls) > 0) {
          card.bowlingAbbr = abbr;
          const bowler: BowlerLine = {
            id: str(athlete.id),
            name,
            overs: stats.overs ?? '0',
            maidens: num(stats.maidens),
            runs: num(stats.conceded),
            wickets: num(stats.wickets),
            economy: stats.economyRate && stats.economyRate !== '-' ? stats.economyRate : '0.00',
            dots: num(stats.dots),
          };
          positions.set(bowler, num(stats.bowlingPosition) || 99);
          card.bowlers.push(bowler);
        }
      }
    }
  }

  const byPosition = (a: object, b: object) => (positions.get(a) ?? 99) - (positions.get(b) ?? 99);
  return [...cards.values()]
    .filter((card) => card.batters.length > 0 || card.bowlers.length > 0)
    .sort((a, b) => a.period - b.period)
    .map((card) => ({ ...card, batters: card.batters.sort(byPosition), bowlers: card.bowlers.sort(byPosition) }));
}

export async function fetchCards(league: string, event: string, balls: Ball[], signal?: AbortSignal): Promise<InningsCard[]> {
  return parseCards(await getJson(`${SITE}/${league}/summary?event=${event}`, signal), balls);
}

// ---------- Derived numbers ----------

export interface OverSummary {
  over: number;
  runs: number;
  wickets: number;
}

export interface FallOfWicket {
  wicket: number;
  runs: number;
  overs: string;
  name: string;
}

export interface LiveView {
  period: number;
  /** The latest ball of the current innings; null before a ball is bowled. */
  last: Ball | null;
  thisOver: Ball[];
  recent: Ball[];
  overs: OverSummary[];
  fallOfWickets: FallOfWicket[];
  runRate: string;
  /** Null unless a side is chasing and the match is still on. */
  requiredRate: string | null;
  /** "Need 24 from 12 balls" while chasing. */
  equation: string | null;
  /** Projected total at the current rate, first innings of a limited-overs match only. */
  projected: number | null;
  partnership: { runs: number; balls: number } | null;
}

const perOver = (runs: number, balls: number) => (balls > 0 ? ((runs * 6) / balls).toFixed(2) : '0.00');

/** Everything the layouts show that is worked out from the balls rather than read off the feed. */
export function liveView(balls: Ball[], target: number): LiveView {
  const period = balls.length ? balls[balls.length - 1]!.period : 1;
  const innings = balls.filter((b) => b.period === period);
  const last = innings[innings.length - 1] ?? null;

  const overs: OverSummary[] = [];
  const fallOfWickets: FallOfWicket[] = [];
  for (const ball of innings) {
    let over = overs[overs.length - 1];
    if (!over || over.over !== ball.over) overs.push((over = { over: ball.over, runs: 0, wickets: 0 }));
    over.runs = ball.overRuns;
    if (ball.kind === 'wicket') {
      over.wickets += 1;
      const name = ball.dismissal ? ball.dismissal.split(/\s(?:c & b|c|b|lbw|st|run out|hit wicket|retired)\b/)[0]! : (ball.batter?.name ?? '');
      fallOfWickets.push({ wicket: ball.wickets, runs: ball.runs, overs: ball.overs, name: name.trim() });
    }
  }

  const lastWicket = [...innings].reverse().find((b) => b.kind === 'wicket');
  const chasing = (last?.target || target) > 0 ? last?.target || target : 0;
  const need = last && chasing ? chasing - last.runs : 0;
  const live = last !== null && last.wickets < 10 && (last.ballLimit === 0 || last.remainingBalls > 0);

  return {
    period,
    last,
    thisOver: last ? innings.filter((b) => b.over === last.over) : [],
    recent: innings.slice(-18),
    overs,
    fallOfWickets,
    runRate: last ? perOver(last.runs, last.balls) : '0.00',
    requiredRate: last && need > 0 && live && last.remainingBalls > 0 ? perOver(need, last.remainingBalls) : null,
    equation:
      last && need > 0 && live && last.remainingBalls > 0
        ? `Need ${need} from ${last.remainingBalls} ball${last.remainingBalls === 1 ? '' : 's'}`
        : null,
    projected: last && !chasing && live && last.ballLimit > 0 && last.balls >= 6 ? Math.round((last.runs / last.balls) * last.ballLimit) : null,
    partnership: last && live ? { runs: last.runs - (lastWicket?.runs ?? 0), balls: last.balls - (lastWicket?.balls ?? 0) } : null,
  };
}
