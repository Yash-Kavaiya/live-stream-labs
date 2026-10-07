// Runs the studio on this computer and gives it a public https address, so guests anywhere can
// open an invite link. Used by `./run.sh share`.
//
//   node scripts/share.mjs              ngrok if it is installed, otherwise a Cloudflare tunnel
//   TUNNEL=cloudflare node scripts/share.mjs
//   TUNNEL=ngrok node scripts/share.mjs
//
// The tunnel carries the web app and the API. It does not carry camera and microphone traffic:
// that goes straight between each browser and LiveKit, and a LiveKit running on this computer
// cannot be reached from outside your network. So this run uses the LiveKit server named by
// GUEST_LIVEKIT_URL, GUEST_LIVEKIT_API_KEY and GUEST_LIVEKIT_API_SECRET in .env (a LiveKit Cloud
// project). Only this command reads them: a normal `./run.sh` stays on the local LiveKit and
// spends none of the cloud allowance.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const WEB_PORT = 5173;
const children = [];

function onPath(command) {
  try {
    execFileSync(isWindows ? 'where' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The tunnel to use and how to find the public address in what it prints. */
function chooseTunnel() {
  const wanted = (process.env.TUNNEL ?? '').toLowerCase();
  const ngrok = {
    name: 'ngrok',
    command: 'ngrok',
    args: ['http', String(WEB_PORT), '--log', 'stdout', '--log-format', 'json'],
    find: (text) => /"url":"(https:\/\/[^"]+)"/.exec(text)?.[1],
  };
  const cloudflare = (command, prefix) => ({
    name: 'Cloudflare tunnel',
    command,
    args: [...prefix, 'tunnel', '--url', `http://localhost:${WEB_PORT}`],
    find: (text) => /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0],
  });

  if (wanted === 'ngrok' || (!wanted && onPath('ngrok'))) {
    if (!onPath('ngrok')) throw new Error('ngrok is not installed. Get it from https://ngrok.com/download and run `ngrok config add-authtoken <token>` once.');
    return ngrok;
  }
  // The npm package downloads the cloudflared binary on first use, so nothing needs installing.
  return onPath('cloudflared') ? cloudflare('cloudflared', []) : cloudflare('npx', ['--yes', 'cloudflared']);
}

function stop(code = 0) {
  for (const child of children) {
    if (isWindows && child.pid) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      } catch {
        // Already gone.
      }
    } else {
      child.kill();
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

/** Starts the tunnel and resolves with its public https address. */
function openTunnel(tunnel) {
  return new Promise((resolve, reject) => {
    const child = spawn(tunnel.command, tunnel.args, { cwd: root, shell: isWindows });
    children.push(child);
    let seen = '';
    const timer = setTimeout(() => reject(new Error(`${tunnel.name} gave no public address within 60 seconds:\n${seen.slice(-600)}`)), 60_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8').on('data', (chunk) => {
        seen += chunk;
        const url = tunnel.find(seen);
        if (url) {
          clearTimeout(timer);
          resolve(url);
        }
      });
    }
    child.on('error', (err) => reject(new Error(`${tunnel.name} could not start: ${err.message}`)));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${tunnel.name} stopped (code ${code}):\n${seen.slice(-600)}`));
    });
  });
}

/** A setting from the environment, else from the repo's .env. */
function setting(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(root, '.env');
  const line = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`)) : undefined;
  return line?.slice(name.length + 1).trim() || '';
}

/** The internet LiveKit server for a guest session, when all three settings are present. */
function guestLiveKit() {
  const url = setting('GUEST_LIVEKIT_URL');
  const apiKey = setting('GUEST_LIVEKIT_API_KEY');
  const apiSecret = setting('GUEST_LIVEKIT_API_SECRET');
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

const tunnel = chooseTunnel();
console.log(`[share] opening a ${tunnel.name} to http://localhost:${WEB_PORT} …`);
let url;
try {
  url = await openTunnel(tunnel);
} catch (err) {
  console.error(`[share] ${err.message}`);
  stop(1);
}

const cloud = guestLiveKit();
console.log(`\n  Public address: ${url}`);
console.log('  Open the studio at that address (not localhost) and send guests the invite link from it.');
if (cloud) {
  console.log(`\n  Cameras and sound go through ${new URL(cloud.url).host} for this run.`);
  console.log('  Time in the studio counts against that LiveKit project. Stop with Ctrl+C when done.');
} else {
  console.log('\n  LiveKit is running on this computer, so guests outside your network will reach the');
  console.log('  page but get no camera or sound. Set GUEST_LIVEKIT_URL, GUEST_LIVEKIT_API_KEY and');
  console.log('  GUEST_LIVEKIT_API_SECRET in .env to a LiveKit server on the internet to fix that.');
}
console.log('');

// The stack reads the public address for invite links and sign-in redirects, and Vite must be
// told to answer for the tunnel's host name.
const stack = spawn('node', ['scripts/dev.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    WEB_ORIGIN: url,
    TUNNEL_HOST: new URL(url).host,
    ...(cloud ? { LIVEKIT_URL: cloud.url, LIVEKIT_API_KEY: cloud.apiKey, LIVEKIT_API_SECRET: cloud.apiSecret, NO_LOCAL_LIVEKIT: '1' } : {}),
  },
});
children.push(stack);
stack.on('exit', (code) => stop(code ?? 1));
