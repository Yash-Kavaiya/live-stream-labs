# StreamLabs Studio

A live-streaming studio in the browser, in the style of StreamYard, with a Material Design 3
interface. Invite guests with a link, arrange them in layouts, share your screen, add your brand,
and stream to YouTube, Twitch, Facebook, LinkedIn, X and Instagram at the same time.

## Run it locally

Needs Node 22+ and `ffmpeg` on the PATH. No Docker.

```bash
npm install
npm run dev
```

The first run downloads the LiveKit server (about 20 MB) into `.bin/`. Then open
<http://localhost:5173>, create an account and a broadcast.

To try a stream without touching a real platform, add a destination with the RTMP URL
`rtmp://localhost:1935/live` and any stream key: `npm run dev` also starts a mock RTMP server
there. Watch what it receives with `ffplay rtmp://localhost:1935/live/<your-key>`.

## Go live on a real platform

Add a destination under **Destinations → Add with stream key**. The dialog says where each
platform shows its RTMP URL and key. This works for all six platforms.

For one-click connect (YouTube, Twitch, Facebook), create an OAuth app on the platform and set its
credentials in `.env` (see `.env.example`). The redirect URL to register is
`<your origin>/api/oauth/<youtube|twitch|facebook>/callback`.

## What is in the studio

- **Stage and backstage.** Everyone joins backstage; the host adds sources to the stage.
- **Layouts.** Solo, grid, spotlight, picture in picture, screen + sidebar, cinema.
- **Smooth transitions.** Tiles glide between layouts; people, banners, comments and holding
  screens fade in and out.
- **Auto director.** Guests go on stage as they join (up to a number you set, 3 by default), the
  layout re-arranges itself, the speaker is highlighted, and optionally moved to the main spot.
- **News room.** Anchor, interview, panel and full-screen headline scenes, with a channel bar,
  clock, headline and second line, story points and a ticker strip.
- **Cricket.** Score ball by ball (runs, wickets, wides, no-balls). A score strip under the video
  or a full match dashboard: score, overs, run rates, batters, bowler, this over, and the chase.
- **Watch party.** Shared video on top, emoji reactions, and a winner celebration with trophy and
  confetti.
- **Holding screens.** Starting soon, Be right back, Thanks for watching. They mute the stream.
  Starting and BRB can show a countdown timer.
- **Guests.** Invite link, no account; camera and microphone check before joining. The host can
  mute or remove a guest.
- **Sharing.** Screen with audio, an image, or a video clip.
- **Brand.** Colour, logo, overlay, background, name tags, banners and a scrolling ticker.
- **Chat.** Private studio chat; Twitch and YouTube comments that can be put on screen.
- **Recording.** Every stream is recorded; watch, download or share a link.
- **Themes.** Light, dark, or follow the system.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | LiveKit, mock RTMP, API, media worker and web app |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run e2e` | End-to-end test in Chrome (starts the stack if it is not running) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run build` | Production builds of all three apps |

## Layout

```
apps/web            React studio and dashboard
apps/api            REST API
apps/media-worker   ffmpeg ingest and fan-out
packages/shared     schemas, scene model, layout engine
packages/ui         Material 3 tokens and components
infra/              Dockerfile, docker-compose.yml, Caddyfile
docs/               ARCHITECTURE.md
```

## Deploy

`infra/docker-compose.yml` runs the whole stack on one host: Caddy (HTTPS and single origin), API,
workers, Postgres, Redis and LiveKit. Read the header of that file, then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it scales and what to change first.

The container files have not been run on the machine this was built on (it has no Docker); expect
to adjust them on first deploy.
