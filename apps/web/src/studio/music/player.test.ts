import { describe, expect, it } from 'vitest';
import { musicLevel } from './player';

describe('musicLevel', () => {
  it('is the volume when nobody speaks', () => expect(musicLevel(0.8, false, true)).toBe(0.8));
  it('drops to a quarter while someone speaks', () => expect(musicLevel(0.8, true, true)).toBeCloseTo(0.2));
  it('ignores speech when ducking is off', () => expect(musicLevel(0.8, true, false)).toBe(0.8));
  it('clamps a bad volume', () => {
    expect(musicLevel(7, false, true)).toBe(1);
    expect(musicLevel(-1, false, true)).toBe(0);
    expect(musicLevel(Number.NaN, false, true)).toBe(0);
  });
});
