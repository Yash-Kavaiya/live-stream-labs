import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { redactRtmpTarget, type EgressJob, type EgressStatus } from '@studio/shared';
import { buildFfmpegArgs, DEFAULT_ENCODE, isProgressLine, parseProgress, type EncodeSettings, type TeeOutput } from './ffmpeg-args';
import { DestinationRelay, type RetryPolicy } from './relay';

/** If ffmpeg cannot keep up, stop rather than buffer without bound. */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const KILL_AFTER_MS = 10_000;
/** How often the encoder's health goes to the log, and how soon a warning may repeat. */
const HEALTH_EVERY_MS = 30_000;
/** Below this share of real time the stream is falling behind and viewers will buffer. */
const SLOW_SPEED = 0.95;

export interface SessionOptions {
  job: EgressJob;
  ffmpegPath: string;
  recordingsDir: string;
  encode?: EncodeSettings;
  retry?: RetryPolicy;
  onStatus(status: EgressStatus): void;
  log(message: string): void;
}

/**
 * One live broadcast. One ffmpeg encodes the browser's stream once; its output goes to the
 * recording and, as MPEG-TS, to one relay per platform. Each relay is its own process that
 * reconnects by itself, so a platform that drops or slows down costs only that platform.
 */
export class EgressSession {
  private readonly ffmpeg: ChildProcessWithoutNullStreams;
  private readonly relays: { destinationId: string; relay: DestinationRelay }[];
  private readonly encode: EncodeSettings;
  readonly recordingFile: string | null;
  private state: EgressStatus['state'] = 'starting';
  private stopping = false;
  /** The encoder has exited and the relays are finishing. */
  private closing = false;
  /** The session stopped itself because ffmpeg fell too far behind; the host is told why. */
  private overloaded = false;
  private lastError: string | null = null;
  private killTimer: NodeJS.Timeout | undefined;
  private lastHealthAt = Date.now();
  /** Last few non-progress log lines, printed when ffmpeg exits abnormally. */
  private readonly logTail: string[] = [];
  readonly done: Promise<void>;

