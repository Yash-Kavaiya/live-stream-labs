# Daily AI news rundown, teleprompter and studio music

Date: 2026-10-06

## Purpose

The host runs a daily AI news show from the News room template. Today they research stories, write
what to say and find pages to show by hand. This adds:

1. A rundown of the day's AI news, collected and written automatically at 5 PM IST.
2. A teleprompter and one-click story controls in the studio, so the show can be read and run from
   one place.
3. Music beds and stings that work in every template.

Success: at 5 PM IST the host opens the News tab and finds a 15-minute English show ready, steps
through it story by story with the words in front of them, shows each story's source, and plays
intro and background music, without preparing anything by hand.

## Decisions made with the user

| Question | Decision |
|---|---|
| Who collects and writes | The API server, on a schedule |
| Model | NVIDIA's hosted Nemotron first, Gemini second; keys in `.env` |
| Host's links | x.com/yashkavaiya, github.com/Yash-Kavaiya, linkedin.com/in/yashkavaiya, used in the script and on screen |
| Script | English, about 15 minutes |
| Music | Generated in the browser, plus the host's own uploads |
| Showing a source | A button that opens the page for screen share, and a source card drawn on the stream |

## Part 1: Music

Built first; it does not depend on the rundown.

### What the host gets

A **Music** section at the top of the Banners tab, present in every template:

- Four stings that play once: Intro, Breaking, Transition, Outro.
- Three beds that loop: Headlines, Soft, Countdown.
- Uploaded tracks (MP3, WAV, OGG, M4A; up to 20 MB each), listed under the built-in ones.
- Play and stop per track, a volume slider, **Fade out** (2 seconds), and a **Lower while speaking**
  switch that drops the music to 25% while anyone on stage is talking.

One bed and one sting can play at the same time; starting a second bed replaces the first.

### How it works

- `apps/web/src/studio/music/synth.ts` computes each built-in track sample by sample in plain
  TypeScript: oscillators, seeded noise and envelopes arranged as a short news theme. Nothing is
  downloaded and nothing is licensed. Rendering is deterministic, so a track sounds the same every
  time, and it can be tested without a browser.
- `apps/web/src/studio/music/player.ts` owns playback in its own audio context. Its output goes to
  the host's speakers and to a media stream track; `AudioMixer` mixes that track like any other, so
  the music can be played before going live and joins the stream when it starts.
- Music is the host's own playback. It is on the stream, in the recording and in the host's
  speakers. Guests do not hear it in this version.
- Holding screens (Starting soon, Be right back, Thanks for watching) silence the microphones today.
  Music keeps playing on them, which is the main use of the Countdown bed.
- Ducking reads the `speaking` flag the room view already has for on-stage cameras, and ramps the
  music gain over 300 ms.
- Music state is not part of the scene: it is live playback in the host's browser, not something
  guests or the saved scene need. Volume and the ducking switch are remembered in `localStorage`,
  as the microphone options are.

### Uploads

`POST /api/broadcasts/:id/assets` accepts images today. It gains the audio types above with a
20 MB limit, and `GET /assets/:name` serves them. Uploaded tracks are listed per broadcast in a new
`scene.music` array (`{ id, name, url }`, at most 12), so they are kept with the broadcast.

## Part 2: The daily rundown

### Collection

`apps/api/src/news/sources.ts` reads these with plain `fetch`. None needs a key.

| Source | What it gives |
|---|---|
| Hacker News (Algolia search API) | AI stories of the last 24 hours, with points and comment counts; Show HN posts |
| GitHub search API | AI repositories created or rising in the last week, by stars |
| Hugging Face API | Trending models and Spaces |
| arXiv API | New cs.AI, cs.CL and cs.LG papers |
| RSS feeds | AI lab blogs (OpenAI, Anthropic, Google, DeepMind, Meta, Microsoft, Hugging Face) and AI sections of tech news sites; the list is one array in the file |

Each source returns `NewsItem[]`: `{ kind, title, url, site, summary, score, publishedAt }`. A
source that fails or times out (10 seconds) is skipped and named in the rundown's `warnings`; the
rundown is still produced from the others. Feed content is untrusted: every field is checked and
clipped, as `cricket-feed.ts` does.

X has no free API. A tweet appears only when a collected item links to one. The host can add any
URL, including a tweet, to a story in the studio.

### Writing

`apps/api/src/news/writer.ts` sends the collected items to a model, asks for the rundown as JSON,
and validates the answer with the shared zod schema. It has two providers behind one function,
`writeRundown(items, show)`, tried in this order:

1. **NVIDIA** (`NVIDIA_API_KEY`). An OpenAI-compatible chat endpoint at
   `https://integrate.api.nvidia.com/v1`, called with `fetch`, JSON response format, thinking off.
   `NEWS_MODEL` defaults to `nvidia/nemotron-3-ultra-550b-a55b`. That model answers
   "503 Service temporarily overloaded" at busy times, so a 503 is retried three times with a
   pause and then `NEWS_FALLBACK_MODEL` (default `nvidia/nemotron-3-super-120b-a12b`) is used.
2. **Gemini** (`GEMINI_API_KEY`, `GEMINI_MODEL` default `gemini-3.6-flash`), through the
   `@google/genai` SDK with a response schema. Used when there is no NVIDIA key or NVIDIA failed.

Rules that hold for both:

- The model may only cite URLs from the collected items; any other URL in its answer is dropped.
  It ranks, groups and explains the news; it does not supply it.
- If no key is set, or both providers fail or return an answer that does not validate after one
  retry, the rundown is built without a model: headlines, summaries and links by source score, no
  spoken script. The News page says why.

The prompt fixes the show's shape, tone (spoken English, short sentences, no hype) and length
(about 2,000 spoken words).

