// Starts the whole stack for local development, no Docker needed:
// LiveKit (dev mode), a mock RTMP destination, the API, the media worker and the web app.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLiveKit } from './get-livekit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, DATA_DIR: process.env.DATA_DIR ?? path.join(root, '.data') };
const children = [];

function run(name, command, args, cwd = root) {
  const child = spawn(command, args, { cwd, env, shell: process.platform === 'win32' });
  const prefix = `[${name}] `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) if (line.trim()) console.log(prefix + line);
    });
  }
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const livekit = await ensureLiveKit();
const watch = process.env.NO_WATCH ? [] : ['watch'];
run('livekit', `"${livekit}"`, ['--dev', '--bind', '127.0.0.1']);
run('rtmp', 'node', ['scripts/mock-rtmp.mjs']);
run('api', 'npx', ['tsx', ...watch, 'src/index.ts'], path.join(root, 'apps/api'));
run('worker', 'npx', ['tsx', ...watch, 'src/index.ts'], path.join(root, 'apps/media-worker'));
run('web', 'npx', ['vite'], path.join(root, 'apps/web'));

console.log('\n  Studio:    http://localhost:5173');
console.log('  Mock RTMP: rtmp://localhost:1935/live  (use any stream key)\n');
