import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { redactRtmpTarget, type EgressJob, type EgressStatus, type TargetStatus } from '@studio/shared';
import { buildFfmpegArgs, isProgressLine, parseFailedOutput, type TeeOutput } from './ffmpeg-args';

/** If ffmpeg cannot keep up, stop rather than buffer without bound. */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const KILL_AFTER_MS = 10_000;

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
  private lastError: string | null = null;
  private killTimer: NodeJS.Timeout | undefined;
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
      this.lastError = 'The encoder could not keep up with the incoming stream';
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
    const failed = parseFailedOutput(line);
    if (failed !== null) {
      const target = this.targets[failed];
      // An index past the RTMP targets is the recording file.
      if (target && target.status !== 'failed') {
        target.status = 'failed';
        target.error = 'The platform closed the connection or rejected the stream key';
        this.opts.log(`target ${failed} failed: ${line.trim()}`);
        this.emit();
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

  private finish(exitCode: number): void {
    clearTimeout(this.killTimer);
    if (this.state === 'ended' || this.state === 'failed') return;

    // A clean stop, or a crash after frames went out, both count as "ended".
    const failed = !this.stopping && this.state === 'starting';
    this.state = failed ? 'failed' : 'ended';
    for (const target of this.targets) {
      if (target.status === 'failed') continue;
      target.status = failed ? 'failed' : 'ended';
      target.error = failed ? (this.lastError ?? `ffmpeg exited with code ${exitCode}`) : null;
    }
    this.opts.log(`ffmpeg exited with code ${exitCode} (${this.state})`);
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
