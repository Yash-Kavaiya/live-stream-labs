import { describe, expect, it } from 'vitest';
import { reconnectDelay, shouldReconnect, StallWatch } from './reconnect';

describe('reconnecting to the streaming server', () => {
  it('reconnects after a dropped network or a server restart', () => {
    expect(shouldReconnect(1006)).toBe(true); // No close frame: the network went away.
    expect(shouldReconnect(1012)).toBe(true); // The worker is restarting.
    expect(shouldReconnect(1011)).toBe(true);
    expect(shouldReconnect(1001)).toBe(true);
  });

  it('does not reconnect when the server ended the stream on purpose', () => {
    expect(shouldReconnect(4000)).toBe(false); // ffmpeg stopped: the reason is reported separately.
    expect(shouldReconnect(4401)).toBe(false); // The ingest token is no good.
    expect(shouldReconnect(4409)).toBe(false); // Another tab took over the broadcast.
  });

  it('waits a little longer after each failed attempt, up to a few seconds', () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 4000, 4000]);
  });
});

describe('noticing a connection that stopped moving', () => {
  it('is fine while the upload keeps draining, however slowly', () => {
    const watch = new StallWatch(10_000, 0);
    let buffered = 0;
    for (let t = 250; t <= 60_000; t += 250) {
      // Twice as much goes in as comes out: slow, but moving.
      expect(watch.check(buffered, t)).toBe(false);
      buffered += 100;
      watch.sent(buffered);
      buffered -= 50;
    }
  });

  it('calls it stalled once nothing has left for the limit', () => {
    const watch = new StallWatch(10_000, 0);
    let buffered = 0;
    let stalledAt = -1;
    for (let t = 250; t <= 20_000 && stalledAt < 0; t += 250) {
      if (watch.check(buffered, t)) stalledAt = t;
      buffered += 100;
      watch.sent(buffered);
    }
    // Every chunk drains at first (the buffer starts empty), then nothing does.
    expect(stalledAt).toBeGreaterThan(10_000);
    expect(stalledAt).toBeLessThanOrEqual(10_500);
  });

  it('is never stalled with nothing waiting to go out', () => {
    const watch = new StallWatch(10_000, 0);
    expect(watch.check(0, 60_000)).toBe(false);
  });
});
