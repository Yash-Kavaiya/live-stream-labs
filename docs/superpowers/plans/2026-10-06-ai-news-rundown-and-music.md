# Daily AI News Rundown, Teleprompter and Studio Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At 5 PM IST the API collects the day's AI news and writes a 15-minute show; the studio's News tab runs it story by story with a teleprompter and source cards; the Banners tab plays music beds and stings in every template.

**Architecture:** Music is host-side playback: samples are computed in plain TypeScript, played by a `MusicPlayer` whose output is both the host's speakers and a `MediaStreamTrack` that the existing `AudioMixer` already knows how to mix. The rundown is a server feature: `apps/api/src/news/` collects items from free feeds, a writer turns them into a `Rundown` (NVIDIA first, Gemini second, a no-model builder last), a timer runs it at 17:00 Asia/Kolkata, and routes serve it. The web app reads it and applies an item to `scene.news` with one pure function.

**Tech Stack:** TypeScript, React, Fastify, drizzle (PGlite/Postgres), zod, vitest, Playwright, Web Audio, `@google/genai`.

**Spec:** `docs/superpowers/specs/2026-10-06-ai-news-rundown-and-music-design.md`

## Global Constraints

- No new runtime dependency except `@google/genai` in `apps/api`.
- Keys are read from `.env` only (`NVIDIA_API_KEY`, `GEMINI_API_KEY`); never logged, never returned by a route, never committed.
- Rundown text limits equal the scene's: headline ≤ 90, subhead ≤ 120, points ≤ 300, tag ≤ 16.
- Everything read from a feed or a model is untrusted: checked, clipped, and a bad field becomes a blank, not an exception.
- A model may cite only URLs that were collected; others are dropped.
- Older saved scenes must still parse: every new scene field has a default.
- The teleprompter is ordinary page content and is never drawn on the program canvas.
- Run `./run.sh check` (typecheck, lint, unit tests) before each commit; it must pass.
- Commit only when the user asks. Each task ends with a "ready to commit" checkpoint instead of a commit.

## Review Focus

1. A feed returns HTML, an empty body or a 429: that source is skipped and named in `warnings`; the rundown is still made. (Task 5)
2. The model returns JSON wrapped in a code fence, with over-long strings or missing segments: the fence is stripped, strings are clipped, missing items are filled from the no-model builder. (Task 6)
3. The model returns a URL that was never collected: it is dropped, and an item left with no source keeps its text. (Task 6)
4. The stack starts at 18:30 IST with no rundown for today, or at 16:00: one generation starts at once in the first case, none until 17:00 in the second. (Task 7)
5. Two people press Generate now together: one generation runs, both get `generating: true`. (Task 7)

---

## File structure

| File | Responsibility |
|---|---|
| `apps/web/src/studio/music/synth.ts` | Pure: built-in track list and `renderTrack` → stereo sample arrays |
| `apps/web/src/studio/music/player.ts` | `MusicPlayer`: playback, volume, fade, ducking, output track |
| `apps/web/src/studio/music/music-panel.tsx` | The Music section of the Banners tab |
| `packages/shared/src/rundown.ts` | `Rundown` schema, segments, `applyRundownItem`, `rundownSeconds` |
| `apps/api/src/news/sources.ts` | Feed readers → `NewsItem[]`; `collectNews` |
| `apps/api/src/news/show.ts` | Show name, host and links from config |
| `apps/api/src/news/writer.ts` | Prompt, NVIDIA and Gemini calls, `sanitizeRundown`, `buildPlainRundown` |
| `apps/api/src/news/schedule.ts` | `istDate`, `nextRunAt`, `startSchedule` |
| `apps/api/src/news/service.ts` | `RundownService`: generate once at a time, store, read |
| `apps/api/src/routes/rundowns.ts` | The four rundown routes |
| `apps/web/src/studio/rundown/use-rundown.ts` | Loads the rundown, polls while generating |
| `apps/web/src/studio/rundown/rundown-panel.tsx` | List, take, next/previous, sources, add link |
| `apps/web/src/studio/rundown/teleprompter.tsx` | Host-only scrolling script |
| `apps/web/src/pages/rundown-page.tsx` | `/rundown/:date`, the printable full script |

---

## Part 1: Music

### Task 1: Built-in tracks as pure sample rendering

**Files:** Create `apps/web/src/studio/music/synth.ts`, `apps/web/src/studio/music/synth.test.ts`

**Interfaces — Produces:**

```ts
export type TrackKind = 'sting' | 'bed';
export interface BuiltInTrack { id: string; name: string; kind: TrackKind; seconds: number }
export const BUILT_IN_TRACKS: BuiltInTrack[];   // intro, breaking, transition, outro (stings); headlines, soft, countdown (beds)
/** Stereo samples in -1..1. Deterministic: the same id and rate give the same samples. */
export function renderTrack(id: string, sampleRate: number): [Float32Array, Float32Array];
```

