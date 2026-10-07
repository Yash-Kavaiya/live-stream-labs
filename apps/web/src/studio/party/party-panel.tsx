import {
  addScore,
  changeScore,
  MAX_QUEUE,
  MAX_SCORES,
  moveInQueue,
  nextInQueue,
  pollLeader,
  pollTotals,
  rankedScores,
  removeScore,
  scoreLeader,
  type Party,
  type PartyItem,
  type Scene,
} from '@studio/shared';
import { Button, Icon, IconButton, Slider, Switch, TextField } from '@studio/ui';
import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/format';
import type { PartyControls } from './use-party';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const REACTIONS = ['👏', '😂', '❤️', '🔥', '😮', '🎉', '👍', '💯'];
const VIDEO_TYPES = 'video/mp4,video/webm,.mp4,.webm,.m4v,.mov';

interface Props {
  scene: Scene;
  update: SceneUpdater;
  party: PartyControls;
  /** Names of the people on stage, for the scoreboard's one-click add. */
  stageNames: string[];
}

function Queue({ scene, setParty, party }: { scene: Scene; setParty(change: (party: Party) => Party): void; party: PartyControls }) {
  const { queue, playing } = scene.party;
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const full = queue.length >= MAX_QUEUE;

  const addLink = () => {
    const problem = party.addLink(title, url);
    setLinkError(problem);
    if (!problem) {
      setTitle('');
      setUrl('');
    }
  };

  const row = (item: PartyItem, index: number) => {
    const isPlaying = playing?.itemId === item.id;
    const needsFile = item.kind === 'file' && !party.ready.has(item.id);
    return (
      <div key={item.id} className={`banner-item party-item ${isPlaying ? 'shown' : ''}`} data-testid="party-item">
        <div className="party-row">
          <span className="rundown-number label-medium">{index + 1}</span>
          <Icon name={item.kind === 'file' ? 'movie' : 'link'} />
          <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
            <span className="body-medium truncate" title={item.title}>{item.title}</span>
            <span className="body-small truncate" style={{ opacity: 0.75 }}>
              {isPlaying ? 'Playing' : item.kind === 'link' ? new URL(item.url).hostname.replace(/^www\./, '') : needsFile ? 'File needed' : 'Video file'}
            </span>
          </span>
          {needsFile ? (
            <label className="file-button timer-chip music-chip" title="The file is on your computer and has to be chosen again after a reload">
              <input type="file" accept={VIDEO_TYPES} data-testid="party-attach" onChange={(e) => { const file = e.target.files?.[0]; if (file) party.attachFile(item.id, file); e.target.value = ''; }} />
              Choose file
            </label>
          ) : (
            <IconButton icon={item.kind === 'link' ? 'open_in_new' : 'play_arrow'} label={item.kind === 'link' ? 'Open to share' : 'Play'} variant={isPlaying ? 'standard' : 'tonal'} onClick={() => party.play(item)} data-testid="party-play" />
          )}
          <IconButton icon="arrow_upward" label="Move up" disabled={index === 0} onClick={() => setParty((p) => moveInQueue(p, item.id, -1))} />
          <IconButton icon="arrow_downward" label="Move down" disabled={index === queue.length - 1} onClick={() => setParty((p) => moveInQueue(p, item.id, 1))} />
          <IconButton icon="delete" label="Remove from queue" onClick={() => party.remove(item.id)} data-testid="party-remove" />
        </div>
        {party.error?.id === item.id && <span className="body-small party-note" style={{ color: 'var(--md-sys-color-error)' }}>{party.error.message}</span>}
      </div>
    );
  };

  return (
    <section className="col" data-testid="party-queue">
      <h3 className="title-small">Queue</h3>
      {queue.length === 0 && <p className="body-medium muted">Line up what you will watch: video files from your computer, and links to share from their own window.</p>}
      <div className="col" style={{ gap: 6 }}>{queue.map(row)}</div>

      <label className={`file-button timer-chip music-chip ${full ? 'disabled' : ''}`} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center' }}>
        <input type="file" accept={VIDEO_TYPES} multiple disabled={full} data-testid="party-add-files" onChange={(e) => { if (e.target.files) party.addFiles(Array.from(e.target.files)); e.target.value = ''; }} />
        <Icon name="video_file" />
        Add video files
      </label>
      <TextField label="Link title" value={title} onValue={setTitle} maxLength={80} placeholder="What viewers will see" data-testid="party-link-title" />
      <div className="row" style={{ gap: 4, alignItems: 'flex-start' }}>
        <TextField label="Link (YouTube, X, any page)" type="url" value={url} onValue={setUrl} onEnter={addLink} error={linkError ?? undefined} maxLength={500} style={{ flex: 1 }} data-testid="party-link-url" />
        <IconButton icon="add" label="Add link" onClick={addLink} disabled={!url.trim() || full} data-testid="party-add-link" />
      </div>
      <p className="body-small muted">
        Files play inside the studio and stay on your computer. A link opens in its own window: share
        that window, with its sound, using the screen share button.
      </p>
    </section>
  );
}

