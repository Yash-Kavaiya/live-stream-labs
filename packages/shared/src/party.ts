/**
 * The watch party: a queue of videos, what is playing, a poll, chat reactions and a scoreboard.
 * This is the part of the scene the Party template draws, and every change to it is a pure
 * function here, so the studio, the tests and the stream all agree on the rules.
 */
import { z } from 'zod';

// ---------- Shape ----------

export const MAX_QUEUE = 30;
export const MAX_SCORES = 8;
export const MAX_BURST = 12;
const MAX_POINTS = 9999;
const MIN_POINTS = -999;

/**
 * Something to watch. A file stays on the host's computer and plays inside the studio; a link
 * opens in its own window, which the host shares.
 */
export const partyItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(['file', 'link']),
  title: z.string().min(1).max(80),
  /** A link's address. Empty for a file. */
  url: z.union([z.literal(''), z.string().max(500).regex(/^https?:\/\//i)]),
});
export type PartyItem = z.infer<typeof partyItemSchema>;

/**
 * The video on screen. Progress is not saved as it plays: every client works the position out
 * from `startedAt`, so the progress line moves without a save each second.
 */
export const partyPlayingSchema = z.object({
  itemId: z.string().max(40),
  title: z.string().max(80),
  kind: z.enum(['file', 'link']),
  /** Length in seconds. 0 when it is not known, as for a link. */
  duration: z.number().min(0).max(86_400),
  /** The moment (epoch ms) the video would have been at 0:00, given where it is now. */
  startedAt: z.number(),
  /** Where it is held, in seconds, while paused. Null while playing. */
  pausedAt: z.number().min(0).nullable(),
});
export type PartyPlaying = z.infer<typeof partyPlayingSchema>;

const votes = z.array(z.number().int().min(0).max(999_999)).max(4);

export const pollSchema = z.object({
  id: z.string().max(40),
  question: z.string().min(1).max(120),
  options: z.array(z.string().min(1).max(60)).min(2).max(4),
  /** Votes the host added by hand, one count per answer. */
  hand: votes,
  /** Votes counted from chat, one count per answer. */
  chat: votes,
  /** False once the host has closed the poll: no more votes are counted. */
  open: z.boolean(),
  /** Whether the poll card is on screen. */
  show: z.boolean(),
});
export type Poll = z.infer<typeof pollSchema>;

export const scoreSchema = z.object({
  name: z.string().min(1).max(24),
  points: z.number().int().min(MIN_POINTS).max(MAX_POINTS),
});
export type Score = z.infer<typeof scoreSchema>;

/** A handful of emoji to float up the frame. Every client plays it when it sees a new `id`. */
export const burstSchema = z.object({
  id: z.string().max(40),
  emojis: z.array(z.string().min(1).max(16)).max(MAX_BURST),
  at: z.number(),
});
export type Burst = z.infer<typeof burstSchema>;

export const partySchema = z.object({
  queue: z.array(partyItemSchema).max(MAX_QUEUE),
  playing: partyPlayingSchema.nullable(),
  /** Start the next file by itself when one ends. */
  autoAdvance: z.boolean(),
  /** While this moment (epoch ms) is in the future, the "Up next" card is on screen. */
  upNextUntil: z.number().nullable(),
  /** Whether the now-playing bar is on screen. */
  showBar: z.boolean(),
  poll: pollSchema.nullable(),
  burst: burstSchema.nullable(),
  /** How lively chat is, 0 to 100. */
  hype: z.number().int().min(0).max(100),
  showHype: z.boolean(),
  scores: z.array(scoreSchema).max(MAX_SCORES),
  showScores: z.boolean(),
});
export type Party = z.infer<typeof partySchema>;

export const DEFAULT_PARTY: Party = {
  queue: [],
  playing: null,
  autoAdvance: true,
  upNextUntil: null,
  showBar: true,
  poll: null,
  burst: null,
  hype: 0,
  showHype: true,
  scores: [],
  showScores: false,
};

// ---------- Queue ----------

export function addToQueue(party: Party, item: PartyItem): Party {
  if (party.queue.length >= MAX_QUEUE || party.queue.some((i) => i.id === item.id)) return party;
  return { ...party, queue: [...party.queue, item] };
}

/** Takes an item out of the queue. If it is the one playing, playback stops. */
export function removeFromQueue(party: Party, id: string): Party {
  if (!party.queue.some((i) => i.id === id)) return party;
  const next = { ...party, queue: party.queue.filter((i) => i.id !== id) };
  return party.playing?.itemId === id ? stopPlaying(next) : next;
}

export function moveInQueue(party: Party, id: string, by: -1 | 1): Party {
  const from = party.queue.findIndex((i) => i.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= party.queue.length) return party;
  const queue = [...party.queue];
  [queue[from], queue[to]] = [queue[to]!, queue[from]!];
  return { ...party, queue };
}

/** The item after `afterId`, or the first one when nothing has played or that item is gone. */
export function nextInQueue(party: Party, afterId: string | null): PartyItem | null {
  const index = afterId === null ? -1 : party.queue.findIndex((i) => i.id === afterId);
  return party.queue[index + 1] ?? null;
}

// ---------- Playback ----------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where the video is, in seconds, at `now`. Always 0 for something with no known length. */
export function playbackPosition(playing: PartyPlaying, now: number): number {
  if (playing.duration <= 0) return 0;
  const position = playing.pausedAt ?? (now - playing.startedAt) / 1000;
  return clamp(position, 0, playing.duration);
}

/** Puts an item on screen from its start. `duration` is 0 for a link. */
export function startPlaying(party: Party, item: PartyItem, duration: number, now: number): Party {
  const length = Number.isFinite(duration) ? clamp(duration, 0, 86_400) : 0;
  return {
    ...party,
    upNextUntil: null,
    playing: { itemId: item.id, title: item.title, kind: item.kind, duration: length, startedAt: now, pausedAt: null },
  };
}

export function pausePlaying(party: Party, now: number): Party {
  const { playing } = party;
  if (!playing || playing.pausedAt !== null) return party;
  return { ...party, playing: { ...playing, pausedAt: playbackPosition(playing, now) } };
}

export function resumePlaying(party: Party, now: number): Party {
  const { playing } = party;
  if (!playing || playing.pausedAt === null) return party;
  return { ...party, playing: { ...playing, startedAt: now - playing.pausedAt * 1000, pausedAt: null } };
}

export function seekPlaying(party: Party, position: number, now: number): Party {
  const { playing } = party;
  if (!playing) return party;
  const to = clamp(Number.isFinite(position) ? position : 0, 0, playing.duration);
  return { ...party, playing: { ...playing, startedAt: now - to * 1000, pausedAt: playing.pausedAt === null ? null : to } };
}

export function stopPlaying(party: Party): Party {
  if (!party.playing && party.upNextUntil === null) return party;
  return { ...party, playing: null, upNextUntil: null };
}

// ---------- Polls ----------

/** A new open poll, or null unless there is a question and two to four answers. Blank answers are dropped. */
export function createPoll(id: string, question: string, options: string[]): Poll | null {
  const asked = question.trim().slice(0, 120);
  const answers = options.map((o) => o.trim().slice(0, 60)).filter(Boolean).slice(0, 4);
  if (!asked || answers.length < 2) return null;
  const zeros = answers.map(() => 0);
  return { id, question: asked, options: answers, hand: zeros, chat: [...zeros], open: true, show: true };
}

/**
 * The answer a chat message votes for, counting from 0, or null. A vote is a message that is
 * nothing but the answer's number, so "1 more thing" and "11" are ordinary chat.
 */
export function parseVote(text: string, optionCount: number): number | null {
  const match = /^[#!]?([1-9])$/.exec(text.trim());
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index < optionCount ? index : null;
}

/** Votes per answer from the latest choice of each viewer. */
export function countVotes(voters: ReadonlyMap<string, number>, optionCount: number): number[] {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const choice of voters.values()) {
    if (Number.isInteger(choice) && choice >= 0 && choice < optionCount) counts[choice]! += 1;
  }
  return counts;
}

/** Hand votes plus chat votes, per answer. */
export function pollTotals(poll: Poll): number[] {
  return poll.options.map((_, i) => (poll.hand[i] ?? 0) + (poll.chat[i] ?? 0));
}

/** The answer with the most votes, the first of a tie. Null while nobody has voted. */
export function pollLeader(poll: Poll): number | null {
  const totals = pollTotals(poll);
  const best = Math.max(...totals);
  return best > 0 ? totals.indexOf(best) : null;
}

// ---------- Reactions ----------

const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/** The emoji in a chat message, each kept whole (skin tones, joined families), at most `max`. */
export function extractEmojis(text: string, max = 3): string[] {
  const found: string[] = [];
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.slice(0, 500))) {
    if (!PICTOGRAPH.test(segment) || segment.length > 16) continue;
    found.push(segment);
    if (found.length >= max) break;
  }
  return found;
}

