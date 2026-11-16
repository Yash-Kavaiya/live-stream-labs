import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { redactRtmpTarget, type DestinationStatus } from '@studio/shared';
import { buildRelayArgs, isProgressLine } from './ffmpeg-args';

export interface RetryPolicy {
  /** Wait before the first retry; doubles on each failure in a row. */
  baseMs: number;
  /** The longest wait between two attempts. */
  maxMs: number;
  /**
   * A destination that has never gone live is given up on after this many failures in a row:
   * that is a wrong stream key or address, not a network blip. Once it has been live, it is
   * retried for as long as the broadcast lasts.
   */
  maxFailuresBeforeLive: number;
}

export const DEFAULT_RETRY: RetryPolicy = { baseMs: 1_000, maxMs: 30_000, maxFailuresBeforeLive: 5 };

/** About 10 s of a 6 Mbit/s stream. A platform further behind than this is restarted. */
const MAX_BACKLOG_BYTES = 8 * 1024 * 1024;
const KILL_AFTER_MS = 5_000;
const REJECTED = 'The platform closed the connection or rejected the stream key';

export interface RelayOptions {
  url: string;
  ffmpegPath: string;
  retry?: RetryPolicy;
  /** Called whenever `status` or `error` changes. */
  onChange(): void;
  log(message: string): void;
}

/** Wait before the attempt after `failures` failed ones. */
export function retryDelay(policy: RetryPolicy, failures: number): number {
  return Math.min(policy.baseMs * 2 ** Math.max(0, failures - 1), policy.maxMs);
}

/**
 * One platform's copy of the program. Runs its own ffmpeg, so a platform that drops, stalls or
 * refuses the stream affects nobody else, and is reconnected on its own with a growing wait.
 */
export class DestinationRelay {
  status: DestinationStatus = 'connecting';
  error: string | null = null;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly retry: RetryPolicy;
  private failures = 0;
  private everLive = false;
  private stopping = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private lastLine = '';
  private closed: Promise<void> = Promise.resolve();

  constructor(private readonly opts: RelayOptions) {
    this.retry = opts.retry ?? DEFAULT_RETRY;
    this.spawn();
  }

  /** Feeds one chunk of the encoded program. Never blocks the caller. */
  write(chunk: Buffer): void {
    const proc = this.proc;
    if (!proc || this.stopping || proc.stdin.destroyed || !proc.stdin.writable) return;
    if (proc.stdin.writableLength > MAX_BACKLOG_BYTES) {
      this.opts.log(`${this.name} is taking the stream too slowly; reconnecting it so it catches up`);
      proc.kill('SIGKILL');
      return;
    }
    proc.stdin.write(chunk);
  }

  /** Ends this destination's stream. Resolves once its ffmpeg has exited. */
  stop(): Promise<void> {
    if (this.stopping) return this.closed;
    this.stopping = true;
    clearTimeout(this.retryTimer);
    const proc = this.proc;
    if (!proc) {
      this.settle(null);
      return this.closed;
    }
    proc.stdin.end();
    const kill = setTimeout(() => proc.kill('SIGKILL'), KILL_AFTER_MS);
    kill.unref();
    void this.closed.then(() => clearTimeout(kill));
    return this.closed;
  }

  /** The final status, once the broadcast is over for this destination. */
  private settle(exitCode: number | null): void {
    if (this.status === 'failed') return;
    // One that never got through is reported as failed, with the reason, rather than as ended.
    const neverGotThrough = !this.everLive && (this.failures > 0 || (exitCode !== null && exitCode !== 0));
    if (neverGotThrough) this.set('failed', REJECTED);
    else this.set('ended', null);
  }

  private get name(): string {
    return redactRtmpTarget(this.opts.url);
  }

  private spawn(): void {
    const proc = spawn(this.opts.ffmpegPath, buildRelayArgs(this.opts.url), { stdio: 'pipe' });
    this.proc = proc;
    proc.stdin.on('error', () => undefined); // EPIPE when ffmpeg exits first.
    proc.stdout.resume();

    let tail = '';
    proc.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (tail + chunk).split(/[\r\n]+/);
      tail = lines.pop() ?? '';
      for (const line of lines) this.onLine(line);
    });

    this.closed = new Promise((resolve) => {
      proc.once('error', (err) => {
        this.lastLine = `ffmpeg could not start: ${err.message}`;
      });
      proc.once('close', (code) => {
        this.onExit(code);
        resolve();
      });
    });
  }

  private onLine(line: string): void {
    if (process.env.FFMPEG_LOG) this.opts.log(`relay ${this.name}: ${line.trim()}`);
    if (isProgressLine(line)) {
      if (this.status !== 'live') {
        if (this.failures > 0) this.opts.log(`${this.name} is back`);
        this.everLive = true;
        this.failures = 0;
        this.set('live', null);
      }
      return;
    }
    if (line.trim()) this.lastLine = line.trim().slice(0, 300);
  }

  private onExit(code: number | null): void {
    this.proc = null;
    if (this.stopping) return this.settle(code);

    this.failures += 1;
    this.opts.log(`${this.name} dropped (ffmpeg exit ${code ?? 'signal'}): ${this.lastLine}`);
    if (!this.everLive && this.failures >= this.retry.maxFailuresBeforeLive) {
      this.set('failed', REJECTED);
      return;
    }
    const delay = retryDelay(this.retry, this.failures);
    this.set('connecting', `Reconnecting (attempt ${this.failures + 1})`);
    this.retryTimer = setTimeout(() => {
      if (!this.stopping) this.spawn();
    }, delay);
  }

  private set(status: DestinationStatus, error: string | null): void {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    this.opts.onChange();
  }
}
