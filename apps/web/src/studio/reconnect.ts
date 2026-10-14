// Close codes the media worker sends when it ends the stream on purpose (see apps/media-worker).
const CLOSE_ENDED = 4000;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_REPLACED = 4409;

/**
 * How long the browser keeps trying to get back to the streaming server. The worker waits 30 s
 * before telling the platforms the broadcast is over, so this stays inside that.
 */
export const RECONNECT_WINDOW_MS = 25_000;

/** No byte has left the browser for this long: the connection is dead even if it looks open. */
export const STALL_LIMIT_MS = 10_000;

/** True when a closed ingest connection is worth opening again rather than ending the stream. */
export function shouldReconnect(code: number): boolean {
  return code !== CLOSE_ENDED && code !== CLOSE_UNAUTHORIZED && code !== CLOSE_REPLACED;
}

/** Wait before the attempt after `failures` failed ones: quick at first, then every 4 s. */
export function reconnectDelay(failures: number): number {
  return Math.min(500 * 2 ** failures, 4_000);
}

/**
 * Watches a WebSocket's send buffer. A connection whose network went away keeps accepting sends
 * for minutes without closing; what gives it away is that nothing leaves the buffer.
 */
export class StallWatch {
  private lastBuffered = 0;
  private lastDrainAt: number;

  constructor(
    private readonly limitMs: number,
    now: number,
  ) {
    this.lastDrainAt = now;
  }

  /** Call with `bufferedAmount` before each send. True once nothing has left for the limit. */
  check(buffered: number, now: number): boolean {
    if (buffered === 0 || buffered < this.lastBuffered) this.lastDrainAt = now;
    return now - this.lastDrainAt > this.limitMs;
  }

  /** Call with `bufferedAmount` right after each send. */
  sent(buffered: number): void {
    this.lastBuffered = buffered;
  }
}