### The show's identity

`apps/api/src/news/show.ts` holds the show's name, the host's name and the host's links
(X `@yashkavaiya`, GitHub `Yash-Kavaiya`, LinkedIn `yashkavaiya`), each overridable in `.env`
(`SHOW_NAME`, default "AI Daily"; `SHOW_HOST`, default "Yash Kavaiya"; `SHOW_X`, `SHOW_GITHUB`, `SHOW_LINKEDIN`). They are used in three places:

- The `open` item welcomes viewers by show and host name; the `close` item asks them to follow and
  reads the handles out.
- Taking the `close` item puts a social banner with the three handles on screen.
- The Banners tab's **Follow** preset uses the X handle in place of `@yourhandle`.

### The rundown

Defined once in `packages/shared/src/rundown.ts`.

```ts
Rundown { date: 'YYYY-MM-DD' (IST), generatedAt, model: string | null, warnings: string[], items: RundownItem[] }

RundownItem {
  id, segment, tag,              // tag is the label on screen: TOP STORY, REPO OF THE DAY...
  headline (≤90), subhead (≤120), points (3 lines, ≤300),   // the same limits as scene.news
  script,                        // the words to speak
  context,                       // background for the host: who, what came before, numbers, caveats
  ticker,                        // one line for the ticker strip
  seconds,                       // estimated speaking time
  sources: { url, title, site, quote }[]   // quote: the sentence worth showing, ≤240
}
```

Segments, in show order:

| Segment | Items | Content |
|---|---|---|
| `open` | 1 | Welcome and the day's three headlines |
| `top` | 1 | The biggest story, in depth |
| `story` | 4 | Shorter stories |
| `repo` | 1 | Repo of the day: what it does, who it is for, how to try it |
| `project` | 1 | Project of the day: a Show HN post or a Hugging Face Space |
| `model` | 1 | Model of the day: a trending model and what it is good at |
| `paper` | 1 | Paper of the day, in plain words |
| `quick` | 1 | Quick hits: four or five one-line items |
| `number` | 1 | Number of the day and what it means |
| `close` | 1 | Recap and what to watch tomorrow |

### Schedule and storage

- A `rundowns` table: `date` (primary key), `data` (JSON), `created_at`. One rundown per day for the
  whole installation.
- `apps/api/src/news/schedule.ts` computes the next 17:00 Asia/Kolkata and sets a timer. On start,
  if it is past 17:00 IST and today has no rundown, it generates one. The time calculation is a
  pure function with tests.
- Generation takes up to a minute, so it runs in the background. One generation runs at a time.

### API

| Route | Does |
|---|---|
| `GET /api/rundowns/latest` | The newest rundown, or `null`; includes `generating: boolean` |
| `GET /api/rundowns/:date` | One day's rundown |
| `GET /api/rundowns` | Dates that have one, newest first |
| `POST /api/rundowns/generate` | Starts a generation for today, replacing today's; answers at once |

All require a signed-in user.

### In the studio

The News tab (`template-panels.tsx`) gains a **Today's rundown** section above the existing fields.

- **List.** Each item shows its tag, headline and time. The item on air is marked. A total running
  time is shown. **Generate now** and a date picker for earlier days sit above the list.
- **Take.** Clicking an item puts it on air: a pure function `applyRundownItem(scene, item)` in
  `packages/shared` sets `news.tag`, `news.headline`, `news.subhead`, `news.points`, and replaces the
  text of the rundown's ticker banner (created the first time). **Next** and **Previous** step
  through the list; the same keys work from the teleprompter.
- **Teleprompter.** A host-only panel under the stage showing the on-air item's script in large
  type, with the context notes in a column beside it. Controls: start and pause scrolling, speed,
  text size, next and previous item. Space pauses; arrow keys change item. It is ordinary page
  content, never drawn on the program canvas, so it cannot reach the stream.
- **Open to share.** Each source has a button that opens its URL in a new window sized for
  screen share. The host shares that window with the existing screen share.
- **Source card.** A button on each source sets `scene.news.source` to
  `{ site, title, quote, url }`. `graphics/news.ts` draws it as a card in the story-panel area of
  the anchor view: site name, title, the quote in large type, and the shortened URL. A second click
  takes it off.
- **Add a link.** A field on the on-air item adds a URL as an extra source for this show only.
- **Full script page.** `/rundown/:date` shows the whole show as one readable, printable page:
  every item's headline, script, context and links.

`scene.news` gains `source` (nullable, default `null`) and `rundownItemId` (nullable). Older scenes
parse unchanged because both have defaults.

## Errors

| Situation | What the host sees |
|---|---|
| No rundown yet today | "Today's rundown is made at 5 PM IST" and **Generate now** |
| Generating | A progress line; the list fills when done |
| No model key, or every model call failed | The rundown without scripts, and a line saying why |
| Some sources failed | The rundown, and a line naming the sources that were skipped |
| Every source failed | No rundown is stored; the previous day's stays; the error is shown |
| An uploaded track cannot be decoded | "This file could not be played" on that track |

## Testing

- Unit: each source parser against a saved sample response; the rundown schema; the no-model
  rundown builder; dropping of unknown source URLs; `nextRunAt` across midnight and for a start
  after 17:00; `applyRundownItem`; the synth renders non-silent audio of the right length; the
  ducking gain curve.
- API: the rundown routes with a fake fetch and a fake writer, in `app.test.ts` style.
- End to end: a seeded rundown appears on the News tab, taking an item changes the headline on the
  stage, the teleprompter shows its script, and a music track can be started and stopped.

## Out of scope

- Reading X directly.
- Music that guests hear.
- Text-to-speech, automatic screenshots of sources, and editing the script inside the studio.
- More than one rundown per day or per-user rundowns.