/**
 * The hype level after one two-second step: it loses a fifth of itself, and gains eight for each
 * reaction in the step.
 */
export function nextHype(level: number, reactions: number): number {
  return clamp(Math.floor(level * 0.8) + Math.max(0, Math.floor(reactions)) * 8, 0, 100);
}

// ---------- Scoreboard ----------

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function addScore(party: Party, name: string): Party {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!clean || party.scores.length >= MAX_SCORES || party.scores.some((s) => sameName(s.name, clean))) return party;
  return { ...party, scores: [...party.scores, { name: clean, points: 0 }] };
}

export function changeScore(party: Party, name: string, delta: number): Party {
  if (!party.scores.some((s) => s.name === name)) return party;
  return {
    ...party,
    scores: party.scores.map((s) => (s.name === name ? { ...s, points: clamp(s.points + Math.round(delta), MIN_POINTS, MAX_POINTS) } : s)),
  };
}

export function removeScore(party: Party, name: string): Party {
  if (!party.scores.some((s) => s.name === name)) return party;
  return { ...party, scores: party.scores.filter((s) => s.name !== name) };
}

/** Highest points first. People level on points keep the order they were added in. */
export function rankedScores(scores: Score[]): Score[] {
  return [...scores].sort((a, b) => b.points - a.points);
}

export function scoreLeader(scores: Score[]): Score | null {
  return rankedScores(scores)[0] ?? null;
}
