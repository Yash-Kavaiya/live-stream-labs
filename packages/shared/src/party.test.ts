import { describe, expect, it } from 'vitest';
import {
  addScore,
  addToQueue,
  changeScore,
  countVotes,
  createPoll,
  DEFAULT_PARTY,
  extractEmojis,
  moveInQueue,
  nextHype,
  nextInQueue,
  parseVote,
  partySchema,
  pausePlaying,
  playbackPosition,
  pollLeader,
  pollTotals,
  rankedScores,
  removeFromQueue,
  removeScore,
  resumePlaying,
  scoreLeader,
  seekPlaying,
  startPlaying,
  stopPlaying,
  type PartyItem,
} from './party';
import { DEFAULT_SCENE, sceneSchema } from './scene';

const file = (id: string): PartyItem => ({ id, kind: 'file', title: `Clip ${id}`, url: '' });
const link = (id: string): PartyItem => ({ id, kind: 'link', title: `Link ${id}`, url: `https://example.com/${id}` });
const queued = (...items: PartyItem[]) => items.reduce(addToQueue, DEFAULT_PARTY);
const T0 = 1_000_000;

describe('scene', () => {
  it('gives a scene saved before the watch party existed the default party', () => {
    const { party: _party, ...older } = DEFAULT_SCENE;
    expect(sceneSchema.parse(older).party).toEqual(DEFAULT_PARTY);
  });

  it('accepts only web addresses for links', () => {
    const bad = { ...DEFAULT_PARTY, queue: [{ id: 'x', kind: 'link', title: 't', url: 'javascript:alert(1)' }] };
    expect(partySchema.safeParse(bad).success).toBe(false);
    expect(partySchema.safeParse(queued(link('a'), file('b'))).success).toBe(true);
  });
});

