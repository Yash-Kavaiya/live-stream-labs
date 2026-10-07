import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingDto } from '@studio/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { newId } from '../crypto';
import { broadcasts, recordings } from '../db/schema';
import { badRequest, notFound, requireUserId, type Deps } from '../http/context';
import { getOwnedBroadcast } from '../services/broadcasts';

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** Music the host uploads to play under the show. */
const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};
const ASSET_TYPES = { ...IMAGE_TYPES, ...AUDIO_TYPES };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9_-]+\.[a-z0-9]+$/;

/** Streams a file with HTTP Range support so browsers can seek in recordings. */
async function sendFile(req: FastifyRequest, reply: FastifyReply, file: string, type: string) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw notFound('File');

  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  reply.header('accept-ranges', 'bytes').type(type);
  if (!match || (!match[1] && !match[2])) {
    return reply.header('content-length', info.size).send(createReadStream(file));
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
  if (start > end) return reply.code(416).header('content-range', `bytes */${info.size}`).send();
  return reply
    .code(206)
    .header('content-range', `bytes ${start}-${end}/${info.size}`)
    .header('content-length', end - start + 1)
    .send(createReadStream(file, { start, end }));
}

export function fileRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const assetsDir = path.join(config.dataDir, 'assets');
  const recordingsDir = path.join(config.dataDir, 'recordings');

  app.addContentTypeParser(
    Object.keys(ASSET_TYPES),
    { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES },
    (_req, body, done) => done(null, body),
  );

  // --- Brand assets, shared images and music. Raster images only: SVG could carry script. ---

  app.post('/api/broadcasts/:id/assets', async (req) => {
    const userId = await requireUserId(deps, req);
    await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const type = (req.headers['content-type'] ?? '').split(';')[0]!;
    const ext = ASSET_TYPES[type];
    if (!ext || !Buffer.isBuffer(req.body)) {
      throw badRequest('Upload a PNG, JPEG, WebP or GIF image, or an MP3, WAV, OGG or M4A track');
    }
    if (type in IMAGE_TYPES && req.body.length > MAX_IMAGE_BYTES) throw badRequest('Images can be up to 5 MB');

    const name = `${newId()}.${ext}`;
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, name), req.body);
    return { url: `/assets/${name}` };
  });

  app.get('/assets/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const ext = name.split('.').pop() ?? '';
    const type = Object.entries(ASSET_TYPES).find(([, e]) => e === ext)?.[0];
    if (!SAFE_NAME.test(name) || !type) throw notFound('Asset');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return sendFile(req, reply, path.join(assetsDir, name), type);
  });

  // --- Recordings. The share token is the capability: anyone with the link can watch. ---

  app.get('/api/recordings', async (req): Promise<RecordingDto[]> => {
    const userId = await requireUserId(deps, req);
    const rows = await db
      .select({ recording: recordings, title: broadcasts.title })
      .from(recordings)
      .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
      .where(eq(broadcasts.userId, userId))
      .orderBy(desc(recordings.createdAt));
    return rows.map(({ recording, title }) => ({
      id: recording.id,
      broadcastId: recording.broadcastId,
      broadcastTitle: title,
      sizeBytes: recording.sizeBytes,
      createdAt: recording.createdAt.toISOString(),
      shareToken: recording.shareToken,
    }));
  });

  app.delete('/api/recordings/:id', async (req) => {
    const userId = await requireUserId(deps, req);
    const { id } = req.params as { id: string };
    const [row] = await db
      .select({ id: recordings.id })
      .from(recordings)
      .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
      .where(and(eq(recordings.id, id), eq(broadcasts.userId, userId)));
    if (!row) throw notFound('Recording');
    await db.delete(recordings).where(eq(recordings.id, id));
    return { ok: true };
  });

  async function sharedRecording(token: string) {
    const [row] = await db
      .select({ recording: recordings, title: broadcasts.title })
      .from(recordings)
      .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
      .where(eq(recordings.shareToken, token));
    if (!row || !SAFE_NAME.test(row.recording.file)) throw notFound('Recording');
    return row;
  }

  app.get('/api/watch/:token', async (req) => {
    const { recording, title } = await sharedRecording((req.params as { token: string }).token);
    return { title, createdAt: recording.createdAt.toISOString(), sizeBytes: recording.sizeBytes };
  });

  app.get('/api/watch/:token/video', async (req, reply) => {
    const { recording } = await sharedRecording((req.params as { token: string }).token);
    if ((req.query as { download?: string }).download) {
      reply.header('content-disposition', `attachment; filename="${recording.file}"`);
    }
    return sendFile(req, reply, path.join(recordingsDir, recording.file), 'video/mp4');
  });
}
