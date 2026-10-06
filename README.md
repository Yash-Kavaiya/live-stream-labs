# StreamLabs Studio

A live-streaming studio in the browser, in the style of StreamYard, with a Material Design 3
interface. Invite guests with a link, arrange them in layouts, share your screen, add your brand,
and stream to YouTube, Twitch, Facebook, LinkedIn, X and Instagram at the same time.

## Quick start

You need **Node 22 or newer** and **ffmpeg** on the PATH. No Docker.

```bash
git clone https://github.com/Yash-Kavaiya/live-stream-labs.git
cd live-stream-labs
./run.sh
```

`run.sh` checks Node and ffmpeg, installs dependencies if they are missing, and starts everything.
The first run downloads the LiveKit server (about 20 MB) into `.bin/`. Then open
<http://localhost:5173>, create an account and a broadcast.

On Windows, run it from Git Bash. Without bash, the same thing is:

```bash
npm install
npm run dev
```

Install ffmpeg with `winget install Gyan.FFmpeg` (Windows), `brew install ffmpeg` (macOS) or
`apt install ffmpeg` (Linux), then open a new terminal.

### What `run.sh` does

| Command | What it does |
|---|---|
| `./run.sh` | Install what is missing, then start the whole stack |
| `./run.sh stop` | Stop a stack that is still holding its ports |
| `./run.sh restart` | Stop, then start |
| `./run.sh check` | Typecheck, lint and unit tests |
| `./run.sh e2e` | End-to-end tests in Chrome (starts the stack if needed) |
| `./run.sh build` | Production builds |

The stack is five processes:

| Port | Process |
|---|---|
| 5173 | Web app (Vite) |
| 4000 | REST API |
| 4100 | Media worker (ffmpeg ingest and fan-out) |
| 7880 | LiveKit server (dev mode) |
| 1935 | Mock RTMP destination |

Every setting has a development default, so local use needs no `.env`. To change one, copy
`.env.example` to `.env`.

## Try a stream without a real platform

Add a destination with the RTMP URL `rtmp://localhost:1935/live` and any stream key: the stack
includes a mock RTMP server there. Watch what it receives with
`ffplay rtmp://localhost:1935/live/<your-key>`.

## Go live on a real platform

Add a destination under **Destinations → Add with stream key**. The dialog says where each
platform shows its RTMP URL and key. This works for all six platforms. For YouTube the URL is
`rtmp://a.rtmp.youtube.com/live2` and the key comes from YouTube Studio. Treat a stream key like a
password: anyone who has it can stream to your channel.

For one-click connect (YouTube, Twitch, Facebook), create an OAuth app on the platform and set its
credentials in `.env` (see `.env.example`). The redirect URL to register is
`<your origin>/api/oauth/<youtube|twitch|facebook>/callback`.

## What is in the studio

- **Stage and backstage.** Everyone joins backstage; the host adds sources to the stage.
- **Layouts.** Ten of them: solo, grid, side by side, stacked, lead + guests, mosaic, spotlight,
  picture in picture, screen + sidebar, cinema.
- **Layout page.** Tune spacing, margins, corners, main-tile size, sidebar side, picture-in-picture
  corner and size, crop or fit, borders, shadow, backdrop and name-tag style. Upload a background
  picture or pick one of six built-in ones.
- **Works on phones and tablets.** The studio, the green room and the guest view rearrange for
  small screens; the controls stay fixed at the bottom.
- **Microphone options.** The arrow beside the mic button picks the microphone and speakers,
  shows a live input level, and switches noise suppression, echo cancellation and automatic
  volume. Choices are remembered in the browser.
- **Camera backgrounds.** The arrow beside the camera button offers three strengths of blur, six
  built-in backgrounds, or your own picture, for the host and for guests. They are also in the
  green room. The segmentation model is downloaded from a CDN the first time one is used.
- **A page per template.** News, Cricket and Party each have their own tab; a new broadcast can
  start from any of them.
- **Smooth transitions.** Tiles glide between layouts; people, banners, comments and holding
  screens fade in and out.
