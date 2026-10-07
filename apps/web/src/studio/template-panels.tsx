import {
  BALLS,
  CRICKET_MOMENTS,
  cricketStats,
  DEFAULT_CRICKET,
  inningsOver,
  MOMENT_HEADLINES,
  NEWS_VIEWS,
  recordBall,
  CRICKET_VIEWS,
  type Ball,
  type Cricket,
  type CricketMoment,
  type CricketView,
  type News,
  type NewsView,
  type Scene,
  type TemplateId,
} from '@studio/shared';
import { Button, Icon, Select, Switch, TextField } from '@studio/ui';
import { useEffect, useState } from 'react';
import { fetchMatches, pickDefaultMatch, type MatchRef } from '../lib/cricket-feed';
import { CleanControls } from './clean-controls';
import { momentCelebration, withInnings } from './live-cricket';
import { PartyPanel } from './party/party-panel';
import type { PartyControls } from './party/use-party';
import { RundownPanel } from './rundown/rundown-panel';
import type { RundownState } from './rundown/use-rundown';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;
interface Props {
  scene: Scene;
  update: SceneUpdater;
}

/** How the live score feed is doing, for the cricket page to show. */
export interface LiveScoreState {
  updatedAt: number | null;
  error: string | null;
}

// ---------- News room ----------

const NEWS_VIEW_INFO: Record<NewsView, { label: string; icon: string; hint: string }> = {
  anchor: { label: 'Anchor', icon: 'person', hint: 'One presenter with the story points beside them. Guests on stage take the side column.' },
  interview: { label: 'Interview', icon: 'group', hint: 'Everyone side by side in equal boxes.' },
  panel: { label: 'Panel', icon: 'grid_view', hint: 'A grid of everyone on stage, for a discussion.' },
  headline: { label: 'Headline', icon: 'campaign', hint: 'The headline fills the frame; the presenter sits in the corner.' },
};

function NewsControls({ scene, update }: Props) {
  const { news } = scene;
  const set = (patch: Partial<News>) => update((s) => ({ ...s, news: { ...s.news, ...patch } }));

  return (
    <section className="col">
      <h3 className="title-small">News scenes</h3>
      <div className="screen-grid" role="group" aria-label="News scene">
        {NEWS_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className="screen-button"
            aria-pressed={news.view === view}
            data-testid={`news-${view}`}
            onClick={() => set({ view })}
          >
            <Icon name={NEWS_VIEW_INFO[view].icon} />
            <span className="label-medium">{NEWS_VIEW_INFO[view].label}</span>
          </button>
        ))}
      </div>
      <p className="body-small muted">{NEWS_VIEW_INFO[news.view].hint}</p>

      <div className="field-pair">
        <TextField label="Channel name" value={news.channel} onValue={(channel) => set({ channel })} maxLength={24} />
        <TextField label="Tag" value={news.tag} onValue={(tag) => set({ tag })} maxLength={16} placeholder="BREAKING" />
      </div>
      <TextField label="Headline" value={news.headline} onValue={(headline) => set({ headline })} maxLength={90} data-testid="news-headline-text" />
      <TextField label="Second line" value={news.subhead} onValue={(subhead) => set({ subhead })} maxLength={120} />
      <TextField
        label="Story points (one per line)"
        type="textarea"
        rows={3}
        value={news.points}
        onValue={(points) => set({ points })}
        maxLength={300}
        supportingText="Shown beside the presenter in the Anchor scene."
      />
      <p className="body-small muted">
        A banner from the Banners tab replaces the headline while it is showing; a ticker runs along
        the bottom strip.
      </p>
    </section>
  );
}

// ---------- Cricket ----------

const BALL_LABELS: Record<string, string> = { W: 'W', wd: 'Wd', nb: 'Nb' };

const CRICKET_VIEW_INFO: Record<CricketView, { label: string; icon: string; hint: string }> = {
  match: { label: 'Strip', icon: 'videocam', hint: 'Cameras in your usual layout, with a score strip along the bottom.' },
  bug: { label: 'Corner', icon: 'picture_in_picture', hint: 'Cameras fill the frame; a small score box sits in the top-left corner.' },
  split: { label: 'Split', icon: 'vertical_split', hint: 'Cameras on the left, a tall score panel on the right.' },
  dashboard: { label: 'Board', icon: 'scoreboard', hint: 'The full scoreboard, with cameras in a column at the side.' },
  card: { label: 'Card', icon: 'table_rows', hint: 'The batting card and the bowlers, with cameras in a column at the side.' },
};

