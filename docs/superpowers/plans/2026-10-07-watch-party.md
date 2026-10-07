# Watch Party Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Party template into a full watch-party format: a video queue with playback control, a now-playing bar, polls answered in chat, chat reactions with a hype meter, and a scoreboard that ends in the winner celebration.

**Architecture:** Everything the stream shows lives in `scene.party` and is drawn by one graphics module, so guests and the stream get it like any other graphic. All state changes are pure functions in `packages/shared/src/party.ts`. The host's browser owns the two things that cannot be in the scene: the picked video files with their player, and the list of who has voted.

**Tech Stack:** TypeScript, React, zod, Web Audio, LiveKit tracks, canvas, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-watch-party-design.md`

## Global Constraints

- No new dependency.
- Older saved scenes must still parse: `scene.party` has a default.
- Chat text is untrusted: votes and emoji are extracted by strict rules, nothing from chat is drawn as text.
- The scene is not saved more than once every two seconds for reactions, and never per second for progress.
- Limits: queue 30, poll answers 2 to 4, scores 8, burst 12 emoji, title 80, question 120, answer 60, name 24.
- `./run.sh check` passes at each checkpoint. Commit only when the user asks.

## Review Focus

1. A chat message like "1 more thing" or "11" or "5" on a four-answer poll: not a vote.
2. The same viewer votes twice, or on two platforms with the same name: one vote per platform and author; the later replaces the earlier.
3. A file ends while auto-advance is on and the next item is a link or a file that needs choosing again: playback stops cleanly, no pop-up is attempted.
4. The host seeks or pauses: every client's progress line agrees within a second, without extra saves.
5. A chat flood of emoji: one burst of at most twelve every two seconds, hype capped at 100.

---

### Task 1: Party state and its rules (shared)

**Files:** Create `packages/shared/src/party.ts`, `party.test.ts`. Modify `packages/shared/src/scene.ts` (`party` field, `DEFAULT_SCENE`), `index.ts`.

**Produces:**

```ts
export const partySchema, DEFAULT_PARTY; export type Party, PartyItem, PartyPlaying, Poll, Score, Burst;
// queue
export function addToQueue(party: Party, item: PartyItem): Party;           // ignores a 31st
export function removeFromQueue(party: Party, id: string): Party;           // also stops it if it is playing
export function moveInQueue(party: Party, id: string, by: -1 | 1): Party;
export function nextInQueue(party: Party, afterId: string | null): PartyItem | null;
// playback
export function startPlaying(party: Party, item: PartyItem, duration: number, now: number): Party;
export function pausePlaying(party: Party, now: number): Party;
export function resumePlaying(party: Party, now: number): Party;
export function seekPlaying(party: Party, position: number, now: number): Party;
export function stopPlaying(party: Party): Party;
export function playbackPosition(playing: PartyPlaying, now: number): number;  // seconds, clamped to 0..duration
// polls
export function createPoll(id: string, question: string, options: string[]): Poll | null;  // null unless 2..4 non-empty answers
export function parseVote(text: string, optionCount: number): number | null;   // 0-based
export function countVotes(voters: Map<string, number>, optionCount: number): number[];
export function pollTotals(poll: Poll): number[];
export function pollLeader(poll: Poll): number | null;                         // null with no votes
// reactions
export function extractEmojis(text: string, max?: number): string[];
export function nextHype(level: number, reactions: number): number;            // one two-second step
// scores
export function addScore(party: Party, name: string): Party;                  // trims, ignores duplicates and a 9th
export function changeScore(party: Party, name: string, delta: number): Party;
export function removeScore(party: Party, name: string): Party;
export function scoreLeader(scores: Score[]): Score | null;
export function rankedScores(scores: Score[]): Score[];
```

- [ ] Write `party.test.ts` covering every Review Focus line and each function; run it; watch it fail.
- [ ] Implement; run `npx vitest run packages/shared`. Expected: PASS.

### Task 2: The file player

**Files:** Create `apps/web/src/studio/party/player.ts`.

**Produces:** `class PartyPlayer` with `load(room, file): Promise<number>` (duration), `play()`, `pause()`, `seek(seconds)`, `setVolume(0..1)`, `stop()`, `position`, `onEnded`. The video element feeds a gain node; the gain's output is published as the clip audio track and also goes to the host's speakers; the element's captured picture is published as the clip video track. `stop` unpublishes and releases the object URL.

- [ ] Implement. It needs a browser and a room, so it is covered by the end-to-end test in Task 5.

### Task 3: Graphics

**Files:** Create `apps/web/src/studio/graphics/party.ts`. Modify `graphics/celebration.ts` (export the emoji sprite helper), `compositor.ts` (call `drawParty` for the watch party template, in place of the pill).

**Produces:** `export function drawParty(p: Painter, scene: Scene, now: number, wallNow: number): void` drawing the pill and now-playing bar, up-next card, poll card, leaderboard card, hype meter and reaction burst as the spec places them.

- [ ] Implement; check each graphic in the browser with a screenshot.

### Task 4: The Party tab and the host's logic

**Files:** Create `apps/web/src/studio/party/use-party.ts`, `party-panel.tsx`. Modify `template-panels.tsx` (the `watchparty` case renders `PartyPanel`), `StudioRoom.tsx` (create the hook, pass comments and room), `styles/app.css`.

**Produces:** `useParty({ room, scene, update, comments, stageNames, enabled })` returning queue and playback actions, poll actions, `react(emoji)`, score actions, per-item file status and errors. It owns the `PartyPlayer`, the `Map<itemId, File>`, the voter map, the two-second reaction flush, and auto-advance.

- [ ] Implement the hook and the panel (sections: Queue, Player, Poll, Reactions, Scoreboard).
- [ ] Run `./run.sh check`.

### Task 5: End-to-end test and documentation

**Files:** Create `e2e/party.spec.ts`. Modify `e2e/screens.spec.ts` (choose manual scoring before clicking a ball button, which fixes the test that has failed since cricket began following live matches), `README.md`, `docs/ARCHITECTURE.md`.

- [ ] `e2e/party.spec.ts`: queue a link and a generated WebM file; play, pause, resume, next; poll with hand votes, close; add stage names to the scoreboard, score, celebrate; assert the saved scene after each.
- [ ] Run the Party, screens and studio end-to-end tests. Expected: PASS.
- [ ] Document the watch party in the README and the architecture notes.
