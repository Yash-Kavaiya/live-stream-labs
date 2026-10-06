import { describe, expect, it } from 'vitest';
import { isPastRunTime, istDate, nextRunAt } from './schedule';

const at = (iso: string) => new Date(iso);

describe('the daily schedule', () => {
  it('uses the calendar day in India', () => {
    expect(istDate(at('2026-10-06T18:29:59Z'))).toBe('2026-10-06'); // 23:59 in India
    expect(istDate(at('2026-10-06T18:30:00Z'))).toBe('2026-10-07'); // midnight in India
    expect(istDate(at('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });

  it('runs at 17:00 in India, which is 11:30 UTC', () => {
    expect(nextRunAt(at('2026-10-06T05:00:00Z')).toISOString()).toBe('2026-10-06T11:30:00.000Z');
    expect(nextRunAt(at('2026-10-06T11:29:59Z')).toISOString()).toBe('2026-10-06T11:30:00.000Z');
  });

  it('moves to the next day once the hour has come', () => {
    expect(nextRunAt(at('2026-10-06T11:30:00Z')).toISOString()).toBe('2026-10-07T11:30:00.000Z');
    expect(nextRunAt(at('2026-10-06T16:00:00Z')).toISOString()).toBe('2026-10-07T11:30:00.000Z');
    // 01:30 on the 7th in India: today's run is still ahead.
    expect(nextRunAt(at('2026-10-06T20:00:00Z')).toISOString()).toBe('2026-10-07T11:30:00.000Z');
  });

  it("knows whether today's run time has passed", () => {
    expect(isPastRunTime(at('2026-10-06T10:30:00Z'))).toBe(false); // 16:00
    expect(isPastRunTime(at('2026-10-06T11:30:00Z'))).toBe(true); // 17:00
    expect(isPastRunTime(at('2026-10-06T13:00:00Z'))).toBe(true); // 18:30
    expect(isPastRunTime(at('2026-10-06T19:00:00Z'))).toBe(false); // 00:30 the next day
  });
});