  constructor(private readonly opts: SessionOptions) {
    const { job } = opts;
    this.encode = opts.encode ?? DEFAULT_ENCODE;
    const outputs: TeeOutput[] = [{ format: 'mpegts', url: 'pipe:1' }];

    this.recordingFile = job.record ? `${job.broadcastId}-${Date.now()}.mp4` : null;
    if (this.recordingFile) {
      mkdirSync(opts.recordingsDir, { recursive: true });
      outputs.push({ format: 'mp4', url: path.join(opts.recordingsDir, this.recordingFile) });
    }

    opts.log(`starting ffmpeg -> ${job.targets.map((t) => redactRtmpTarget(t.url)).join(', ')}`);
    this.ffmpeg = spawn(opts.ffmpegPath, buildFfmpegArgs(outputs, this.encode), { stdio: 'pipe' });
    this.ffmpeg.stdin.on('error', () => undefined); // EPIPE when ffmpeg exits first.

    this.relays = job.targets.map((t) => ({
      destinationId: t.destinationId,
      relay: new DestinationRelay({
        url: t.url,
        ffmpegPath: opts.ffmpegPath,
        retry: opts.retry,
        onChange: () => this.emit(),
        log: opts.log,
      }),
    }));
    // The encoder is never held back by a platform: each relay buffers or restarts on its own.
    this.ffmpeg.stdout.on('data', (chunk: Buffer) => {
      for (const { relay } of this.relays) relay.write(chunk);
    });

    let tail = '';
    this.ffmpeg.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      // Progress lines end in \r, everything else in \n.
      const lines = (tail + chunk).split(/[\r\n]+/);
      tail = lines.pop() ?? '';
      for (const line of lines) this.onLogLine(line);
    });

    this.done = new Promise((resolve) => {
      const end = (code: number) => {
        if (this.closing) return;
        // The relays get what the encoder flushed, then end with it. Their own changes are not
        // reported on the way: the final status below covers them.
        this.closing = true;
        void Promise.all(this.relays.map(({ relay }) => relay.stop())).then(() => {
          this.finish(code);
          resolve();
        });
      };
      this.ffmpeg.once('error', (err) => {
        this.lastError = `ffmpeg could not start: ${err.message}`;
        end(1);
      });
      this.ffmpeg.once('close', (code) => end(code ?? 1));
    });
    this.emit();
  }

  /** Feeds one chunk of the browser's recording. Returns false once the session is over. */
  write(chunk: Buffer): boolean {
    if (this.stopping || this.ffmpeg.stdin.destroyed) return false;
    if (this.ffmpeg.stdin.writableLength > MAX_BUFFERED_BYTES) {
      this.lastError = 'This computer could not encode the stream fast enough, so it was stopped';
      this.overloaded = true;
      this.opts.log(this.lastError);
      this.stop();
      return false;
    }
    this.ffmpeg.stdin.write(chunk);
    return true;
  }

  /** Ends the input so ffmpeg flushes and finalises the recording; force-kills if it hangs. */
  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.ffmpeg.stdin.end();
    this.killTimer = setTimeout(() => this.ffmpeg.kill('SIGKILL'), KILL_AFTER_MS);
  }

  private onLogLine(line: string): void {
    this.reportHealth(line);
    // FFMPEG_LOG=1 prints ffmpeg's full log, for diagnosing a stream that will not start.
    if (process.env.FFMPEG_LOG) this.opts.log(`ffmpeg: ${line.trim()}`);
    if (line.trim() && !isProgressLine(line)) {
      this.logTail.push(line.trim());
      if (this.logTail.length > 12) this.logTail.shift();
    }
    if (this.state === 'starting' && isProgressLine(line)) {
      this.state = 'live';
      this.emit();
      return;
    }
    if (/\b(error|invalid|failed)\b/i.test(line) && !isProgressLine(line)) {
      this.lastError = line.trim().slice(0, 300);
    }
  }

  /**
   * Logs how the encoder is doing twice a minute. Platforms complain about a stream that arrives
   * slower than real time; this line says whether that started here or further along.
   */
  private reportHealth(line: string): void {
    const progress = parseProgress(line);
    const now = Date.now();
    if (!progress || now - this.lastHealthAt < HEALTH_EVERY_MS) return;
    this.lastHealthAt = now;
    const speed = progress.speed === null ? 'unknown' : `${progress.speed.toFixed(2)}x`;
    const behind = progress.speed !== null && progress.speed < SLOW_SPEED;
    this.opts.log(
      behind
        ? `encoder is behind: ${progress.fps} of ${this.encode.fps} frames a second, speed ${speed}. This computer or the incoming picture cannot keep up; viewers will see buffering.`
        : `encoder health: ${progress.fps} frames a second, speed ${speed}`,
    );
  }

  private finish(exitCode: number): void {
    clearTimeout(this.killTimer);
    if (this.state === 'ended' || this.state === 'failed') return;

    // A clean stop, or a crash after frames went out, both count as "ended". Falling too far
    // behind is a failure whenever it happens, so that the host hears the reason.
    const failed = this.overloaded || (!this.stopping && this.state === 'starting');
    this.state = failed ? 'failed' : 'ended';
    this.opts.log(`ffmpeg exited with code ${exitCode} (${this.state})`);
    if (exitCode !== 0) this.opts.log(`last ffmpeg output: ${this.logTail.join(' | ')}`);
    this.emit();
  }

  private recording(): EgressStatus['recording'] {
    if (!this.recordingFile || (this.state !== 'ended' && this.state !== 'failed')) return null;
    try {
      const { size } = statSync(path.join(this.opts.recordingsDir, this.recordingFile));
      return size > 0 ? { file: this.recordingFile, sizeBytes: size } : null;
    } catch {
      return null;
    }
  }

  private targets(): EgressStatus['targets'] {
    const over = this.state === 'ended' || this.state === 'failed';
    return this.relays.map(({ destinationId, relay }) => {
      if (!over || relay.status === 'failed') return { destinationId, status: relay.status, error: relay.error };
      // The encoder failing takes every platform with it, and the host is told why.
      return this.state === 'failed'
        ? { destinationId, status: 'failed', error: this.lastError ?? 'The stream could not be encoded' }
        : { destinationId, status: 'ended', error: null };
    });
  }

  private emit(): void {
    // The relays exist only once the constructor has made them.
    if (!this.relays) return;
    if (this.closing && this.state !== 'ended' && this.state !== 'failed') return;
    this.opts.onStatus({
      broadcastId: this.opts.job.broadcastId,
      attempt: this.opts.job.attempt,
      state: this.state,
      targets: this.targets(),
      error: this.state === 'failed' ? this.lastError : null,
      recording: this.recording(),
    });
  }
}