`OfflineAudioContext` does not exist in the node test environment, so tracks are computed sample by
sample: a small `Voice` helper adds a note (frequency, start, length, wave `sine | saw | square |
noise`, gain, attack, release, pan) into the two arrays, and each track is a list of notes built
from a chord progression. Noise uses a seeded linear congruential generator, not `Math.random`.
A soft limiter (`Math.tanh`) is applied at the end. Beds are written so the last bar's release does
not run past the end, and a 20 ms fade at both ends prevents a click when looping.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { BUILT_IN_TRACKS, renderTrack } from './synth';

const RATE = 8000; // low rate keeps the test fast; the maths is rate-independent
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('built-in music', () => {
  it('has four stings and three beds', () => {
    expect(BUILT_IN_TRACKS.filter((t) => t.kind === 'sting').map((t) => t.id)).toEqual(['intro', 'breaking', 'transition', 'outro']);
    expect(BUILT_IN_TRACKS.filter((t) => t.kind === 'bed').map((t) => t.id)).toEqual(['headlines', 'soft', 'countdown']);
  });

  it.each(BUILT_IN_TRACKS)('$id is audible, the stated length, and never clips', (track) => {
    const [left, right] = renderTrack(track.id, RATE);
    expect(left.length).toBe(Math.round(track.seconds * RATE));
    expect(right.length).toBe(left.length);
    expect(rms(left)).toBeGreaterThan(0.02);
    expect(Math.max(...left.map(Math.abs), ...right.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('renders the same samples every time', () => {
    expect(renderTrack('breaking', RATE)[0]).toEqual(renderTrack('breaking', RATE)[0]);
  });

  it.each(BUILT_IN_TRACKS.filter((t) => t.kind === 'bed'))('$id starts and ends near silence so it loops without a click', (track) => {
    const [left] = renderTrack(track.id, RATE);
    expect(Math.abs(left[0]!)).toBeLessThan(0.01);
    expect(Math.abs(left[left.length - 1]!)).toBeLessThan(0.01);
  });

  it('throws on an unknown track', () => {
    expect(() => renderTrack('nope', RATE)).toThrow('Unknown track');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run apps/web/src/studio/music/synth.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `synth.ts` as described. Track designs: `intro` 6 s rising brass-like saw fanfare over a pulse, ending on a held chord; `breaking` 3 s two urgent stabs and a noise sweep; `transition` 1.5 s whoosh and one chord hit; `outro` 7 s the intro's theme resolving downward and fading; `headlines` 16 s driving eighth-note pulse with pad chords (i–VI–III–VII in D minor); `soft` 16 s slow sine pad and sparse plucks; `countdown` 16 s ticking pulse with a rising pad.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Ready-to-commit checkpoint.

### Task 2: The music player and its place in the program mix

**Files:** Create `apps/web/src/studio/music/player.ts`, `player.test.ts`. Modify `apps/web/src/studio/useLiveControl.ts`, `apps/web/src/studio/StudioRoom.tsx`.

**Interfaces — Produces:**

```ts
/** Gain the music should sit at: `volume`, or a quarter of it while someone speaks. */
export function musicLevel(volume: number, speaking: boolean, duck: boolean): number;
export interface MusicState { bed: string | null; sting: string | null; volume: number; duck: boolean; error: string | null }
export class MusicPlayer {
  readonly track: MediaStreamTrack;             // goes into AudioMixer.sync on every screen
  subscribe(listener: (state: MusicState) => void): () => void;
  play(id: string, kind: TrackKind, load: () => Promise<AudioBuffer | [Float32Array, Float32Array]>): Promise<void>;
  stop(id: string): void;
  fadeOut(): void;                               // 2 s, then stops everything
  setVolume(volume: number): void;               // 0..1, saved to localStorage 'studio.music'
  setDuck(on: boolean): void;
  setSpeaking(speaking: boolean): void;          // ramps over 300 ms
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  close(): void;
}
```

Graph: `source → trackGain (per source, for fades) → master (volume × duck) → ctx.destination` and
`master → MediaStreamDestination`. A bed loops (`source.loop = true`); starting a bed fades out the
previous one over 500 ms. A sting plays once and clears `state.sting` on `ended`. Decoded buffers are
cached by id.

- [ ] **Step 1: Failing test** (`player.test.ts`, pure part only; the class needs a browser and is covered by the end-to-end test in Task 3)

```ts
import { describe, expect, it } from 'vitest';
import { musicLevel } from './player';

describe('musicLevel', () => {
  it('is the volume when nobody speaks', () => expect(musicLevel(0.8, false, true)).toBe(0.8));
  it('drops to a quarter while someone speaks', () => expect(musicLevel(0.8, true, true)).toBeCloseTo(0.2));
  it('ignores speech when ducking is off', () => expect(musicLevel(0.8, true, false)).toBe(0.8));
  it('clamps a bad volume', () => {
    expect(musicLevel(7, false, true)).toBe(1);
    expect(musicLevel(Number.NaN, false, true)).toBe(0);
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `player.ts`.
- [ ] **Step 4:** `useLiveControl`: add `music: MediaStreamTrack | null` to `Options`; in the sync effect, append it after the stage audio so it plays on holding screens too:

```ts
const stage = sources.filter((s) => onStage.has(s.id)).flatMap((s) => s.audio);
mixer.current.sync(music ? [...stage, music] : stage);
```

  and add `music` to the effect's dependencies.
- [ ] **Step 5:** `StudioRoom`: for the host, create one `MusicPlayer` lazily (`useRef`, created on first use because an `AudioContext` needs a user gesture), close it on unmount, pass `player.track` to `useLiveControl`, and call `player.setSpeaking(view.sources.some((s) => s.speaking && scene.stage.includes(s.id)))` in an effect.
- [ ] **Step 6:** Run `./run.sh check`. Expected: PASS.
- [ ] **Step 7:** Ready-to-commit checkpoint.

### Task 3: Uploads, the Music section, and an end-to-end test

**Files:** Modify `packages/shared/src/scene.ts`, `scene.test.ts`, `apps/api/src/routes/files.ts`, `apps/api/src/app.test.ts`, `apps/web/src/studio/banners-panel.tsx`, `apps/web/src/styles/app.css`. Create `apps/web/src/studio/music/music-panel.tsx`, `e2e/music.spec.ts`.

**Interfaces — Produces:**

```ts
// scene.ts
export const musicTrackSchema = z.object({ id: z.string().max(40), name: z.string().max(60), url: z.string().max(200) });
// sceneSchema: music: z.array(musicTrackSchema).max(12).default([])
export function addMusicTrack(scene: Scene, track: MusicTrack): Scene;   // ignores a 13th
export function removeMusicTrack(scene: Scene, id: string): Scene;
```

- [ ] **Step 1: Failing tests.** In `scene.test.ts`: a scene saved without `music` parses with `music: []`; `addMusicTrack` appends and stops at 12; `removeMusicTrack` removes by id. In `app.test.ts`:

```ts
it('accepts an audio upload and serves it back, and refuses other types', async () => {
  const broadcast = await host.call('POST', '/api/broadcasts', { title: 'Music' });
  const upload = (type: string) =>
    t.app.inject({ method: 'POST', url: `/api/broadcasts/${broadcast.body.id}/assets`, headers: { cookie: host.cookieHeader, 'content-type': type }, payload: Buffer.from('ID3fake') });
  const ok = await upload('audio/mpeg');
  expect(ok.statusCode).toBe(200);
  const url = ok.json().url as string;
  expect(url).toMatch(/^\/assets\/[A-Za-z0-9_-]+\.mp3$/);
  const served = await t.app.inject({ method: 'GET', url });
  expect(served.headers['content-type']).toContain('audio/mpeg');
  expect((await upload('text/html')).statusCode).toBeGreaterThanOrEqual(400);
});
```

  (`TestClient` gains a `cookieHeader` getter.)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** `files.ts`: rename `IMAGE_TYPES` use into `ASSET_TYPES = { ...IMAGE_TYPES, 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }`; images keep the 5 MB limit, audio gets 20 MB (`MAX_AUDIO_BYTES`), checked on the buffer length; the error text becomes "Upload a PNG, JPEG, WebP or GIF image, or an MP3, WAV, OGG or M4A track". Add the scene functions.
- [ ] **Step 4:** `music-panel.tsx`: `MusicPanel({ broadcastId, scene, update, player })`. Rows for stings, beds and `scene.music`; each row is a button with `data-testid="music-<id>"` and `aria-pressed` when playing; a volume slider (`data-testid="music-volume"`), **Fade out** (`music-fade`), a **Lower while speaking** switch (`music-duck`), an upload input (`music-upload`, accepts the four audio types, rejects files over 20 MB with a toast before uploading) and a delete button per uploaded track. A track that fails to decode shows "This file could not be played" on its row. Built-in tracks load with `renderTrack(id, 44100)`; uploads with `fetch(url) → arrayBuffer → player.decode`.
- [ ] **Step 5:** Render `<MusicPanel>` as the first section of `BannersPanel` (new props `broadcastId`, `player`); pass them from `StudioRoom`.
- [ ] **Step 6:** `e2e/music.spec.ts`: sign up, create a broadcast, enter the studio, open the Banners tab, click `music-headlines`, expect `aria-pressed="true"`; click it again, expect `false`; click `music-intro`, expect it pressed and then released within 10 s.
- [ ] **Step 7:** Run `./run.sh check` and `npx playwright test e2e/music.spec.ts`. Expected: PASS.
- [ ] **Step 8:** Ready-to-commit checkpoint.

---

## Part 2: The daily rundown

### Task 4: The rundown's shape and putting an item on air

**Files:** Create `packages/shared/src/rundown.ts`, `rundown.test.ts`. Modify `packages/shared/src/scene.ts`, `index.ts`.

**Interfaces — Produces:**

```ts
export const SEGMENTS = ['open', 'top', 'story', 'repo', 'project', 'model', 'paper', 'quick', 'number', 'close'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_INFO: Record<Segment, { tag: string; label: string; count: number }>;  // story.count = 4, others 1
export const rundownSourceSchema;   // { url ≤500 (http/https only), title ≤160, site ≤40, quote ≤240 }
export const rundownItemSchema;     // { id ≤40, segment, tag ≤16, headline ≤90, subhead ≤120, points ≤300, script ≤6000, context ≤2000, ticker ≤200, seconds 0..1800, sources max 6 }
export const rundownSchema;         // { date /^\d{4}-\d{2}-\d{2}$/, generatedAt, model: string|null, warnings: string[] max 20, items max 20 }
export type Rundown, RundownItem, RundownSource;
export const RUNDOWN_TICKER_ID = 'rundown-ticker';
export const RUNDOWN_SOCIAL_ID = 'rundown-social';
/** Puts an item on air: fills the news fields, clears the source card, and sets the ticker banner. */
export function applyRundownItem(scene: Scene, item: RundownItem, social?: { handle: string; line: string }): Scene;
export function rundownSeconds(rundown: Rundown): number;
// scene.ts — newsSchema gains:
//   source: rundownSourceSchema.nullable().default(null)
//   rundownItemId: z.string().max(40).nullable().default(null)
```

`applyRundownItem` rules: `news.tag/headline/subhead/points` from the item, `news.source = null`,
`news.rundownItemId = item.id`. If `item.ticker` is non-empty, the banner with id `RUNDOWN_TICKER_ID`
(style `ticker`) is created or its text replaced, and it is shown. For a `close` item with `social`
given, the banner `RUNDOWN_SOCIAL_ID` (style `social`, text = handle, subtitle = line) is created or
replaced and shown; for any other item it is hidden. `rundownSourceSchema` lives in `scene.ts`
(scene uses it) and is re-exported by `rundown.ts` to avoid a circular import.

- [ ] **Step 1: Failing tests** in `rundown.test.ts`: the schema accepts a full item and rejects a `javascript:` source URL and a 91-character headline; `applyRundownItem` copies the four fields, clears a previous source card, creates the ticker banner once and reuses it on the second call (still one banner with that id, new text, showing); a `close` item with `social` shows the social banner and the next non-close item hides it; an older scene without `news.source` parses with `null`; `rundownSeconds` sums the items.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; export from `index.ts`.
- [ ] **Step 4:** Run `npx vitest run packages/shared`. Expected: PASS.
- [ ] **Step 5:** Ready-to-commit checkpoint.

### Task 5: Collecting the news

**Files:** Create `apps/api/src/news/sources.ts`, `sources.test.ts`, `apps/api/src/news/fixtures/` (one saved sample per source: `hn.json`, `github.json`, `hf-models.json`, `hf-spaces.json`, `arxiv.xml`, `rss.xml`, `atom.xml`).

**Interfaces — Produces:**

```ts
export type NewsKind = 'story' | 'show' | 'repo' | 'model' | 'space' | 'paper' | 'blog';
export interface NewsItem { kind: NewsKind; title: string; url: string; site: string; summary: string; score: number; publishedAt: string | null }
export function parseHackerNews(json: unknown, kind: 'story' | 'show'): NewsItem[];
export function parseGitHub(json: unknown): NewsItem[];
export function parseHuggingFace(json: unknown, kind: 'model' | 'space'): NewsItem[];
export function parseFeed(xml: string, site: string, kind: 'paper' | 'blog'): NewsItem[];   // RSS 2.0 and Atom
export function dedupe(items: NewsItem[]): NewsItem[];   // by normalised URL (no query tracking params, no trailing slash), keeps the higher score
export interface Collected { items: NewsItem[]; warnings: string[] }
export function collectNews(fetch: Fetch, now: Date): Promise<Collected>;
```

Requests (each with a 10 s `AbortSignal.timeout` and a `user-agent` header):

| Name | URL |
|---|---|
| Hacker News | `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>{now-24h},points>40&query=AI&hitsPerPage=40`, and again for `LLM`, `OpenAI`, `Anthropic`, `Gemini` |
| Show HN | the same with `tags=show_hn` and `points>15` |
| GitHub | `https://api.github.com/search/repositories?q=topic:llm+OR+topic:ai+OR+topic:agents+created:>{now-7d}&sort=stars&order=desc&per_page=25` |
| Hugging Face | `https://huggingface.co/api/models?sort=trendingScore&limit=20` and `/api/spaces?sort=trendingScore&limit=20` |
| arXiv | `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=30` |
| Blogs | the `FEEDS` array of `{ site, url }`; an entry older than 48 hours is dropped |

`parseFeed` is a small regex reader for `<item>`/`<entry>` blocks (title, link, description or
summary, pubDate or updated), with CDATA and entity decoding and tags stripped from summaries; no
XML dependency. Every string is clipped (title 200, summary 600) and every URL must be `http(s)`.
`collectNews` runs all requests with `Promise.allSettled`; a rejected one adds
`"<Name> could not be reached"` to `warnings`. Feed URLs that turn out dead when the task is run are
removed from `FEEDS` rather than left to warn every day.

- [ ] **Step 1: Failing tests:** each parser against its fixture (count > 0, first item's fields exact); each parser given `null`, `{}`, `'<html>'` returns `[]` and does not throw; `parseFeed` decodes `&amp;` and CDATA and strips `<p>`; a `javascript:` link is dropped; `dedupe` merges `https://x.com/a/?utm_source=hn` with `https://x.com/a`; `collectNews` with a fake fetch where GitHub answers 429 and arXiv throws returns items from the rest and two warnings naming them.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Save the fixtures with `curl` (trim each to a few entries), implement.
- [ ] **Step 4:** Run `npx vitest run apps/api/src/news/sources.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run one real collection from a scratch script and read the counts per kind; fix any parser that returns zero.
- [ ] **Step 6:** Ready-to-commit checkpoint.

### Task 6: Writing the rundown

**Files:** Create `apps/api/src/news/show.ts`, `apps/api/src/news/writer.ts`, `writer.test.ts`. Modify `apps/api/src/config.ts`, `apps/api/package.json` (`@google/genai`), `.env.example`.

**Interfaces — Consumes:** `NewsItem`, `Collected` (Task 5); `rundownSchema`, `SEGMENTS`, `SEGMENT_INFO` (Task 4).

**Produces:**

```ts
// config.ts → Config.news
news: {
  nvidiaKey?: string; model: string; fallbackModel: string;      // NVIDIA_API_KEY, NEWS_MODEL, NEWS_FALLBACK_MODEL
  geminiKey?: string; geminiModel: string;                        // GEMINI_API_KEY, GEMINI_MODEL
  show: Show;                                                     // SHOW_NAME, SHOW_HOST, SHOW_X, SHOW_GITHUB, SHOW_LINKEDIN
}
// show.ts
export interface Show { name: string; host: string; x: string; github: string; linkedin: string }
export const DEFAULT_SHOW: Show = { name: 'AI Daily', host: 'Yash Kavaiya', x: 'yashkavaiya', github: 'Yash-Kavaiya', linkedin: 'yashkavaiya' };
// writer.ts
export function buildPrompt(items: NewsItem[], show: Show, date: string): { system: string; user: string };
export function extractJson(text: string): unknown;                       // strips ```json fences and leading prose; throws if none
export function buildPlainRundown(collected: Collected, show: Show, date: string, now: Date, reason: string): Rundown;
export function sanitizeRundown(raw: unknown, collected: Collected, show: Show, date: string, now: Date, model: string): Rundown;
export type Generate = (system: string, user: string) => Promise<string>;
export function nvidiaGenerate(fetch: Fetch, key: string, model: string, wait?: (ms: number) => Promise<void>): Generate;
export function geminiGenerate(key: string, model: string): Generate;
export interface Writer { write(collected: Collected, date: string, now: Date): Promise<Rundown> }
export function createWriter(config: Config['news'], fetch: Fetch, providers?: { name: string; generate: Generate }[]): Writer;
```

- `buildPrompt`: the user message lists items as numbered lines `[n] kind | site | score | title | url | summary`, capped at 120 items (top by score within each kind). The system message fixes the segments and counts from `SEGMENT_INFO`, the JSON shape, the limits, the tone (spoken English, short sentences, no hype, say what is unconfirmed), about 2,000 spoken words in total, the show and host names for `open`, and the handles for `close`. Sources are cited as `{ "n": 12, "quote": "…" }`, by item number, so the model never types a URL.
- `sanitizeRundown`: parses loosely, maps each `n` back to the collected item (unknown numbers dropped), clips every string to its limit, forces `tag` to the segment's tag when blank, estimates `seconds` as `words / 2.5` when missing or zero, keeps at most `SEGMENT_INFO[segment].count` items per segment in `SEGMENTS` order, fills any segment the model left out from `buildPlainRundown`, and validates with `rundownSchema`.
- `nvidiaGenerate`: `POST https://integrate.api.nvidia.com/v1/chat/completions` with `{ model, messages, temperature: 0.5, max_tokens: 16000, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } }`, 120 s timeout. A 503 or 429 is retried three times with 5 s, 15 s and 30 s pauses (`wait` is injectable so tests do not sleep). Any other non-200 throws `NVIDIA answered <status>`.
- `geminiGenerate`: `new GoogleGenAI({ apiKey }).models.generateContent({ model, contents: user, config: { systemInstruction: system, responseMimeType: 'application/json' } })`, returning `response.text`.
- `createWriter`: provider order is NVIDIA `model`, NVIDIA `fallbackModel`, Gemini; providers without a key are left out. Each is tried once; an answer that fails `extractJson` or `sanitizeRundown` is retried once on the same provider, then the next provider is used. If all fail or none is configured, `buildPlainRundown` with the reason (`"No model key is set"` or the last error) as a warning.

- [ ] **Step 1: Failing tests** in `writer.test.ts`:

```ts
const collected: Collected = { items: [story('Big model released', 'https://lab.example/post'), repo('acme/agent', 'https://github.com/acme/agent')], warnings: ['arXiv could not be reached'] };
const answer = (items: unknown[]) => '```json\n' + JSON.stringify({ items }) + '\n```';

it('maps cited item numbers to collected URLs and drops unknown ones', async () => {
  const writer = createWriter(cfg, failFetch, [{ name: 'fake', generate: async () => answer([{ segment: 'top', headline: 'Big model released', script: 'Hello.', sources: [{ n: 1, quote: 'q' }, { n: 99, quote: 'made up' }] }]) }]);
  const top = (await writer.write(collected, '2026-10-06', NOW)).items.find((i) => i.segment === 'top')!;
  expect(top.sources).toEqual([{ url: 'https://lab.example/post', title: 'Big model released', site: 'lab.example', quote: 'q' }]);
});
it('clips over-long text to the scene limits', …);                    // 200-char headline → 90
it('fills segments the model left out and keeps the show order', …);  // segments appear in SEGMENTS order; repo item present
it('keeps feed warnings and records the model', …);                   // warnings contains the arXiv line; model === 'fake'
it('falls through to the next provider, then to the plain rundown', …); // first throws, second returns 'not json' twice → model null, warning set, every item has empty script
it('names the show and the handles in the plain open and close', …);
it('retries a 503 three times, then throws', async () => {             // nvidiaGenerate with a counting fake fetch and wait = async () => {}
  …expect(calls).toBe(4);
});
it('never sends the key anywhere but the authorization header', …);    // inspects the fake fetch's url and body
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** `npm install @google/genai -w @studio/api`; implement; add the new variables with comments to `.env.example`.
- [ ] **Step 4:** Run `npx vitest run apps/api/src/news`. Expected: PASS.
- [ ] **Step 5:** From a scratch script, run `collectNews` then `createWriter(...).write(...)` with the real key; read the whole result. Check: every segment present, scripts read as speech, no invented links, total near 15 minutes. Tune the prompt and repeat until it does.
- [ ] **Step 6:** Ready-to-commit checkpoint.

### Task 7: Schedule, storage and routes

**Files:** Create `apps/api/src/news/schedule.ts`, `schedule.test.ts`, `apps/api/src/news/service.ts`, `apps/api/src/routes/rundowns.ts`, a drizzle migration (`npm run db:generate -w @studio/api`). Modify `apps/api/src/db/schema.ts`, `http/context.ts` (`Deps.rundowns: RundownService`), `app.ts`, `index.ts`, `testing.ts`, `app.test.ts`, `packages/shared/src/api.ts`.

**Interfaces — Produces:**

```ts
// schedule.ts
export function istDate(now: Date): string;                    // 'YYYY-MM-DD' in Asia/Kolkata (UTC+5:30, no daylight saving)
export function nextRunAt(now: Date): Date;                    // the next 17:00 IST strictly after `now`
export function isPastRunTime(now: Date): boolean;             // 17:00 IST or later today
export function startSchedule(service: RundownService, log: (msg: string) => void): () => void;  // returns stop()
// service.ts
export class RundownService {
  constructor(db: Db, collect: (now: Date) => Promise<Collected>, writer: Writer, now?: () => Date);
  readonly generating: boolean;
  lastError: string | null;
  /** Starts a generation for today unless one is running. Resolves when it finishes. */
  generate(): Promise<void>;
  latest(): Promise<Rundown | null>;
  byDate(date: string): Promise<Rundown | null>;
  dates(): Promise<string[]>;                                  // newest first, at most 60
}
// shared api.ts
export interface RundownStatusDto { rundown: Rundown | null; generating: boolean; error: string | null; show: { name: string; host: string; x: string; github: string; linkedin: string } }
```

- Table `rundowns`: `date text primary key`, `data jsonb not null`, `created_at`. `generate` upserts by date. If `collect` returns no items, nothing is stored and `lastError = 'No news source could be reached'`.
- Stored rows are re-validated with `rundownSchema` when read; a row that fails is treated as missing.
- `startSchedule`: if `isPastRunTime(now)` and `byDate(istDate(now))` is null, call `generate()`; then `setTimeout` to `nextRunAt`, capped at 1 hour per timer so a sleeping laptop still fires on time, re-armed after each run. Timers are `unref`'d. Not started when `config.env === 'test'`.
- Routes (all `requireUserId`): `GET /api/rundowns/latest` → `RundownStatusDto`; `GET /api/rundowns` → `string[]`; `GET /api/rundowns/:date` → `Rundown` or 404 (date must match the pattern, else 400); `POST /api/rundowns/generate` → starts `generate()` without awaiting and answers `{ generating: true }`. `/api/rundowns/latest` is registered before `/:date`.

- [ ] **Step 1: Failing tests.** `schedule.test.ts`:

```ts
const at = (iso: string) => new Date(iso);
it('uses the IST calendar day', () => {
  expect(istDate(at('2026-10-06T18:29:59Z'))).toBe('2026-10-06');   // 23:59 IST
  expect(istDate(at('2026-10-06T18:30:00Z'))).toBe('2026-10-07');   // 00:00 IST
});
it('runs at 17:00 IST, which is 11:30 UTC', () => {
  expect(nextRunAt(at('2026-10-06T05:00:00Z')).toISOString()).toBe('2026-10-06T11:30:00.000Z');
  expect(nextRunAt(at('2026-10-06T11:30:00Z')).toISOString()).toBe('2026-10-07T11:30:00.000Z');
  expect(nextRunAt(at('2026-10-06T20:00:00Z')).toISOString()).toBe('2026-10-07T11:30:00.000Z');   // already the 7th in IST, before 17:00
});
it('knows whether today\'s run time has passed', () => {
  expect(isPastRunTime(at('2026-10-06T10:30:00Z'))).toBe(false);   // 16:00 IST
  expect(isPastRunTime(at('2026-10-06T13:00:00Z'))).toBe(true);    // 18:30 IST
});
```

  `app.test.ts` (`createTestApp` gains `opts.collect` and `opts.writer` fakes, default: one item, plain writer): anonymous `GET /api/rundowns/latest` is 401; before generating it returns `{ rundown: null, generating: false }` with the show; after `POST generate` and awaiting `deps.rundowns.generate()` it returns today's rundown and `GET /api/rundowns` lists the date; two `generate()` calls while the fake writer is held open call the writer once; `GET /api/rundowns/not-a-date` is 400 and an unknown date 404; a collection with no items stores nothing and sets `error`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; generate the migration; wire `index.ts` (`const stop = startSchedule(...)`, called in the shutdown handler).
- [ ] **Step 4:** Run `./run.sh check`. Expected: PASS.
- [ ] **Step 5:** Restart the stack, `POST /api/rundowns/generate` signed in, poll `latest` until `generating` is false, and read the stored rundown.
- [ ] **Step 6:** Ready-to-commit checkpoint.

### Task 8: The rundown on the News tab, and the source card

**Files:** Create `apps/web/src/studio/rundown/use-rundown.ts`, `rundown-panel.tsx`. Modify `apps/web/src/lib/api.ts`, `apps/web/src/studio/template-panels.tsx`, `apps/web/src/studio/graphics/news.ts`, `apps/web/src/studio/compositor.ts` (only if the card needs the side column check), `apps/web/src/studio/banners-panel.tsx`, `apps/web/src/styles/app.css`.

**Interfaces — Produces:**

```ts
// api.ts
rundownLatest: () => get<RundownStatusDto>('/api/rundowns/latest'),
rundownDates: () => get<string[]>('/api/rundowns'),
rundown: (date: string) => get<Rundown>(`/api/rundowns/${date}`),
generateRundown: () => post<{ generating: true }>('/api/rundowns/generate'),
// use-rundown.ts
export interface RundownState { rundown: Rundown | null; show: RundownStatusDto['show'] | null; dates: string[]; generating: boolean; error: string | null; loading: boolean; pick(date: string): void; generate(): void }
export function useRundown(): RundownState;     // polls `latest` every 4 s while generating
// rundown-panel.tsx
export function RundownPanel(props: { scene: Scene; update: SceneUpdater; state: RundownState; extraSources: Record<string, RundownSource[]>; onAddSource(itemId: string, url: string): void }): JSX.Element;
export function takeItem(update: SceneUpdater, rundown: Rundown, index: number, show: RundownState['show']): void;
```

- **Panel**, above "News scenes": a header row with the date select, total time (`formatDuration(rundownSeconds)`), and **Generate now** (`data-testid="rundown-generate"`, disabled while generating). States from the spec's error table, word for word. Each item is a button (`data-testid="rundown-item"`, `aria-pressed` when `scene.news.rundownItemId === item.id`) showing tag, headline and time. **Previous** / **Next** (`rundown-prev`, `rundown-next`) under the list.
- The on-air item expands to show its sources. Each source row: site and title, **Open to share** (`rundown-open`, `window.open(url, 'studio-source', 'popup,width=1280,height=800')`), and **Show card** (`rundown-card`, toggles `scene.news.source` between this source and `null`). A text field **Add a link** (`rundown-add-link`) appends `{ url, title: hostname, site: hostname, quote: '' }` to this item's extra sources (kept in `StudioRoom` state for this session; only `http(s)` URLs accepted, others show "Enter a web address starting with https://").
- **Source card** in `graphics/news.ts`: `drawSourceCard(p, scene)` draws in `newsSidePanel(p.size)` when `scene.news.source` is set, in place of the story panel: the site in an accent pill, the title (wrapped, 3 lines), the quote in large type inside quotation marks (wrapped, 6 lines; omitted when empty), and the URL without its scheme, clipped, at the bottom. In `drawNews`, for the anchor view: `if (scene.news.source && !frame.sideOccupied) drawSourceCard(...) else if (!frame.sideOccupied) drawStoryPanel(...)`. In the headline view the card is drawn in the same rectangle. In interview and panel views there is no free rectangle, so the panel's **Show card** button is disabled with the hint "Switch to the Anchor or Headline scene to show a card".
- **Follow preset** in `banners-panel.tsx`: takes an optional `handle` prop (from `state.show.x`) and uses `@${handle}` in place of `@yourhandle`.

- [ ] **Step 1:** Add the API client methods and `useRundown`.
- [ ] **Step 2:** Build `RundownPanel` and render it in the `newsroom` case of `TemplatePage`.
- [ ] **Step 3:** Draw the source card.
- [ ] **Step 4:** Run `./run.sh check`; open the studio, take three items, toggle a card in the Anchor and Headline scenes, and look at the canvas.
- [ ] **Step 5:** Ready-to-commit checkpoint.

### Task 9: The teleprompter

**Files:** Create `apps/web/src/studio/rundown/teleprompter.tsx`. Modify `apps/web/src/studio/StudioRoom.tsx`, `apps/web/src/styles/app.css`.

**Interfaces — Consumes:** `RundownState`, `takeItem` (Task 8).

**Produces:** `export function Teleprompter(props: { item: RundownItem | null; position: string; onPrev(): void; onNext(): void }): JSX.Element` (`position` is "3 of 13").

- Rendered in `StudioRoom` for the host only, between the stage and the backstage tiles, when the template is `newsroom` and a rundown item is on air. `useRundown()` moves up into `StudioRoom` so the panel and the teleprompter share it.
- Layout: the script in a scrolling box (`data-testid="teleprompter-script"`, default 28 px, 1.5 line height, max height 32vh) and the context notes in a narrower column beside it (below it on a narrow screen), headed "Background".
- Controls: play/pause (`teleprompter-play`), speed slider 20–200 px/s (default 60), text size slider 18–48 px, previous, next, and the position. Speed and size are remembered in `localStorage` (`studio.teleprompter`).
- Scrolling uses `requestAnimationFrame` and elapsed time, so the speed is the same on any display. It stops at the end. Changing item resets to the top and pauses.
- Keys, only when focus is not in an input, textarea or select: Space toggles scrolling, ArrowRight / ArrowLeft take the next / previous item, ArrowUp / ArrowDown nudge the scroll by 80 px.
- An item with an empty script (no-model rundown) shows its headline, sub-line and points instead, under "No script was written for this item".

- [ ] **Step 1:** Build the component and place it.
- [ ] **Step 2:** Run `./run.sh check`; in the studio, check scrolling, the keys, and that typing a space in the Headline field does not start the scroll.
- [ ] **Step 3:** Ready-to-commit checkpoint.

### Task 10: Full script page, documentation and end-to-end test

**Files:** Create `apps/web/src/pages/rundown-page.tsx`, `e2e/rundown.spec.ts`. Modify `apps/web/src/main.tsx`, `apps/web/src/studio/rundown/rundown-panel.tsx` (a "Full script" link, opens in a new tab), `apps/web/src/styles/app.css` (print rules), `README.md`, `docs/ARCHITECTURE.md`.

- `/rundown/:date` (signed-in): the show name, date, total time and warnings, then every item in order: tag, headline, sub-line, time, the script, the background, and its links as real anchors. `@media print` hides navigation and uses black on white. An unknown date shows "There is no rundown for this day".
- The end-to-end test must not call a model or the internet. `scripts/dev.mjs` passes the environment through, so the API reads `NEWS_FIXTURE=1`: `index.ts` then builds the service with a `collect` that returns three fixed items and the plain writer. `playwright.config.ts` sets `NEWS_FIXTURE: '1'` in `webServer.env`. Because `reuseExistingServer` is on, the test first calls `GET /api/rundowns/latest` and skips itself with a clear message if the running stack was not started with the fixture.
- `e2e/rundown.spec.ts`: sign up; create a broadcast from the News template; in the studio open the News tab; click `rundown-generate`; wait for three `rundown-item` buttons; click the second; expect the `news-headline-text` field to hold its headline and `teleprompter-script` to be visible with the item's text; press ArrowRight and expect the third item pressed; click `rundown-card` and expect it pressed; open `/rundown/<date>` and expect all three headlines.
- README: a "Daily AI news rundown" section (what it does, the 5 PM IST schedule, the keys, Generate now, the teleprompter keys, how X posts are handled) and a "Music" bullet; `ARCHITECTURE.md`: the `news/` module and the music path into the mix.

- [ ] **Step 1:** Build the page and route.
- [ ] **Step 2:** Add the fixture switch and the test.
- [ ] **Step 3:** Run `./run.sh check`, then `./run.sh restart` with `NEWS_FIXTURE=1` and `npx playwright test e2e/rundown.spec.ts e2e/music.spec.ts`. Expected: PASS.
- [ ] **Step 4:** Restart without the fixture, generate a real rundown, and run one show end to end by hand: take every item, read the teleprompter, open a source, show a card, play intro, a bed and outro.
- [ ] **Step 5:** Write the documentation.
- [ ] **Step 6:** Ready-to-commit checkpoint.