- **Auto director.** Guests go on stage as they join (up to a number you set, 3 by default), the
  layout re-arranges itself, the speaker is highlighted, and optionally moved to the main spot.
- **News room.** Anchor, interview, panel and full-screen headline scenes, with a channel bar,
  clock, headline and second line, story points and a ticker strip.
- **Cricket.** Follows a real match or is scored by hand; see below.
- **Watch party.** Shared video on top, emoji reactions, and a winner celebration with trophy and
  confetti.
- **Holding screens.** Starting soon, Be right back, Thanks for watching. They silence the
  stream. Starting and BRB can show a countdown timer.
- **Guests.** Invite link, no account; camera and microphone check before joining. The host can
  mute or remove a guest.
- **Sharing.** Screen with audio, an image, or a video clip.
- **Brand.** Colour, logo, overlay, background and name tags.
- **Banners.** Eight kinds: lower third, name + title, social handle, call to action, ticker, top
  headline, corner badge and title card. Banners in different positions can show together, and
  there are one-click presets.
- **Chat.** Private studio chat; Twitch and YouTube comments that can be put on screen.
- **Recording.** Every stream is recorded; watch, download or share a link.
- **Themes.** Light, dark, or follow the system.

## Cricket

Choose the **Cricket** template on the Scenes tab, then open the **Cricket** tab.

A new cricket scene follows a live match: the India match if one is on, otherwise any live match.
Pick another from the match list. The score refreshes every 5 seconds and goes out with the rest
of the scene, so guests and the stream see what the host sees.

| Layout | Cameras | Score |
|---|---|---|
| Strip | Your usual layout | A score strip along the bottom |
| Corner | Fill the frame | A small score box in the top-left corner |
| Split | Left side | A tall panel: score, batters, bowler, this over, runs per over |
| Board | Column at the side | Both teams, the numbers, the crease, this over, runs per over |
| Card | Column at the side | The batting card and the bowlers, with runs per over |

**Score by hand** switches to a ball-by-ball pad (runs, wickets, wides, no-balls) for a match the
feed does not cover.

The live score comes from ESPN's public cricket feed. It is free and needs no key, but it is not a
documented API and could change or be blocked without notice. When it cannot be reached, the last
score stays on screen and the Cricket tab says so. Only the host's browser talks to the feed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | LiveKit, mock RTMP, API, media worker and web app |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run e2e` | End-to-end tests in Chrome (starts the stack if it is not running) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run build` | Production builds of all three apps |

The end-to-end tests run two browsers, an SFU and a video encoder at once. Do not run them on the
machine you are streaming from while you are live.

## Troubleshooting

- **Go live does nothing, and the destination shows "ffmpeg exited with code 3221225794".** On
  Windows this means ffmpeg could not start because the stack has lost the terminal that launched
  it. Run `./run.sh restart` in a terminal and keep that terminal open.
- **The stream fails to start for another reason.** Start the stack with `FFMPEG_LOG=1 ./run.sh`
  to print ffmpeg's full log. The log contains the stream key, so do not share it.
- **"The stack is already using its ports".** An earlier run is still alive. `./run.sh restart`.
- **You still see the old interface after an update.** Hard-refresh the tab (Ctrl+Shift+R).
- **Camera backgrounds are missing.** The browser lacks WebGL 2 or the needed video APIs; the
  menu says so. Chrome and Edge support them.

## Layout

```
apps/web            React studio and dashboard
apps/api            REST API
apps/media-worker   ffmpeg ingest and fan-out
packages/shared     schemas, scene model, layout engine
packages/ui         Material 3 tokens and components
e2e/                Playwright end-to-end tests
scripts/            dev launcher, LiveKit download, mock RTMP server
infra/              Dockerfile, docker-compose.yml, Caddyfile
docs/               ARCHITECTURE.md
run.sh              set up and run everything
```

## Deploy

`infra/docker-compose.yml` runs the whole stack on one host: Caddy (HTTPS and single origin), API,
workers, Postgres, Redis and LiveKit. Read the header of that file, then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it scales and what to change first.

The container files have not been run on the machine this was built on (it has no Docker); expect
to adjust them on first deploy.
