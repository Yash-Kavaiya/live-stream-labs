# StreamLabs Studio: a StreamYard-style multistreaming platform

## Context

`C:\Users\yashk\Downloads\live-stream-labs` is empty (no git repo). The goal is a browser-based live
studio like StreamYard: a host opens a studio, invites guests by link, arranges them in layouts with
screen share and overlays, and goes live to YouTube, X, LinkedIn, Twitch and Meta (Facebook /
Instagram) at once. The UI follows Google's Material Design 3 with Google fonts. The code must be
clean and the architecture must scale horizontally.

Machine facts that shape the plan: Windows 11, Node 24, npm 11, ffmpeg 8 installed, **no Docker**.
So everything must run locally without containers, while production uses containers.

Assumptions I am making (say so if any is wrong):

- The `CLAUDE.md` in `Downloads\` describes a different project (the Jetson "Talk-to-your-Company"
  app: Python, port 8000, frozen scope). I am treating it as not applying to this folder.
- TypeScript everywhere. Product working name "StreamLabs Studio" (rename is one constant).
- You will supply your own OAuth app credentials for YouTube / Twitch / Facebook later; until then
  every platform works through its RTMP URL + stream key.

## Architecture

```
Browser (React studio / guest)
   │  WebRTC (camera, mic, screen)            │ HTTPS / WS
   ▼                                          ▼
LiveKit SFU  ◄── tokens, room metadata ──  API (Fastify)  ── Postgres, Redis
   │                                          │ job: start/stop egress
   ▼                                          ▼
Program output ───────────────────────►  Media worker (ffmpeg)
                                              │ one encode, tee to N
                                              ▼
                       YouTube · Twitch · Facebook · LinkedIn · X · Instagram · custom RTMP
