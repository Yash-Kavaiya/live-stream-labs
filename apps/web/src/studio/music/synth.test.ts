import { describe, expect, it } from 'vitest';
import { BUILT_IN_TRACKS, renderTrack } from './synth';

const RATE = 8000; // A low rate keeps the test fast; the maths does not depend on it.
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('built-in music', () => {
  it('has four stings and three beds', () => {
    expect(BUILT_IN_TRACKS.filter((t) => t.kind === 'sting').map((t) => t.id)).toEqual(['intro', 'breaking', 'transition', 'outro']);
    expect(BUILT_IN_TRACKS.filter((t) => t.kind === 'bed').map((t) => t.id)).toEqual(['headlines', 'soft', 'countdown']);
  });

  it.each(BUILT_IN_TRACKS)('$id is audible, the stated length, and never clips', (track) => {
    const [left, right] = renderTrack(track.id, RATE);
    expect(left.length).toBe(Math.round(track.seconds * RATE));
    expect(right.length).toBe(left.length);
    expect(rms(left)).toBeGreaterThan(0.02);
    expect(rms(right)).toBeGreaterThan(0.02);
    expect(Math.max(peak(left), peak(right))).toBeLessThanOrEqual(1);
  });

  it('renders the same samples every time', () => {
    expect(renderTrack('breaking', RATE)[0]).toEqual(renderTrack('breaking', RATE)[0]);
  });

  it.each(BUILT_IN_TRACKS.filter((t) => t.kind === 'bed'))('$id starts and ends near silence so it loops without a click', (track) => {
    const [left] = renderTrack(track.id, RATE);
    expect(Math.abs(left[0]!)).toBeLessThan(0.01);
    expect(Math.abs(left[left.length - 1]!)).toBeLessThan(0.01);
  });

  it('throws on an unknown track', () => {
    expect(() => renderTrack('nope', RATE)).toThrow('Unknown track');
  });
});
