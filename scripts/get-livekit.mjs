// Downloads the LiveKit server binary into .bin/ (once). Used by `npm run dev`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.13.7';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, '.bin');
const isWindows = process.platform === 'win32';
export const livekitBinary = path.join(binDir, isWindows ? 'livekit-server.exe' : 'livekit-server');

export async function ensureLiveKit() {
  if (existsSync(livekitBinary)) return livekitBinary;

  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!os || !arch) throw new Error(`No LiveKit build for ${process.platform}/${process.arch}`);

  const archive = `livekit_${VERSION}_${os}_${arch}.${isWindows ? 'zip' : 'tar.gz'}`;
  const url = `https://github.com/livekit/livekit/releases/download/v${VERSION}/${archive}`;
  console.log(`[setup] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, archive);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  // Windows ships bsdtar, which reads zip. Use it by full path: a GNU tar on PATH (Git Bash) cannot.
  const tar = isWindows ? path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive], { cwd: binDir, stdio: 'inherit' });
  if (!existsSync(livekitBinary)) throw new Error('LiveKit binary not found after unpacking');
  return livekitBinary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await ensureLiveKit());
}
