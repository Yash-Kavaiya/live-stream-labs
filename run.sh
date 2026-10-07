#!/usr/bin/env bash
# One script to set up and run StreamLabs Studio.
#
#   ./run.sh            install what is missing, then start the whole stack
#   ./run.sh guests     for inviting guests: a public https address, and LiveKit Cloud for media
#   ./run.sh stop       stop a stack that is still holding its ports
#   ./run.sh restart    stop, then start
#   ./run.sh check      typecheck, lint and unit tests
#   ./run.sh e2e        end-to-end tests in Chrome (starts the stack if needed)
#   ./run.sh build      production builds
#
# Works in Git Bash on Windows, and on macOS and Linux. Run it in a terminal you keep open:
# the stack stops when the terminal closes, and ffmpeg cannot start from a stack whose
# terminal has gone away.
set -euo pipefail
cd "$(dirname "$0")"

# web, LiveKit, mock RTMP, API, media worker
PORTS=(5173 7880 1935 4000 4100)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

is_windows() { case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; *) return 1 ;; esac; }

check_tools() {
  command -v node >/dev/null || fail "Node.js is not installed. Install Node 22 or newer from https://nodejs.org"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || fail "Node 22 or newer is needed; this is $(node -v)."
  command -v ffmpeg >/dev/null || fail "ffmpeg is not on the PATH. Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg, Linux: apt install ffmpeg) and open a new terminal."
}

install_deps() {
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    say "Installing dependencies"
    npm install
  fi
}

# Prints the ids of the processes listening on the stack's ports.
port_pids() {
  local port
  for port in "${PORTS[@]}"; do
    if is_windows; then
      netstat -ano 2>/dev/null | awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" { print $5 }'
    elif command -v lsof >/dev/null; then
      lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true
    fi
  done | sort -u
}

stop_stack() {
  local pids pid
  pids="$(port_pids)"
  if [ -z "$pids" ]; then
    echo "Nothing is running."
    return
  fi
  say "Stopping the stack"
  for pid in $pids; do
    if is_windows; then
      # //F //T: Git Bash would turn a single-slash flag into a path.
      taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
    else
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 2
  echo "Stopped."
}

start_stack() {
  check_tools
  install_deps
  if [ -n "$(port_pids)" ]; then
    fail "The stack (or something else) is already using its ports. Run './run.sh restart' to replace it."
  fi
  say "Starting StreamLabs Studio at http://localhost:5173  (Ctrl+C to stop)"
  # Set FFMPEG_LOG=1 before running to see ffmpeg's full log for each stream.
  exec npm run dev
}

share_stack() {
  check_tools
  install_deps
  if [ -n "$(port_pids)" ]; then
    fail "The stack (or something else) is already using its ports. Run './run.sh stop' first."
  fi
  say "Starting StreamLabs Studio for guests, behind a public address  (Ctrl+C to stop)"
  # TUNNEL=ngrok or TUNNEL=cloudflare picks the tunnel; see scripts/share.mjs.
  exec node scripts/share.mjs
}

case "${1:-start}" in
  start) start_stack ;;
  guests | share) share_stack ;;
  stop) stop_stack ;;
  restart)
    stop_stack
    start_stack
    ;;
  check)
    check_tools
    install_deps
    say "Typecheck" && npm run typecheck
    say "Lint" && npm run lint
    say "Unit tests" && npm test
    ;;
  e2e)
    check_tools
    install_deps
    npm run e2e
    ;;
  build)
    check_tools
    install_deps
    npm run build
    ;;
  *) fail "Unknown command '$1'. Use: start, guests, stop, restart, check, e2e or build." ;;
esac
