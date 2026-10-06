import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { egressJobSchema, type EgressJob, type EgressStatus } from '@studio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { EgressSession } from './session';

export interface WorkerConfig {
  port: number;
  apiUrl: string;
  internalSecret: string;
  dataDir: string;
  ffmpegPath: string;
}

export interface ApiClient {
  claim(token: string): Promise<EgressJob | null>;
  report(status: EgressStatus): Promise<void>;
}

export function httpApiClient(cfg: Pick<WorkerConfig, 'apiUrl' | 'internalSecret'>): ApiClient {
  const post = (pathname: string, body: unknown) =>
    fetch(`${cfg.apiUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': cfg.internalSecret },
      body: JSON.stringify(body),
    });

  return {
    async claim(token) {
      const res = await post('/internal/egress/claim', { token });
      return res.ok ? egressJobSchema.parse(await res.json()) : null;
    },
    async report(status) {
      // Statuses are sent in order; a lost one is corrected by the next.
      await post('/internal/egress/status', status).catch(() => undefined);
    },
  };
}

// WebSocket close codes in the application range.
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_REPLACED = 4409;
const CLOSE_ENDED = 4000;

/**
 * Accepts the host browser's program stream on `/ingest?token=...` and runs one ffmpeg per
 * broadcast. The worker is stateless: any instance can take any ingest connection.
 */
export function startWorker(cfg: WorkerConfig, api: ApiClient = httpApiClient(cfg)): Server {
  const sessions = new Map<string, { session: EgressSession; socket: WebSocket }>();
  const log = (message: string) => console.log(`[worker] ${message}`);

  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: '/ingest', maxPayload: 16 * 1024 * 1024 });

  wss.on('connection', async (socket, req) => {
    const token = new URL(req.url ?? '', 'http://worker').searchParams.get('token') ?? '';
    // Chunks can arrive while the claim is still in flight; ffmpeg needs every byte from the first.
    const early: Buffer[] = [];
    const buffer = (data: Buffer) => early.push(data);
    socket.on('message', buffer);

    const job = await api.claim(token).catch(() => null);
    if (!job) return socket.close(CLOSE_UNAUTHORIZED, 'Invalid ingest token');
    if (socket.readyState !== socket.OPEN) return;

    // The host reloaded the studio: the new connection wins.
    const previous = sessions.get(job.broadcastId);
    if (previous) {
      previous.socket.close(CLOSE_REPLACED, 'Replaced by a new connection');
      previous.session.stop();
      await previous.session.done;
    }

    let queue = Promise.resolve();
    const session = new EgressSession({
      job,
      ffmpegPath: cfg.ffmpegPath,
      recordingsDir: path.join(cfg.dataDir, 'recordings'),
      log: (message) => log(`${job.broadcastId} ${message}`),
      onStatus: (status) => {
        queue = queue.then(() => api.report(status));
      },
    });
    const entry = { session, socket };
    sessions.set(job.broadcastId, entry);

    socket.off('message', buffer);
    for (const chunk of early) session.write(chunk);
    socket.on('message', (data: Buffer, isBinary) => {
      if (isBinary) session.write(data);
    });
    socket.on('close', () => session.stop());
    socket.on('error', () => session.stop());

    await session.done;
    if (sessions.get(job.broadcastId) === entry) sessions.delete(job.broadcastId);
    if (socket.readyState === socket.OPEN) socket.close(CLOSE_ENDED, 'Stream ended');
  });

  server.on('close', () => {
    for (const { session } of sessions.values()) session.stop();
  });

  server.listen(cfg.port, '0.0.0.0', () => log(`listening on :${cfg.port}`));
  return server;
}
