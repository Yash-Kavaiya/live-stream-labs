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
  /** How long a broadcast whose connection dropped waits for the host's browser to come back. */
  reconnectGraceMs?: number;
}

const DEFAULT_RECONNECT_GRACE_MS = 30_000;
/** How often an ingest connection must answer a ping; a dead network otherwise looks open for minutes. */
const HEARTBEAT_MS = 5_000;

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
const CLOSE_RESTARTING = 1012;

/** The host ended the stream on purpose: a close frame with no code, or a normal close. */
function isDeliberateClose(code: number): boolean {
  return code === 1000 || code === 1005;
}

interface Entry {
  session: EgressSession;
  socket: WebSocket;
  /** The connection went away without the host ending the stream; the browser may come back. */
  dropped: boolean;
  /** A newer connection took over this broadcast. */
  replaced: boolean;
  alive: boolean;
}

/**
 * Accepts the host browser's program stream on `/ingest?token=...` and runs one ffmpeg per
 * broadcast. The worker is stateless: any instance can take any ingest connection.
 *
 * A connection that drops (a network blip, a worker restart) does not end the broadcast. Each
 * connection carries a stream of its own, so its ffmpeg ends with it, but the platforms are told
 * the broadcast is over only if the browser has not reconnected within the grace period.
 */
export function startWorker(cfg: WorkerConfig, api: ApiClient = httpApiClient(cfg)): Server {
  const graceMs = cfg.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
  const sessions = new Map<string, Entry>();
  /** The final status of a dropped broadcast, held back until the grace period runs out. */
  const pendingEnds = new Map<string, NodeJS.Timeout>();
  const log = (message: string) => console.log(`[worker] ${message}`);

  const server = createServer((req, res) => {
    // Cloud Run keeps /healthz for itself and never passes it on, so /health answers too.
    if (req.url === '/healthz' || req.url === '/health') {
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

    // The host reconnected, or reloaded the studio: the new connection wins.
    const previous = sessions.get(job.broadcastId);
    if (previous) {
      previous.replaced = true;
      previous.socket.close(CLOSE_REPLACED, 'Replaced by a new connection');
      previous.session.stop();
      await previous.session.done;
    }
    const pending = pendingEnds.get(job.broadcastId);
    if (pending) {
      clearTimeout(pending);
      pendingEnds.delete(job.broadcastId);
      log(`${job.broadcastId} the host reconnected; the broadcast carries on`);
    }

    let queue = Promise.resolve();
    const report = (status: EgressStatus) => {
      queue = queue.then(() => api.report(status));
    };
    const entry: Entry = { session: undefined!, socket, dropped: false, replaced: false, alive: true };
    entry.session = new EgressSession({
      job,
      ffmpegPath: cfg.ffmpegPath,
      recordingsDir: path.join(cfg.dataDir, 'recordings'),
      log: (message) => log(`${job.broadcastId} ${message}`),
      onStatus: (status) => {
        const over = status.state === 'ended' || status.state === 'failed';
        if (!over || !(entry.dropped || entry.replaced)) return report(status);
        // Not over yet: the destinations are waiting for the stream to come back. The recording of
        // the part that did go out is kept either way.
        report({
          ...status,
          state: 'starting',
          error: null,
          targets: status.targets.map((t) => ({ ...t, status: 'connecting', error: null })),
        });
        if (entry.replaced) return;
        log(`${job.broadcastId} the connection dropped; waiting ${graceMs / 1000} s for the host to come back`);
        const timer = setTimeout(() => {
          pendingEnds.delete(job.broadcastId);
          log(`${job.broadcastId} the host did not come back; ending the broadcast`);
          report(status);
        }, graceMs);
        timer.unref();
        pendingEnds.set(job.broadcastId, timer);
      },
    });
    const { session } = entry;
    sessions.set(job.broadcastId, entry);

    socket.off('message', buffer);
    for (const chunk of early) session.write(chunk);
    socket.on('message', (data: Buffer, isBinary) => {
      if (isBinary) session.write(data);
    });
    socket.on('pong', () => (entry.alive = true));
    socket.on('close', (code) => {
      if (!isDeliberateClose(code)) entry.dropped = true;
      session.stop();
    });
    socket.on('error', () => {
      entry.dropped = true;
      session.stop();
    });

    await session.done;
    if (sessions.get(job.broadcastId) === entry) sessions.delete(job.broadcastId);
    if (socket.readyState === socket.OPEN) socket.close(CLOSE_ENDED, 'The streaming server ended the stream');
  });

  // A connection whose network died never closes by itself; one that misses a ping is let go.
  const heartbeat = setInterval(() => {
    for (const entry of sessions.values()) {
      if (entry.socket.readyState !== entry.socket.OPEN) continue;
      if (!entry.alive) {
        entry.dropped = true;
        entry.socket.terminate();
        continue;
      }
      entry.alive = false;
      entry.socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    // A worker restart is not the host ending the stream: the browser reconnects to the next one.
    for (const entry of sessions.values()) {
      entry.dropped = true;
      entry.socket.close(CLOSE_RESTARTING, 'The streaming server is restarting');
      entry.session.stop();
    }
  });

  server.listen(cfg.port, '0.0.0.0', () => log(`listening on :${cfg.port}`));
  return server;
}
