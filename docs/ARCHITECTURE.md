# Architecture

OmniCast Studio is a browser studio that composes one program (people, screens, overlays) and
sends it to several live platforms at once.

```
 Host / guest browsers                               Platforms
 ┌──────────────────────┐   WebRTC    ┌──────────┐
 │ React studio         │◄──────────►│ LiveKit  │  (SFU: cameras, mics, screens, data)
 │  compositor (canvas) │            └────┬─────┘
 │  audio mixer         │   metadata      │ tokens, room metadata, data messages
 └───┬──────────────┬───┘   + data   ┌────┴─────┐      ┌────────────┐
     │ HTTPS /api   │ WS /ingest     │   API    │◄────►│ Postgres   │
     ▼              ▼                │ (Fastify)│      └────────────┘
 ┌────────┐   ┌────────────────────────┐ claim └────┬─────┘
 │ Caddy  │──►│ Media worker           │◄───────────┘ status (+ attempt)
 └────────┘   │  encoder ffmpeg (once) │──── MP4 ──────► recording → API disk
              │    │ MPEG-TS           │
              │    ├► relay ffmpeg ────┼── RTMP(S) ───► YouTube
              │    ├► relay ffmpeg ────┼── RTMP(S) ───► Twitch
              │    └► relay ffmpeg ────┼── RTMP(S) ───► Facebook · LinkedIn · X · Instagram …
              └────────────────────────┘
```