describe('queue', () => {
  it('adds up to thirty items', () => {
    let party = DEFAULT_PARTY;
    for (let i = 0; i < 35; i += 1) party = addToQueue(party, file(String(i)));
    expect(party.queue).toHaveLength(30);
  });

  it('does not add the same id twice', () => {
    expect(queued(file('a'), file('a')).queue).toHaveLength(1);
  });

  it('moves an item up and down, and stays put at the ends', () => {
    const party = queued(file('a'), file('b'), file('c'));
    expect(moveInQueue(party, 'c', -1).queue.map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(moveInQueue(party, 'a', 1).queue.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(moveInQueue(party, 'a', -1)).toBe(party);
    expect(moveInQueue(party, 'c', 1)).toBe(party);
    expect(moveInQueue(party, 'missing', 1)).toBe(party);
  });

  it('removes an item, and stops it when it is the one playing', () => {
    const playing = startPlaying(queued(file('a'), file('b')), file('a'), 60, T0);
    expect(removeFromQueue(playing, 'b').playing?.itemId).toBe('a');
    const removed = removeFromQueue(playing, 'a');
    expect(removed.queue.map((i) => i.id)).toEqual(['b']);
    expect(removed.playing).toBeNull();
  });

  it('finds what comes next', () => {
    const party = queued(file('a'), link('b'), file('c'));
    expect(nextInQueue(party, null)?.id).toBe('a');
    expect(nextInQueue(party, 'a')?.id).toBe('b');
    expect(nextInQueue(party, 'c')).toBeNull();
    // The item that was playing has been removed: start again from the top.
    expect(nextInQueue(party, 'gone')?.id).toBe('a');
    expect(nextInQueue(DEFAULT_PARTY, null)).toBeNull();
  });
});

describe('playback', () => {
  const playing = startPlaying(queued(file('a')), file('a'), 100, T0);

  it('works out the position from the clock, with no further saves', () => {
    expect(playing.playing).toMatchObject({ itemId: 'a', title: 'Clip a', kind: 'file', duration: 100, pausedAt: null });
    expect(playbackPosition(playing.playing!, T0)).toBe(0);
    expect(playbackPosition(playing.playing!, T0 + 12_500)).toBe(12.5);
  });

  it('never runs past the end or before the start', () => {
    expect(playbackPosition(playing.playing!, T0 + 999_000)).toBe(100);
    expect(playbackPosition(playing.playing!, T0 - 5000)).toBe(0);
  });

  it('holds its place while paused and carries on from there', () => {
    const paused = pausePlaying(playing, T0 + 30_000);
    expect(playbackPosition(paused.playing!, T0 + 90_000)).toBe(30);
    const resumed = resumePlaying(paused, T0 + 90_000);
    expect(resumed.playing!.pausedAt).toBeNull();
    expect(playbackPosition(resumed.playing!, T0 + 95_000)).toBe(35);
  });

  it('seeks while playing and while paused', () => {
    expect(playbackPosition(seekPlaying(playing, 70, T0 + 10_000).playing!, T0 + 12_000)).toBe(72);
    const paused = seekPlaying(pausePlaying(playing, T0 + 10_000), 55, T0 + 20_000);
    expect(playbackPosition(paused.playing!, T0 + 60_000)).toBe(55);
    expect(playbackPosition(seekPlaying(playing, 500, T0).playing!, T0)).toBe(100);
  });

  it('leaves a link without a length: there is nothing to time', () => {
    const party = startPlaying(queued(link('b')), link('b'), 0, T0);
    expect(party.playing).toMatchObject({ kind: 'link', duration: 0 });
    expect(playbackPosition(party.playing!, T0 + 60_000)).toBe(0);
  });

  it('does nothing when asked to pause, resume or seek with nothing playing', () => {
    expect(pausePlaying(DEFAULT_PARTY, T0)).toBe(DEFAULT_PARTY);
    expect(resumePlaying(DEFAULT_PARTY, T0)).toBe(DEFAULT_PARTY);
    expect(seekPlaying(DEFAULT_PARTY, 5, T0)).toBe(DEFAULT_PARTY);
  });

  it('stops, and clears the up-next card', () => {
    const stopped = stopPlaying({ ...playing, upNextUntil: T0 + 5000 });
    expect(stopped.playing).toBeNull();
    expect(stopped.upNextUntil).toBeNull();
  });

  it('starting a video takes the up-next card down', () => {
    expect(startPlaying({ ...DEFAULT_PARTY, upNextUntil: T0 + 5000 }, file('a'), 10, T0).upNextUntil).toBeNull();
  });
});

describe('polls', () => {
  it('needs a question and two to four answers', () => {
    expect(createPoll('p', 'Best model?', ['A', 'B'])).toMatchObject({ question: 'Best model?', options: ['A', 'B'], hand: [0, 0], chat: [0, 0], open: true, show: true });
    expect(createPoll('p', 'Q', ['A', ' ', 'B', '', 'C'])!.options).toEqual(['A', 'B', 'C']);
    expect(createPoll('p', 'Q', ['Only one'])).toBeNull();
    expect(createPoll('p', '  ', ['A', 'B'])).toBeNull();
    expect(createPoll('p', 'Q', ['A', 'B', 'C', 'D', 'E'])!.options).toHaveLength(4);
  });

  it.each([
    ['1', 0],
    [' 2 ', 1],
    ['#3', 2],
    ['!4', 3],
  ])('reads %j as a vote', (text, index) => {
    expect(parseVote(text, 4)).toBe(index);
  });

  it.each(['1 more thing', '11', '5', '0', '-1', '1.', 'one', '', '１', '1 2', '#', 'vote 1'])('does not read %j as a vote', (text) => {
    expect(parseVote(text, 4)).toBeNull();
  });

  it('only accepts numbers the poll has', () => {
    expect(parseVote('3', 2)).toBeNull();
    expect(parseVote('2', 2)).toBe(1);
  });

  it('counts one vote per viewer, the latest', () => {
    const voters = new Map<string, number>();
    voters.set('twitch:ann', 0);
    voters.set('twitch:bob', 1);
    voters.set('youtube:ann', 1); // A different person with the same name on another platform.
    voters.set('twitch:ann', 2); // Ann changed her mind.
    expect(countVotes(voters, 3)).toEqual([0, 2, 1]);
    // A vote for an answer the poll does not have is not counted.
    voters.set('twitch:cat', 9);
    expect(countVotes(voters, 3)).toEqual([0, 2, 1]);
  });

  it('adds hand votes and chat votes, and finds the leader', () => {
    const poll = { ...createPoll('p', 'Q', ['A', 'B', 'C'])!, hand: [1, 0, 2], chat: [0, 4, 1] };
    expect(pollTotals(poll)).toEqual([1, 4, 3]);
    expect(pollLeader(poll)).toBe(1);
    expect(pollLeader(createPoll('p', 'Q', ['A', 'B'])!)).toBeNull();
  });
});

describe('reactions', () => {
  it('picks the emoji out of a chat message, at most three', () => {
    expect(extractEmojis('lol 😂 that was 🔥🔥')).toEqual(['😂', '🔥', '🔥']);
    expect(extractEmojis('😂😂😂😂😂')).toHaveLength(3);
    expect(extractEmojis('no emoji here, just 100% text #1')).toEqual([]);
  });

  it('keeps an emoji made of several code points whole', () => {
    expect(extractEmojis('nice 👍🏽 and ❤️')).toEqual(['👍🏽', '❤️']);
    expect(extractEmojis('family 👨‍👩‍👧')).toEqual(['👨‍👩‍👧']);
    for (const emoji of extractEmojis('👨‍👩‍👧 👍🏽 ❤️')) expect(emoji.length).toBeLessThanOrEqual(16);
  });

  it('raises the hype with reactions, caps it, and lets it fall when chat goes quiet', () => {
    expect(nextHype(0, 3)).toBe(24);
    expect(nextHype(90, 50)).toBe(100);
    expect(nextHype(50, 0)).toBe(40);
    let level = 100;
    for (let i = 0; i < 40; i += 1) level = nextHype(level, 0);
    expect(level).toBe(0);
  });
});

describe('scoreboard', () => {
  it('adds people once each, up to eight', () => {
    let party = addScore(addScore(DEFAULT_PARTY, '  Ann  '), 'ann');
    expect(party.scores).toEqual([{ name: 'Ann', points: 0 }]);
    for (let i = 0; i < 12; i += 1) party = addScore(party, `Guest ${i}`);
    expect(party.scores).toHaveLength(8);
    expect(addScore(DEFAULT_PARTY, '   ')).toBe(DEFAULT_PARTY);
  });

  it('changes and removes scores, within limits', () => {
    let party = addScore(addScore(DEFAULT_PARTY, 'Ann'), 'Bob');
    party = changeScore(changeScore(party, 'Ann', 5), 'Bob', -1);
    expect(party.scores).toEqual([{ name: 'Ann', points: 5 }, { name: 'Bob', points: -1 }]);
    expect(changeScore(party, 'Ann', 99_999).scores[0]!.points).toBe(9999);
    expect(changeScore(party, 'Nobody', 1)).toBe(party);
    expect(removeScore(party, 'Ann').scores.map((s) => s.name)).toEqual(['Bob']);
  });

  it('ranks by points and names the leader, the first of a tie', () => {
    const scores = [{ name: 'Ann', points: 3 }, { name: 'Bob', points: 7 }, { name: 'Cat', points: 7 }];
    expect(rankedScores(scores).map((s) => s.name)).toEqual(['Bob', 'Cat', 'Ann']);
    expect(scoreLeader(scores)?.name).toBe('Bob');
    expect(scoreLeader([])).toBeNull();
  });
});
