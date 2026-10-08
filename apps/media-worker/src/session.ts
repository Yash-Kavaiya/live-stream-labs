import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { redactRtmpTarget, type EgressJob, type EgressStatus, type TargetStatus } from '@studio/shared';
import { buildFfmpegArgs, DEFAULT_ENCODE, isProgressLine, isQueueOverflow, parseFailedOutput, parseProgress, parseUnopenedOutput, type TeeOutput } from './ffmpeg-args';

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
  onStatus(status: EgressStatus): void;
  log(message: string): void;
}

/**
 * One live broadcast: owns one ffmpeg process, feeds it the browser's stream and turns its log
 * into per-destination status.
 */
export class EgressSession {
  private readonly ffmpeg: ChildProcessWithoutNullStreams;
  private readonly targets: TargetStatus[];
  private readonly recordingFile: string | null;
  private state: EgressStatus['state'] = 'starting';
  private stopping = false;
  /** The session stopped itself because ffmpeg fell too far behind; the host is told why. */
  private overloaded = false;
  private lastError: string | null = null;
  private killTimer: NodeJS.Timeout | undefined;
  private lastHealthAt = Date.now();
  private lastOverflowAt = 0;
  /** Last few non-progress log lines, printed when ffmpeg exits abnormally. */
  private readonly logTail: string[] = [];
  readonly done: Promise<void>;

  constructor(private readonly opts: SessionOptions) {
    const { job } = opts;
    const outputs: TeeOutput[] = job.targets.map((t) => ({ format: 'flv', url: t.url }));
    this.targets = job.targets.map((t) => ({
      destinationId: t.destinationId,
      status: 'connecting',
      error: null,
    }));

    this.recordingFile = job.record ? `${job.broadcastId}-${Date.now()}.mp4` : null;
    if (this.recordingFile) {
      mkdirSync(opts.recordingsDir, { recursive: true });
      outputs.push({ format: 'mp4', url: path.join(opts.recordingsDir, this.recordingFile) });
    }

    opts.log(`starting ffmpeg -> ${job.targets.map((t) => redactRtmpTarget(t.url)).join(', ')}`);
    this.ffmpeg = spawn(opts.ffmpegPath, buildFfmpegArgs(outputs), { stdio: 'pipe' });
    this.ffmpeg.stdin.on('error', () => undefined); // EPIPE when ffmpeg exits first.

    let tail = '';
    this.ffmpeg.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      // Progress lines end in \r, everything else in \n.
      const lines = (tail + chunk).split(/[\r\n]+/);
      tail = lines.pop() ?? '';
      for (const line of lines) this.onLogLine(line);
    });

    this.done = new Promise((resolve) => {
      this.ffmpeg.once('error', (err) => {
        this.lastError = `ffmpeg could not start: ${err.message}`;
        this.finish(1);
        resolve();
      });
      this.ffmpeg.once('close', (code) => {
        this.finish(code ?? 1);
        resolve();
      });
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
    const unopened = parseUnopenedOutput(line);
    const failed = unopened === null ? parseFailedOutput(line) : this.opts.job.targets.findIndex((t) => t.url === unopened);
    if (failed !== null) {
      const target = this.targets[failed];
      // An index past the RTMP targets is the recording file.
      if (target && target.status !== 'failed') {
        target.status = 'failed';
        target.error = 'The platform closed the connection or rejected the stream key';
        this.opts.log(`target ${failed} failed: ${unopened === null ? line.trim() : `could not connect to ${redactRtmpTarget(unopened)}`}`);
        this.emit();
      }
      return;
    }
    if (isQueueOverflow(line)) {
      const now = Date.now();
      if (now - this.lastOverflowAt >= HEALTH_EVERY_MS) {
        this.lastOverflowAt = now;
        this.opts.log('a destination is taking the stream too slowly and part of it was dropped there. The upload is too slow for this many destinations; the others are not affected.');
      }
      return;
    }
    if (this.state === 'starting' && isProgressLine(line)) {
      this.state = 'live';
      for (const target of this.targets) {
        if (target.status === 'connecting') target.status = 'live';
      }
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
        ? `encoder is behind: ${progress.fps} of ${DEFAULT_ENCODE.fps} frames a second, speed ${speed}. This computer or the incoming picture cannot keep up; viewers will see buffering.`
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
    for (const target of this.targets) {
      if (target.status === 'failed') continue;
      target.status = failed ? 'failed' : 'ended';
      target.error = failed ? (this.lastError ?? `ffmpeg exited with code ${exitCode}`) : null;
    }
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

  private emit(): void {
    this.opts.onStatus({
      broadcastId: this.opts.job.broadcastId,
      state: this.state,
      targets: this.targets.map((t) => ({ ...t })),
      error: this.state === 'failed' ? this.lastError : null,
      recording: this.recording(),
    });
  }
}