The same picture as a Mermaid diagram is in the [README](../README.md#architecture).

## Components

| Component | Path | Role | State |
|---|---|---|---|
| Web | `apps/web` | React 19 + Vite. Studio, guest join, dashboard, `/render` | none |
| API | `apps/api` | Fastify. Auth, destinations, broadcasts, invites, scene, go-live | Postgres |
| Media worker | `apps/media-worker` | WebSocket ingest; one encoder per live broadcast plus one copy-only relay per platform | none (recordings handed to the API) |
| Shared | `packages/shared` | zod schemas, scene model, layout engine | n/a |
| UI | `packages/ui` | Material 3 tokens and typed wrappers over `@material/web` | n/a |
| LiveKit | external | WebRTC SFU for realtime media and data | Redis when clustered |

## Key decisions

**Each account can bring its own LiveKit project.** The server's `LIVEKIT_*` values are optional.
An account can save a LiveKit Cloud URL, key and secret under Settings: the API calls LiveKit once
to check them, seals the secret with `ENCRYPTION_KEY` (table `livekit_settings`) and never returns
it. Every LiveKit call for a broadcast (tokens for the host and guests, room metadata, data
messages) goes to its owner's project, so a guest always lands in the same project as the host
(`apps/api/src/services/livekit-settings.ts`). In `livekit` egress mode, which runs in the
server's project, accounts cannot override it.

**The scene is one document.** Layout, who is on stage, banners and brand live in one zod-validated
JSON object (`packages/shared/src/scene.ts`). The API is its only writer: it saves it and publishes
it as LiveKit room metadata, so every client sees the same scene without a separate realtime
channel. `computeLayout` (pure, unit-tested) turns it into rectangles.

**One compositor, three users.** `apps/web/src/studio/compositor.ts` draws the program on a canvas.
The host preview, the guest view and the server-side `/render` page all use it, so they cannot
show different pictures. It is driven by a Worker timer, because browsers pause
`requestAnimationFrame` in background tabs.

**Motion lives in the compositor, not in the scene.** The scene only ever holds the target state
("grid, these three people, this banner"). `TileAnimator` and `Fade`
(`packages/shared/src/animate.ts`) ease from what is on screen to that target every frame, so
any change, whoever makes it, animates the same way on every client and in the stream.

**The auto director is ordinary scene updates.** `useAutoDirector` (host only) watches the room
and edits the scene: it stages joining guests up to `auto.maxOnStage`, re-picks the layout with
`pickAutoLayout` when the stage changes, and promotes the active speaker. Because it writes the
same scene the host edits by hand, a manual choice always wins until the stage next changes.
Templates and holding screens are scene fields too (`template`, `screen`, `news`, `cricket`,
`celebration`). A template can own the layout: `computeSceneLayout` routes to the news scenes or
the cricket views, and the matching graphics live in `apps/web/src/studio/graphics/`. Cricket
scoring is a pure reducer (`recordBall` in `packages/shared/src/cricket.ts`).

**Egress is an interface with two implementations** (`apps/api/src/egress/providers.ts`):

- `relay` (default). The host's browser records the canvas and the audio mix with MediaRecorder
  and streams the chunks over a WebSocket to a media worker. One ffmpeg transcodes once to H.264 +
  AAC and writes MPEG-TS to its stdout and an MP4 recording. Node copies the MPEG-TS to one relay
  per platform: an ffmpeg with `-c copy` that pushes FLV over RTMP(S) and reconnects on its own
  (see Fault tolerance). Frames are pushed into
  the stream on a Worker timer (`MediaStreamTrackGenerator`), not with `canvas.captureStream()`,
  which only emits frames while the page is painting and starves the encoder otherwise.
  Trade-off: the stream depends on the host's tab and upload; closing the tab ends it.
- `livekit`. LiveKit Egress opens `/render` in headless Chrome inside the data centre and pushes
  to the same RTMP list. The host can drop and rejoin without ending the stream. Needs the egress
  container (`--profile egress` in the compose file).

**Destinations are an interface** (`apps/api/src/destinations`). `prepare()` returns an RTMP URL,
`end()` closes the broadcast on the platform, `fetchComments()` reads chat.

| Platform | Stream key (works today) | One-click OAuth |
|---|---|---|
| YouTube | yes | yes: creates the broadcast and stream, reads live chat |
| Twitch | yes | yes: reads the stream key, sets the title; chat over anonymous IRC |
| Facebook | yes | yes: creates a live video on the profile |
| LinkedIn | yes ("custom stream") | no: LinkedIn's live API is limited to approved partners |
| X | yes (Media Studio Producer) | no: no open live API |
| Instagram | yes (Live Producer) | no |

**Secrets.** Stream keys and OAuth tokens are sealed with AES-256-GCM before they reach the
database and never go to a browser. The media worker gets the full RTMP URLs by exchanging a
short-lived signed ingest token over an internal endpoint guarded by `INTERNAL_SECRET`. Passwords
use scrypt. Invite links store only a SHA-256 hash of the token.

## Fault tolerance

A live show has to survive any one platform, network or process failing. What happens in each case:

| What fails | What happens | Where |
|---|---|---|
| One platform drops or refuses mid-show | Only that platform's relay exits. It is restarted after 1 s, 2 s, 4 s … up to 30 s, for as long as the show is live, and shows "Reconnecting (attempt n)". Every other platform and the recording carry on untouched. | `apps/media-worker/src/relay.ts` |
| A stream key is wrong | The relay never gets through; after 5 tries in a row it is marked failed with the reason. The other platforms are not affected. | `relay.ts` |
| A platform takes the stream too slowly | Its relay's backlog passes ~8 MB (~10 s) and only that relay is restarted, so it catches up from live. The encoder is never held back. | `relay.ts` |
| The host's network blips | The browser notices (WebSocket close, or nothing leaving the send buffer for 10 s) and reconnects for up to 25 s; the worker holds the platforms open for 30 s. | `apps/web/src/studio/broadcaster.ts`, `reconnect.ts`, `apps/media-worker/src/server.ts` |
| A worker restarts or is redeployed | It closes ingest connections with code 1012; browsers reconnect, through the proxy, to a healthy instance. | `server.ts`, `index.ts` |
| The reconnect lands on another worker instance | Every claim of the ingest token raises the session's `attempt`; the API ignores status from an older attempt, so the old worker's "ended" cannot stop the show. | `apps/api/src/routes/live.ts`, `services/broadcasts.ts` |
| The API restarts | The worker retries each status report with backoff, and the recording hand-over for minutes. | `server.ts` |
| Postgres drops a connection | The pool logs it and reconnects on the next query; `/api/health` answers 503 while the database cannot be reached. | `apps/api/src/db/client.ts`, `app.ts` |
| Several API instances start together | Migrations run under an advisory lock, and only the instance holding the `daily-rundown` lock makes the rundown. | `db/client.ts`, `news/schedule.ts` |
| The encoder itself cannot keep up | The session stops with a clear reason rather than drifting minutes behind; the browser can go live again. | `apps/media-worker/src/session.ts` |

**No app-level queue.** The plan sketched a Redis job queue between API and workers. It turned out
not to be needed: in relay mode the worker that receives the WebSocket is the one that must do the
work, and in livekit mode LiveKit Egress has its own queue. Status flows worker → API over HTTP and
API → studio over LiveKit data messages. Redis is used only by LiveKit.

**The daily rundown is made in the API process.** `apps/api/src/news` has four parts: `sources.ts`
reads public feeds into `NewsItem`s and opens the top stories' pages for their text; `writer.ts`
asks a model for the show in two calls (stories, then segments) and turns the answer into a
`Rundown`; `schedule.ts` runs it at 17:00 Asia/Kolkata; `service.ts` stores one row per day and
makes one at a time. Three rules keep model output safe to put on air: the model cites items by
number and never types a URL, every string is cut to the limit of the scene field it will fill,
and a segment the model leaves out is filled from the collected items. With several API replicas
only the one holding a Postgres advisory lock runs the schedule.

**The watch party is scene state plus two things only the host has.** `scene.party` holds the
queue, what is playing, the poll, the scores, the hype level and the latest burst of reactions, and
every change is a pure function in `packages/shared/src/party.ts`. Playback progress is stored as a
start time and a length, so each client draws the progress line from its own clock and nothing is
saved while a video plays. The host's browser alone has the video files (never uploaded; played
through `PartyPlayer` as the existing clip source) and the list of who has voted. Chat is read for
votes and emoji under strict rules, batched into one scene update every two seconds, and no chat
text is drawn.