function Player({ scene, setParty, party }: { scene: Scene; setParty(change: (party: Party) => Party): void; party: PartyControls }) {
  const { playing, autoAdvance, showBar } = scene.party;
  const [position, setPosition] = useState(0);
  const isFile = playing?.kind === 'file';
  const paused = playing?.pausedAt !== null;
  const next = nextInQueue(scene.party, playing?.itemId ?? null);

  useEffect(() => {
    if (!isFile) return;
    const timer = setInterval(() => setPosition(party.position()), 500);
    return () => clearInterval(timer);
  }, [isFile, party]);

  return (
    <section className="col" data-testid="party-player">
      <h3 className="title-small">Now playing</h3>
      {!playing && <p className="body-medium muted">Nothing is playing. Press play on an item in the queue{next ? ', or start from the top.' : '.'}</p>}
      {playing && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <Icon name={isFile ? 'movie' : 'link'} />
            <span className="body-large truncate grow" data-testid="party-now-title">{playing.title}</span>
            {isFile && <span className="label-large" data-testid="party-time">{formatDuration(position)} / {formatDuration(playing.duration)}</span>}
          </div>
          {isFile && playing.duration > 0 && (
            <input
              type="range"
              className="party-seek"
              aria-label="Position in the video"
              min={0}
              max={Math.floor(playing.duration)}
              value={Math.min(Math.floor(position), Math.floor(playing.duration))}
              onChange={(e) => { const to = Number(e.target.value); setPosition(to); party.seek(to); }}
              data-testid="party-seek"
            />
          )}
          {!isFile && <p className="body-small muted">This is a link. Control it in its own window; the studio only shows its title.</p>}
        </>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        {isFile && (
          <>
            <IconButton icon={paused ? 'play_arrow' : 'pause'} label={paused ? 'Resume' : 'Pause'} variant="filled" onClick={party.togglePause} data-testid="party-pause" />
            <IconButton icon="replay" label="Start again from the beginning" variant="tonal" onClick={() => party.seek(0)} data-testid="party-restart" />
          </>
        )}
        <Button variant="tonal" icon="skip_next" onClick={party.next} disabled={!next} data-testid="party-next">
          {playing ? 'Next' : 'Start'}
        </Button>
        {playing && (
          <Button variant="text" icon="stop" onClick={party.stop} data-testid="party-stop">
            Stop
          </Button>
        )}
      </div>
      {next && <span className="body-small muted">Next: {next.title}</span>}
      <Slider label="Video volume" value={Math.round(party.volume * 100)} onValue={(v) => party.setVolume(v / 100)} min={0} max={100} format={(v) => `${v}%`} data-testid="party-volume" />
      <Switch label="Play the next file when one ends" selected={autoAdvance} onChange={(on) => setParty((p) => ({ ...p, autoAdvance: on }))} data-testid="party-auto" />
      <Switch label="Show the now-playing bar" selected={showBar} onChange={(on) => setParty((p) => ({ ...p, showBar: on }))} data-testid="party-bar" />
    </section>
  );
}

function PollSection({ scene, setParty, party }: { scene: Scene; setParty(change: (party: Party) => Party): void; party: PartyControls }) {
  const { poll } = scene.party;
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const filled = options.filter((o) => o.trim()).length;

  const start = () => {
    if (!party.startPoll(question, options)) return;
    setQuestion('');
    setOptions(['', '', '', '']);
  };
  const setPoll = (change: (poll: NonNullable<Party['poll']>) => Party['poll']) => setParty((p) => (p.poll ? { ...p, poll: change(p.poll) } : p));
  const handVote = (index: number, delta: number) =>
    setPoll((current) => ({ ...current, hand: current.options.map((_, i) => Math.max(0, (current.hand[i] ?? 0) + (i === index ? delta : 0))) }));

  if (poll) {
    const totals = pollTotals(poll);
    const all = totals.reduce((sum, n) => sum + n, 0);
    const leader = pollLeader(poll);
    return (
      <section className="col" data-testid="party-poll">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 className="title-small">Poll</h3>
          <span className={`chip ${poll.open ? 'primary' : ''}`}>{poll.open ? 'Open' : 'Closed'} · {all} {all === 1 ? 'vote' : 'votes'}</span>
        </div>
        <p className="body-large">{poll.question}</p>
        {poll.options.map((option, index) => (
          <div key={index} className="party-row party-vote" data-testid="poll-option">
            <span className="rundown-number label-large">{index + 1}</span>
            <span className={`body-medium grow truncate ${!poll.open && leader === index ? 'party-leading' : ''}`}>{option}</span>
            <span className="label-large" data-testid="poll-count">{totals[index]}</span>
            <IconButton icon="remove" label={`Take a vote from ${option}`} disabled={!poll.open || (poll.hand[index] ?? 0) === 0} onClick={() => handVote(index, -1)} />
            <IconButton icon="add" label={`Add a vote for ${option}`} variant="tonal" disabled={!poll.open} onClick={() => handVote(index, 1)} data-testid="poll-add" />
          </div>
        ))}
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="tonal" icon={poll.open ? 'lock' : 'lock_open'} onClick={() => setPoll((current) => ({ ...current, open: !current.open }))} data-testid="poll-close">
            {poll.open ? 'Close poll' : 'Reopen'}
          </Button>
          <Button variant="text" icon={poll.show ? 'visibility_off' : 'visibility'} onClick={() => setPoll((current) => ({ ...current, show: !current.show }))} data-testid="poll-show">
            {poll.show ? 'Hide' : 'Show'}
          </Button>
          <Button variant="text" danger icon="delete" onClick={() => setParty((p) => ({ ...p, poll: null }))} data-testid="poll-remove">
            Remove
          </Button>
        </div>
        <p className="body-small muted">
          While you are live, viewers vote by typing the answer's number in Twitch chat, or in
          YouTube chat when YouTube is connected with one click. The + buttons add votes by hand.
        </p>
      </section>
    );
  }

  return (
    <section className="col" data-testid="party-poll">
      <h3 className="title-small">Poll</h3>
      <TextField label="Question" value={question} onValue={setQuestion} maxLength={120} data-testid="poll-question" />
      <div className="field-pair">
        {options.map((option, index) => (
          <TextField
            key={index}
            label={`Answer ${index + 1}${index > 1 ? ' (optional)' : ''}`}
            value={option}
            onValue={(value) => setOptions(options.map((o, i) => (i === index ? value : o)))}
            maxLength={60}
            onEnter={start}
            data-testid={`poll-answer-${index + 1}`}
          />
        ))}
      </div>
      <div>
        <Button icon="how_to_vote" onClick={start} disabled={!question.trim() || filled < 2} data-testid="poll-start">
          Start poll
        </Button>
      </div>
    </section>
  );
}

function Scoreboard({ scene, update, setParty, stageNames }: { scene: Scene; update: SceneUpdater; setParty(change: (party: Party) => Party): void; stageNames: string[] }) {
  const { scores, showScores } = scene.party;
  const [name, setName] = useState('');
  const leader = scoreLeader(scores);
  const full = scores.length >= MAX_SCORES;
  const missing = stageNames.filter((n) => !scores.some((s) => s.name.toLowerCase() === n.trim().toLowerCase()));

  const add = () => {
    if (!name.trim()) return;
    setParty((p) => addScore(p, name));
    setName('');
  };
  const celebrate = () => {
    if (!leader) return;
    update((s) => ({ ...s, celebration: { id: crypto.randomUUID(), kind: 'winner', emoji: '🏆', text: leader.name.slice(0, 40), at: Date.now() } }));
  };

  return (
    <section className="col" data-testid="party-scores">
      <h3 className="title-small">Scoreboard</h3>
      {rankedScores(scores).map((score) => (
        <div key={score.name} className="party-row party-vote" data-testid="score-row">
          <span className="body-medium grow truncate">{score.name}</span>
          <span className="title-medium" data-testid="score-points">{score.points}</span>
          <IconButton icon="remove" label={`Take a point from ${score.name}`} onClick={() => setParty((p) => changeScore(p, score.name, -1))} />
          <IconButton icon="add" label={`Give ${score.name} a point`} variant="tonal" onClick={() => setParty((p) => changeScore(p, score.name, 1))} data-testid="score-plus" />
          <button type="button" className="timer-chip" title={`Give ${score.name} five points`} onClick={() => setParty((p) => changeScore(p, score.name, 5))} data-testid="score-plus-5">+5</button>
          <IconButton icon="close" label={`Remove ${score.name}`} onClick={() => setParty((p) => removeScore(p, score.name))} />
        </div>
      ))}
      {missing.length > 0 && !full && (
        <div>
          <Button variant="tonal" icon="group_add" onClick={() => setParty((p) => missing.reduce(addScore, p))} data-testid="score-add-stage">
            Add everyone on stage
          </Button>
        </div>
      )}
      <div className="row" style={{ gap: 4, alignItems: 'flex-start' }}>
        <TextField label="Name" value={name} onValue={setName} onEnter={add} maxLength={24} style={{ flex: 1 }} data-testid="score-name" />
        <IconButton icon="add" label="Add to the scoreboard" onClick={add} disabled={!name.trim() || full} data-testid="score-add" />
      </div>
      <Switch label="Show the scoreboard on screen" selected={showScores} onChange={(on) => setParty((p) => ({ ...p, showScores: on }))} data-testid="score-show" />
      <div className="row wrap" style={{ gap: 8 }}>
        <Button icon="emoji_events" onClick={celebrate} disabled={!leader} data-testid="score-celebrate">
          {leader ? `Celebrate ${leader.name}` : 'Celebrate the leader'}
        </Button>
        {scores.some((s) => s.points !== 0) && (
          <Button variant="text" icon="restart_alt" onClick={() => setParty((p) => ({ ...p, scores: p.scores.map((s) => ({ ...s, points: 0 })) }))}>
            Reset points
          </Button>
        )}
      </div>
    </section>
  );
}

/** The watch party's page: the queue to run the show from, and the ways for everyone to take part. */
export function PartyPanel({ scene, update, party, stageNames }: Props) {
  const [winner, setWinner] = useState('');
  const setParty = (change: (party: Party) => Party) => update((s) => ({ ...s, party: change(s.party) }));
  const celebrate = (kind: 'winner' | 'reaction', emoji: string, text: string) =>
    update((s) => ({ ...s, celebration: { id: crypto.randomUUID(), kind, emoji, text, at: Date.now() } }));

  return (
    <div className="col" style={{ gap: 24 }}>
      <Queue scene={scene} setParty={setParty} party={party} />
      <Player scene={scene} setParty={setParty} party={party} />
      <PollSection scene={scene} setParty={setParty} party={party} />

      <section className="col">
        <h3 className="title-small">Reactions</h3>
        <div className="reaction-row" role="group" aria-label="Send a reaction">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="reaction-button" aria-label={`React with ${emoji}`} data-testid="reaction" onClick={() => { celebrate('reaction', emoji, ''); party.react(); }}>
              {emoji}
            </button>
          ))}
        </div>
        <Switch label="Show the hype meter" selected={scene.party.showHype} onChange={(on) => setParty((p) => ({ ...p, showHype: on }))} data-testid="party-hype" />
        <p className="body-small muted">
          While you are live, emoji that viewers send in chat float up over the video and fill the
          meter. Your own reactions fill it too.
        </p>
      </section>

      <Scoreboard scene={scene} update={update} setParty={setParty} stageNames={stageNames} />

      <section className="col">
        <h3 className="title-small">Winner celebration</h3>
        <TextField label="Winner's name" value={winner} onValue={setWinner} maxLength={40} onEnter={() => celebrate('winner', '🏆', winner.trim())} data-testid="winner-name" />
        <div>
          <Button variant="tonal" icon="emoji_events" onClick={() => celebrate('winner', '🏆', winner.trim())} data-testid="celebrate-winner">
            Celebrate winner
          </Button>
        </div>
        <p className="body-small muted">Trophy, confetti and the name over the whole frame for about six seconds.</p>
      </section>
    </div>
  );
}