/** Chooses the real match the scoreboard follows. The list is fetched when this first shows. */
function LiveMatchPicker({ cricket, set, liveScore }: { cricket: Cricket; set(patch: Partial<Cricket>): void; liveScore?: LiveScoreState }) {
  const [matches, setMatches] = useState<MatchRef[] | null>(null);
  const [failed, setFailed] = useState(false);
  const chosen = cricket.liveMatch;

  useEffect(() => {
    const abort = new AbortController();
    fetchMatches(abort.signal).then(
      (list) => {
        setMatches(list);
        // Nothing chosen yet: follow the live India match if there is one.
        const first = pickDefaultMatch(list);
        if (!chosen && first) set({ liveMatch: { league: first.league, event: first.event } });
      },
      () => !abort.signal.aborted && setFailed(true),
    );
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <p className="body-medium" style={{ color: 'var(--md-sys-color-error)' }}>The match list could not be loaded. Check the internet connection and reopen this tab.</p>;
  if (!matches) return <p className="body-medium muted">Loading matches…</p>;
  if (matches.length === 0) return <p className="body-medium muted">No matches are listed right now.</p>;

  const key = (m: { league: string; event: string }) => `${m.league}:${m.event}`;
  const value = chosen && matches.some((m) => key(m) === key(chosen)) ? key(chosen) : key(matches[0]!);
  return (
    <>
      <Select
        label="Match"
        value={value}
        floatingMenu
        onValue={(next) => {
          const [league = '', event = ''] = next.split(':');
          set({ liveMatch: { league, event } });
        }}
        options={matches.map((m) => ({ value: key(m), label: `${m.state === 'in' ? '● ' : ''}${m.title} · ${m.status}` }))}
        data-testid="cricket-live-match"
      />
      <p className="body-small muted" data-testid="cricket-live-state">
        {liveScore?.error
          ? `The score feed could not be reached; the last score stays on screen. (${liveScore.error})`
          : liveScore?.updatedAt
            ? 'Following the match. The score refreshes every 5 seconds.'
            : 'Connecting to the score feed…'}
      </p>
    </>
  );
}

const MOMENT_BUTTONS: Record<Exclude<CricketMoment, 'custom'>, string> = { four: '4', six: '6', wicket: 'W', fifty: '50', hundred: '100', freehit: 'Free hit' };
const BANNER_PRESETS = ['HAT-TRICK!', 'WHAT A CATCH!', 'DRS REVIEW', 'MAIDEN OVER'];
const BANNER_EMOJI = ['📣', '🔥', '🏏', '🙌', '😱', '🎯'];

/** Boundaries, wickets and milestones as cartoons over the frame, and a banner with the host's own words. */
function CricketMoments({ scene, update }: Props) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(BANNER_EMOJI[0]!);
  const play = (moment: CricketMoment, detail = '', headline = '', picture = '') =>
    update((s) => ({ ...s, celebration: momentCelebration(moment, detail, headline, picture) }));
  const banner = (headline: string) => {
    if (headline.trim()) play('custom', '', headline.trim(), emoji);
  };

  return (
    <>
      <h3 className="title-small">Moments</h3>
      <div className="moment-pad" role="group" aria-label="Play a moment">
        {CRICKET_MOMENTS.filter((moment) => moment !== 'custom').map((moment) => (
          <button key={moment} type="button" className={`moment-button ${moment}`} title={MOMENT_HEADLINES[moment]} data-testid={`moment-${moment}`} onClick={() => play(moment)}>
            {MOMENT_BUTTONS[moment]}
          </button>
        ))}
      </div>
      <Switch
        label="Play moments automatically from the score"
        selected={scene.cricket.autoMoments}
        onChange={(autoMoments) => update((s) => ({ ...s, cricket: { ...s.cricket, autoMoments } }))}
        data-testid="cricket-auto-moments"
      />

      <span className="body-medium">Your own banner</span>
      <div className="timer-row" role="group" aria-label="Ready-made banners">
        {BANNER_PRESETS.map((preset) => (
          <button key={preset} type="button" className="timer-chip" data-testid="moment-preset" onClick={() => banner(preset)}>
            {preset}
          </button>
        ))}
      </div>
      <div className="reaction-row six" role="group" aria-label="Picture on the banner">
        {BANNER_EMOJI.map((choice) => (
          <button key={choice} type="button" className="reaction-button" aria-label={`Use ${choice}`} aria-pressed={emoji === choice} onClick={() => setEmoji(choice)}>
            {choice}
          </button>
        ))}
      </div>
      <TextField label="Banner text" value={text} onValue={setText} maxLength={40} placeholder="WHAT A SHOT!" onEnter={() => banner(text)} data-testid="moment-text" />
      <div>
        <Button variant="tonal" icon="campaign" disabled={!text.trim()} onClick={() => banner(text)} data-testid="moment-show">
          Show banner
        </Button>
      </div>
      <p className="body-small muted">A moment covers the middle of the frame for about four seconds, on every cricket layout.</p>
    </>
  );
}

function CricketControls({ scene, update, liveScore }: Props & { liveScore?: LiveScoreState }) {
  const c = scene.cricket;
  const live = c.source === 'live';
  const stats = cricketStats(c);
  const set = (patch: Partial<Cricket>) => update((s) => ({ ...s, cricket: { ...s.cricket, ...patch } }));
  const score = (ball: Ball) => update((s) => withInnings(s, recordBall(s.cricket, ball)));
  const setBatter = (index: 0 | 1, name: string) =>
    update((s) => {
      const batters: Cricket['batters'] = [{ ...s.cricket.batters[0] }, { ...s.cricket.batters[1] }];
      batters[index].name = name;
      return { ...s, cricket: { ...s.cricket, batters } };
    });
  // Whole numbers only; an empty field means "no target".
  const number = (text: string, max: number) => Math.min(max, Math.max(0, Number.parseInt(text.replace(/\D/g, ''), 10) || 0));

  const startChase = () =>
    update((s) => ({
      ...s,
      cricket: {
        ...DEFAULT_CRICKET,
        source: 'manual',
        view: s.cricket.view,
        title: s.cricket.title,
        oversLimit: s.cricket.oversLimit,
        autoMoments: s.cricket.autoMoments,
        batting: s.cricket.bowling,
        bowling: s.cricket.batting,
        target: s.cricket.runs + 1,
      },
    }));

  return (
    <section className="col">
      <h3 className="title-small">Cricket match</h3>
      <div className="screen-grid five" role="group" aria-label="Cricket layout">
        {CRICKET_VIEWS.map((view) => (
          <button key={view} type="button" className="screen-button" aria-pressed={c.view === view} data-testid={`cricket-${view}`} onClick={() => set({ view })}>
            <Icon name={CRICKET_VIEW_INFO[view].icon} />
            <span className="label-medium">{CRICKET_VIEW_INFO[view].label}</span>
          </button>
        ))}
      </div>
      <p className="body-small muted">{CRICKET_VIEW_INFO[c.view].hint}</p>

      <h3 className="title-small">Score</h3>
      <div className="segmented" role="group" aria-label="Where the score comes from" style={{ display: 'flex' }}>
        <button type="button" className="grow" style={{ justifyContent: 'center' }} aria-pressed={live} data-testid="cricket-source-live" onClick={() => set({ source: 'live' })}>
          <Icon name="sensors" /> Live match
        </button>
        <button type="button" className="grow" style={{ justifyContent: 'center' }} aria-pressed={!live} data-testid="cricket-source-manual" onClick={() => set({ source: 'manual', status: '', other: '', card: [], attack: [], overs: [], partnership: null, projected: null, colors: null })}>
          <Icon name="touch_app" /> Score by hand
        </button>
      </div>
      {live && <LiveMatchPicker cricket={c} set={set} liveScore={liveScore} />}

      <div className="score-readout" data-testid="cricket-score">
        <span className="headline">
          {c.batting} {c.runs}/{c.wickets}
        </span>
        <span className="body-medium muted">
          {stats.overs} ov · CRR {stats.runRate}
          {(live && c.status) || stats.summary ? ` · ${(live && c.status) || stats.summary}` : ''}
        </span>
      </div>

      {!live && (
        <>

      <div className="ball-pad" role="group" aria-label="Score a ball">
        {BALLS.map((ball) => (
          <button
            key={ball}
            type="button"
            className={`ball-button ${ball === 'W' ? 'wicket' : ball === 4 || ball === 6 ? 'boundary' : ''}`}
            disabled={inningsOver(c)}
            data-testid={`ball-${ball}`}
            onClick={() => score(ball)}
          >
            {BALL_LABELS[String(ball)] ?? ball}
          </button>
        ))}
      </div>
      <div className="row wrap">
        <Button variant="tonal" icon="swap_horiz" onClick={() => set({ striker: c.striker === 0 ? 1 : 0 })}>
          Swap strike
        </Button>
        <Button variant="tonal" icon="sports_cricket" onClick={() => set({ bowler: { name: 'Bowler', balls: 0, runs: 0, wickets: 0 } })}>
          New bowler
        </Button>
      </div>

      <TextField label="Match title" value={c.title} onValue={(title) => set({ title })} maxLength={40} />
      <div className="field-pair">
        <TextField label="Batting" value={c.batting} onValue={(batting) => set({ batting })} maxLength={24} />
        <TextField label="Bowling" value={c.bowling} onValue={(bowling) => set({ bowling })} maxLength={24} />
      </div>
      <div className="field-pair">
        <TextField label={`Batter${c.striker === 0 ? ' (on strike)' : ''}`} value={c.batters[0].name} onValue={(name) => setBatter(0, name)} maxLength={24} />
        <TextField label={`Batter${c.striker === 1 ? ' (on strike)' : ''}`} value={c.batters[1].name} onValue={(name) => setBatter(1, name)} maxLength={24} />
      </div>
      <TextField label="Bowler" value={c.bowler.name} onValue={(name) => set({ bowler: { ...c.bowler, name } })} maxLength={24} />
      <div className="field-pair">
        <TextField label="Overs" value={String(c.oversLimit)} onValue={(text) => set({ oversLimit: Math.max(1, number(text, 90)) })} />
        <TextField
          label="Target"
          value={c.target === null ? '' : String(c.target)}
          onValue={(text) => set({ target: text.trim() ? number(text, 9999) : null })}
          placeholder="First innings"
        />
      </div>
      <div className="row wrap">
        <Button variant="outlined" icon="flag" onClick={startChase} data-testid="cricket-chase">
          Start the chase
        </Button>
        <Button variant="text" danger icon="restart_alt" onClick={() => set({ ...DEFAULT_CRICKET, source: 'manual', view: c.view, autoMoments: c.autoMoments })} data-testid="cricket-reset">
          Reset
        </Button>
      </div>
      <p className="body-small muted">
        Tap a ball to score it. Start the chase swaps the teams and sets the target to one more than
        this total.
      </p>
        </>
      )}

      <CricketMoments scene={scene} update={update} />
    </section>
  );
}

// ---------- Watch party ----------

/** The studio tab that belongs to each template. */
export const TEMPLATE_PAGES: Record<TemplateId, { label: string; icon: string }> = {
  none: { label: 'Layout', icon: 'view_quilt' },
  newsroom: { label: 'News', icon: 'newspaper' },
  cricket: { label: 'Cricket', icon: 'sports_cricket' },
  watchparty: { label: 'Party', icon: 'celebration' },
};

/** The page of controls for whichever template is active. The clean look's page is the layout designer. */
export function TemplatePage(props: Props & { broadcastId: string; liveScore?: LiveScoreState; rundown?: RundownState; party?: PartyControls; stageNames?: string[] }) {
  switch (props.scene.template) {
    case 'none':
      return <CleanControls {...props} />;
    case 'newsroom':
      return (
        <div className="panel-scroll col" style={{ gap: 20 }}>
          {props.rundown && <RundownPanel scene={props.scene} update={props.update} state={props.rundown} />}
          <NewsControls {...props} />
        </div>
      );
    case 'cricket':
      return (
        <div className="panel-scroll col">
          <CricketControls {...props} />
        </div>
      );
    case 'watchparty':
      return (
        <div className="panel-scroll col">
          {props.party && <PartyPanel scene={props.scene} update={props.update} party={props.party} stageNames={props.stageNames ?? []} />}
        </div>
      );
  }
}