**Music never touches the scene.** The host's `MusicPlayer` has its own audio context. Its output
goes to the host's speakers and to a media stream track, which the program `AudioMixer` mixes like
a microphone, on every screen including the holding screens. Built-in tracks are computed sample
by sample in `music/synth.ts`, so they can be tested without a browser and ship no audio files.
Only the list of uploaded tracks is saved with the broadcast.

## Scaling

| Tier | How it scales | Bottleneck |
|---|---|---|
| Web | static files behind a CDN | none |
| API | stateless; add replicas behind the proxy | Postgres |
| Media worker | stateless; add replicas. One live broadcast ≈ one encoder ≈ 1.5–2 CPU cores at 1080p30 (veryfast), plus a few % per platform relay | CPU; autoscale on CPU or on `sessions` from `/healthz` |
| LiveKit | add nodes with Redis; one room lives on one node | bandwidth and CPU per room |
| Egress (livekit mode) | add egress containers; each renders one broadcast in Chrome (≈ 2–4 cores) | CPU |
| Postgres | managed instance, read replicas if dashboards get heavy | writes are tiny |
| Recordings | the worker hands each one to the API (`UPLOAD_RECORDINGS=1`), which keeps it on its disk | one API disk; see below |

Rough capacity: a 16-core worker node carries about 4–6 simultaneous 1080p broadcasts in relay
mode. Ten guests in one room is well inside a single LiveKit node.

### What to change before real production load

1. **Recordings and assets on object storage.** They live on the API's disk, which keeps the API
   at one instance on Render (a service with a disk cannot scale). `apps/api/src/routes/files.ts`
   is the one place to swap for S3, R2 or GCS; then the API can scale out too.
2. **TURN.** Guests behind strict firewalls need TURN over TLS; enable it in the LiveKit config.
3. **Rate limiting** on `/api/auth/*` and `/api/invites/*` at the proxy.
4. **Kubernetes.** The three images map to three Deployments (API and worker with an HPA), LiveKit
   via its Helm chart with host networking, Postgres managed.

## Request flow: going live (relay mode)

1. Host clicks **Go live** → `POST /api/broadcasts/:id/live`.
2. API asks each destination adapter for an RTMP URL, seals the list into `egress_sessions`, and
   returns a WebSocket URL carrying a signed ingest token.
3. Browser opens the WebSocket to a worker and starts sending WebM chunks.
4. Worker exchanges the token at `POST /internal/egress/claim` for the RTMP targets and an
   `attempt` number, starts the encoder and one relay per target, and reports status (stamped
   with the attempt) to `POST /internal/egress/status` as destinations connect, drop, reconnect
   or fail.
5. API stores the status and relays it to the studio over the LiveKit data channel.
6. **End stream** closes the WebSocket; ffmpeg flushes, the relays finish, the worker reports the
   recording (and, with `UPLOAD_RECORDINGS=1`, streams it to `POST /internal/recordings/:file`),
   and the API tells each platform the broadcast is over.

## Testing

- `npm test`: unit and integration tests. The worker tests run real ffmpeg: one platform that
  never connects while another gets the whole stream, and a platform that hangs up mid-show and
  is reconnected while the other carries on. The API tests cover the attempt fencing. Also among them the feed parsers against saved samples, the
  rundown writer with faked models, the schedule's time arithmetic and the rundown routes. The API runs against in-memory PGlite; the worker
  test runs real ffmpeg.
- `npm run e2e`: Playwright drives Chrome with a synthetic camera. A host and a guest go live to
  two local RTMP servers; `ffprobe` checks both receive H.264 + AAC and that the recording plays.
- `e2e/party.spec.ts` runs a watch party with videos it makes with ffmpeg: queue, playback,
  auto-advance, a poll, reactions and the scoreboard. Votes and emoji arriving from real chat are
  covered by unit tests of the parsing rules, not end to end.
- `e2e/rundown.spec.ts` and `e2e/music.spec.ts` run the rundown from the News tab and play music.
  The rundown test needs `NEWS_FIXTURE=1` (Playwright sets it when it starts the stack): the API
  then uses fixed news and calls no feed and no model.
- Not covered by automated tests: the Gemini writer (no key with credit was available), what the
  music sounds like, `livekit` egress mode and the container files (no Docker on the
  development machine; the same builds are checked with npm, and CI builds them), and the OAuth adapters against the real platforms (tested with mocked HTTP).
