// Writes apps/web/dist/_redirects for Netlify: /api and /assets go to the API, everything else
// is the single-page app. Netlify's rules cannot read environment variables, so they are written
// at build time from BACKEND_URL (the API's https origin, e.g. https://studio-api-123.asia-south1.run.app).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps/web/dist/_redirects');
const backend = (process.env.BACKEND_URL ?? '').trim().replace(/\/+$/, '');

if (!/^https:\/\/[^\s/]+$/.test(backend)) {
  console.error('BACKEND_URL must be the https origin of the API, e.g. https://studio-api-123.asia-south1.run.app');
  process.exit(1);
}

const rules = [
  // 200 = rewrite (proxy): the browser keeps one origin, so the session cookie just works.
  `/api/*     ${backend}/api/:splat     200!`,
  // No "!": a built bundle under /assets is served as a file; anything else (an upload) is proxied.
  `/assets/*  ${backend}/assets/:splat  200`,
  // Every other path is a route of the single-page app.
  `/*         /index.html               200`,
];
writeFileSync(out, `${rules.join('\n')}\n`);
console.log(`Wrote ${path.relative(root, out)} -> ${backend}`);
