# Architecture

StreamLabs Studio is a browser studio that composes one program (people, screens, overlays) and
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
 ┌────────┐   ┌──────────────┐ claim └────┬─────┘
 │ Caddy  │──►│ Media worker │◄───────────┘ status
 └────────┘   │   ffmpeg     │──── RTMP(S) ───► YouTube · Twitch · Facebook · LinkedIn · X · Instagram
              └──────────────┘──── MP4 ───────► recordings volume
```

## Components

| Component | Path | Role | State |
|---|---|---|---|
| Web | `apps/web` | React 19 + Vite. Studio, guest join, dashboard, `/render` | none |
| API | `apps/api` | Fastify. Auth, destinations, broadcasts, invites, scene, go-live | Postgres |
| Media worker | `apps/media-worker` | WebSocket ingest, one ffmpeg per live broadcast | none (files on a volume) |
| Shared | `packages/shared` | zod schemas, scene model, layout engine | n/a |
| UI | `packages/ui` | Material 3 tokens and typed wrappers over `@material/web` | n/a |
| LiveKit | external | WebRTC SFU for realtime media and data | Redis when clustered |

## Key decisions

**The scene is one document.** Layout, who is on stage, banners and brand live in one zod-validated
JSON object (`packages/shared/src/scene.ts`). The API is its only writer: it saves it and publishes
it as LiveKit room metadata, so every client sees the same scene without a separate realtime
channel. `computeLayout` (pure, unit-tested) turns it into rectangles.

**One compositor, three users.** `apps/web/src/studio/compositor.ts` draws the program on a canvas.
The host preview, the guest view and the server-side `/render` page all use it, so they cannot
show different pictures. It is driven by a Worker timer, because browsers pause
`requestAnimationFrame` in background tabs.

**Egress is an interface with two implementations** (`apps/api/src/egress/providers.ts`):

- `relay` (default). The host's browser records the canvas and the audio mix with MediaRecorder
  and streams the chunks over a WebSocket to a media worker. ffmpeg transcodes once to H.264 + AAC
  and the `tee` muxer copies that to every destination and to an MP4 file. Frames are pushed into
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

**No app-level queue.** The plan sketched a Redis job queue between API and workers. It turned out
not to be needed: in relay mode the worker that receives the WebSocket is the one that must do the
work, and in livekit mode LiveKit Egress has its own queue. Status flows worker → API over HTTP and
API → studio over LiveKit data messages. Redis is used only by LiveKit.

## Scaling

| Tier | How it scales | Bottleneck |
|---|---|---|
| Web | static files behind a CDN | none |
| API | stateless; add replicas behind the proxy | Postgres |
| Media worker | stateless; add replicas. One live broadcast ≈ one ffmpeg ≈ 1–2 CPU cores at 720p30 | CPU; autoscale on CPU or on `sessions` from `/healthz` |
| LiveKit | add nodes with Redis; one room lives on one node | bandwidth and CPU per room |
| Egress (livekit mode) | add egress containers; each renders one broadcast in Chrome (≈ 2–4 cores) | CPU |
| Postgres | managed instance, read replicas if dashboards get heavy | writes are tiny |
| Recordings | local volume today (`DATA_DIR/recordings`) | see below |

Rough capacity: a 16-core worker node carries about 8–12 simultaneous 720p broadcasts in relay
mode. Ten guests in one room is well inside a single LiveKit node.

### What to change before real production load

1. **Recordings and assets on object storage.** They are written to a shared volume, which caps
   you at one host or an NFS mount. `apps/api/src/routes/files.ts` and the worker's
   `recordingsDir` are the two places to swap for S3/GCS.
2. **TURN.** Guests behind strict firewalls need TURN over TLS; enable it in the LiveKit config.
3. **Rate limiting** on `/api/auth/*` and `/api/invites/*` at the proxy.
4. **Per-destination reconnect.** With the tee muxer a destination that drops stays dropped until
   the next go-live; the others keep running. Independent retries need one pusher process per
   destination fed from a local relay.
5. **Kubernetes.** The three images map to three Deployments (API and worker with an HPA), LiveKit
   via its Helm chart with host networking, Postgres managed.

## Request flow: going live (relay mode)

1. Host clicks **Go live** → `POST /api/broadcasts/:id/live`.
2. API asks each destination adapter for an RTMP URL, seals the list into `egress_sessions`, and
   returns a WebSocket URL carrying a signed ingest token.
3. Browser opens the WebSocket to a worker and starts sending WebM chunks.
4. Worker exchanges the token at `POST /internal/egress/claim` for the RTMP targets, starts
   ffmpeg, and reports status to `POST /internal/egress/status` as destinations connect or fail.
5. API stores the status and relays it to the studio over the LiveKit data channel.
6. **End stream** closes the WebSocket; ffmpeg flushes, the worker reports the recording, the API
   tells each platform the broadcast is over.

## Testing

- `npm test`: 59 unit and integration tests. The API runs against in-memory PGlite; the worker
  test runs real ffmpeg.
- `npm run e2e`: Playwright drives Chrome with a synthetic camera. A host and a guest go live to
  two local RTMP servers; `ffprobe` checks both receive H.264 + AAC and that the recording plays.
- Not covered by automated tests: `livekit` egress mode and the infra files (no Docker on the
  development machine), and the OAuth adapters against the real platforms (tested with mocked HTTP).