```

- **Realtime: LiveKit** (open-source SFU). Handles guests, screen share, simulcast, data channels
  for chat. Scales by adding nodes; runs locally as a single Windows binary in `--dev` mode.
- **Scene state** (layout, who is on stage, banners, brand) is one zod-validated JSON document.
  The API is the only writer: it persists it and pushes it as LiveKit room metadata, so every
  client and any server-side renderer sees the same scene.
- **Egress behind one interface, `EgressProvider`, with two implementations:**
  - `RelayEgress` (default, runs locally): the host's browser composites the scene on a canvas,
    mixes audio with WebAudio, and sends MediaRecorder chunks over a WebSocket to the media worker.
    ffmpeg transcodes once to H.264/AAC and uses the `tee` muxer (`onfail=ignore`) to push to every
    destination and to a recording file.
  - `LiveKitEgress` (production): LiveKit Egress renders our `/render/:broadcastId` page in headless
    Chrome and pushes to the same RTMP list. The stream no longer depends on the host's upload.
    This one needs Linux containers, so **I cannot run it on this machine**; it will be written and
    unit-tested against the LiveKit API but not end-to-end verified here.
- **Destinations behind one interface, `DestinationAdapter`** (`prepare()` returns an RTMP URL and
  key, `end()`, optional `fetchChat()`):
  - Manual RTMP adapter: works for all six platforms from day one.
  - OAuth one-click adapters: YouTube (Live Streaming API), Twitch (Helix), Facebook (Graph
    `live_videos`).
  - LinkedIn and X: their live APIs are gated behind partner approval, so they stay on RTMP
    URL + key (LinkedIn "custom stream", X Media Studio Producer). Instagram likewise uses its
    Live Producer stream key.
- **Scaling**: API and media workers are stateless; workers pull jobs from a Redis queue (one
  ffmpeg per live broadcast, autoscale on queue depth and CPU); Postgres for data; object storage
  for recordings. Stream keys and OAuth tokens are encrypted at rest with AES-256-GCM.
- **Local dev without Docker**: PGlite (in-process Postgres, same SQL dialect and migrations as
  production) and an in-memory queue/pub-sub behind the same interfaces as Redis.

## Repository layout (npm workspaces)

```
apps/web            React 19 + Vite. Material 3 UI, studio, guest join, dashboard, /render page
apps/api            Fastify. Auth, broadcasts, destinations, invites, scene, LiveKit tokens
apps/media-worker   WebSocket ingest, ffmpeg supervisor, egress providers, recording
packages/shared     zod schemas, scene types, layout engine, platform catalogue
packages/ui         M3 tokens (CSS variables), theme, thin wrappers over @material/web
infra/              Dockerfiles, docker-compose.yml, livekit + egress config
docs/               ARCHITECTURE.md, design spec, platform setup guides
scripts/            dev.mjs (starts everything), get-livekit.mjs, mock-rtmp.mjs
```

Stack: Drizzle ORM, zod, Vitest, Playwright, ESLint + Prettier, `livekit-client` and
`livekit-server-sdk`, `@material/web`, Material Symbols, fonts Google Sans Flex with Roboto Flex
fallback and Roboto Mono for stream keys.

## Features

| Area | Included |
|---|---|
| Studio | Stage and backstage, layouts (solo, grid, spotlight, picture-in-picture, screen + sidebar, cinema), drag to reorder, device picker, mute / remove guest, rename |
| Guests | Invite link with expiring token, no account needed, green room with camera/mic check, up to 10 on stage |
| Sharing | Screen / window / tab share with audio, image and video clip share, copy invite link, shareable recording link |
| Branding | Brand colour, logo, overlay, background, lower-third banners, scrolling ticker, name tags |
| Chat | Private studio chat, Twitch and YouTube comments pulled in, click a comment to show it on screen |
| Broadcasts | Create, schedule, title/description per destination, go live / end, per-destination status, recording download |
| Account | Email + password (scrypt), Google sign-in, destinations manager, dark and light theme |

## Build order

Each phase ends with passing tests and a commit.

0. **Scaffold**: `git init`, workspaces, tsconfig, lint, Vitest, write the design spec to
   `docs/superpowers/specs/2026-10-06-streaming-studio-design.md`.
1. **`packages/shared`**: schemas, scene model, layout engine (pure function from scene +
   participants to rectangles), tests first.
2. **API**: DB schema and migrations, auth, broadcasts, destinations with encryption, invites,
   scene endpoint, LiveKit token minting.
3. **UI kit and shell**: M3 tokens, theme, landing, sign-in, dashboard.
4. **Studio and guest join**: LiveKit room, stage/backstage, layouts, screen share, chat, canvas
   compositor shared by the studio preview and `/render`.
5. **Media worker**: WS ingest, ffmpeg supervisor with restart and per-destination status,
   recording, `RelayEgress`; then `LiveKitEgress`.
6. **Platform adapters**: manual RTMP for all six, OAuth for YouTube, Twitch, Facebook, chat pull.
7. **Branding and overlays**: banners, ticker, logo, on-screen comments.
8. **Infra and docs**: Dockerfiles, compose, `ARCHITECTURE.md` with the scaling path, platform
   setup guides, README.

## Verification

- `npm test`: Vitest unit tests (layout engine, scene validation, encryption, adapters with mocked
  HTTP, ffmpeg argument builder, API routes against PGlite).
- `npm run dev`: starts LiveKit (dev mode), API, worker, web and two local mock RTMP sinks
  (`node-media-server`).
- `npm run e2e`: Playwright with Chrome fake camera/mic. Host signs up, creates a broadcast, a
  second browser context joins by invite link, host puts the guest on stage, switches layout, goes
  live to both mock sinks; `ffprobe` confirms each sink receives H.264 + AAC and the recording file
  is playable.
- Manual: I drive the studio in a browser and screenshot the main screens in light and dark theme.
- Not verifiable here: `LiveKitEgress` end to end (needs Docker) and real platform go-live (needs
  your stream keys or OAuth apps). I will report both as untested rather than as working.

## Things that need you

- Downloading the LiveKit server binary (about 40 MB from GitHub releases) on first `npm run dev`.
- Real stream keys or OAuth client IDs when you want to test against the actual platforms.

## Changes made while building

- No Redis job queue between API and workers; see "No app-level queue" in `docs/ARCHITECTURE.md`.
- Stage order is changed with a "Make main" button per source, not drag and drop.
- Renaming a participant from the studio is not built; guests choose their name when joining.
- Recordings and uploaded images are stored on a local volume, not object storage.
- The relay broadcaster pushes canvas frames with `MediaStreamTrackGenerator` instead of
  `canvas.captureStream()`, which starves the encoder when the page is not painting.
