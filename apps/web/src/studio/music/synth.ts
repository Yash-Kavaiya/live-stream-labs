/**
 * The studio's built-in music. Every track is computed sample by sample from a list of notes, so
 * there is no audio file to download and nothing to license. Rendering is deterministic: the same
 * track at the same sample rate always gives the same samples.
 */

export type TrackKind = 'sting' | 'bed';

export interface BuiltInTrack {
  id: string;
  name: string;
  /** A sting plays once; a bed loops until it is stopped. */
  kind: TrackKind;
  seconds: number;
}

export const BUILT_IN_TRACKS: BuiltInTrack[] = [
  { id: 'intro', name: 'Intro', kind: 'sting', seconds: 6 },
  { id: 'breaking', name: 'Breaking', kind: 'sting', seconds: 3 },
  { id: 'transition', name: 'Transition', kind: 'sting', seconds: 1.5 },
  { id: 'outro', name: 'Outro', kind: 'sting', seconds: 7 },
  { id: 'headlines', name: 'Headlines', kind: 'bed', seconds: 16 },
  { id: 'soft', name: 'Soft', kind: 'bed', seconds: 16 },
  { id: 'countdown', name: 'Countdown', kind: 'bed', seconds: 16 },
];

type Wave = 'sine' | 'tri' | 'saw' | 'square' | 'noise';

interface Note {
  /** Frequency in hertz. Ignored for noise. */
  f: number;
  /** Start and length in seconds. The attack and release happen inside the length. */
  t: number;
  d: number;
  wave: Wave;
  gain: number;
  attack?: number;
  release?: number;
  /** -1 is left, 1 is right. */
  pan?: number;
  /** Frequency the note slides to by its end. */
  to?: number;
  /** Low-pass cutoff in hertz, to take the edge off a saw or square, or to darken noise. */
  cut?: number;
}

/** Hertz of a MIDI note number; 69 is the A above middle C. */
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function addNote(left: Float32Array, right: Float32Array, rate: number, note: Note, seed: number): void {
  const start = Math.max(0, Math.round(note.t * rate));
  const end = Math.min(left.length, Math.round((note.t + note.d) * rate));
  if (end <= start) return;
  const attack = Math.max(0.002, note.attack ?? 0.008);
  const release = Math.max(0.002, note.release ?? 0.05);
  const pan = note.pan ?? 0;
  const gainL = note.gain * (1 - Math.max(0, pan));
  const gainR = note.gain * (1 + Math.min(0, pan));
  const smooth = note.cut ? 1 - Math.exp((-2 * Math.PI * note.cut) / rate) : 1;
  const count = end - start;

  let phase = 0;
  let filtered = 0;
  let random = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < count; i += 1) {
    const x = i / rate;
    const f = note.to === undefined ? note.f : note.f + (note.to - note.f) * (i / count);
    phase += f / rate;
    phase -= Math.floor(phase);
    let v: number;
    switch (note.wave) {
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'tri':
        v = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'square':
        v = phase < 0.5 ? 1 : -1;
        break;
      case 'noise':
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        v = random / 2147483648 - 1;
        break;
    }
    filtered += smooth * (v - filtered);
    const envelope = Math.min(1, x / attack) * Math.min(1, (note.d - x) / release);
    const out = filtered * envelope;
    left[start + i]! += out * gainL;
    right[start + i]! += out * gainR;
  }
}

// D minor, the key every track shares so a sting sits on top of a bed without clashing.
const D = 62;
const CHORDS = {
  dm: [62, 65, 69],
  bb: [58, 62, 65],
  f: [57, 60, 65],
  c: [55, 60, 64],
  gm: [55, 58, 62],
  a: [57, 61, 64],
};

const kick = (t: number, gain = 0.5): Note => ({ f: 130, to: 42, t, d: 0.2, wave: 'sine', gain, release: 0.12 });
const hat = (t: number, gain = 0.035, pan = 0.3): Note => ({ f: 0, t, d: 0.045, wave: 'noise', gain, release: 0.035, pan });
const pad = (chord: number[], t: number, d: number, gain: number, attack = 0.35, release = 0.6): Note[] =>
  chord.flatMap((m, i) => [
    { f: hz(m), t, d, wave: 'tri' as const, gain, attack, release, pan: (i - 1) * 0.5 },
    { f: hz(m) * 1.003, t, d, wave: 'sine' as const, gain: gain * 0.8, attack, release, pan: (1 - i) * 0.5 },
  ]);
const brass = (midi: number, t: number, d: number, gain = 0.15, release = 0.08): Note[] => [
  { f: hz(midi), t, d, wave: 'saw', gain, attack: 0.02, release, cut: 2600 },
  { f: hz(midi - 12), t, d, wave: 'saw', gain: gain * 0.6, attack: 0.02, release, cut: 1400 },
];
const bassLine = (midi: number, from: number, to: number, step: number, gain = 0.2): Note[] => {
  const notes: Note[] = [];
  for (let t = from; t < to - 1e-6; t += step) notes.push({ f: hz(midi), t, d: step * 0.9, wave: 'saw', gain, release: 0.04, cut: 500 });
  return notes;
};

function intro(): Note[] {
  const tune: [number, number, number][] = [
    [D, 0, 0.25], [D, 0.25, 0.25], [69, 0.5, 0.5], [65, 1, 0.25], [67, 1.25, 0.25], [69, 1.5, 0.5],
    [74, 2, 1], [72, 3, 0.5], [69, 3.5, 0.5],
  ];
  return [
    ...tune.flatMap(([m, t, d]) => brass(m, t, d)),
    ...brass(74, 4, 2, 0.17, 1.4),
    ...pad([50, 57, 62, 65, 69], 4, 2, 0.06, 0.03, 1.5),
    ...bassLine(38, 0, 4, 0.25),
    { f: hz(38), t: 4, d: 2, wave: 'saw', gain: 0.22, release: 1.5, cut: 420 },
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((t) => kick(t)),
    ...[0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75].map((t) => hat(t)),
    { f: 0, t: 4, d: 1.9, wave: 'noise', gain: 0.1, release: 1.8, cut: 6000 },
  ];
}

function breaking(): Note[] {
  const stab = (t: number, d: number, release: number): Note[] => [
    ...[62, 65, 69, 74].flatMap((m) => brass(m, t, d, 0.1, release)),
    { f: 95, to: 48, t, d: 0.35, wave: 'sine', gain: 0.5, release: 0.25 },
  ];
  const pings: Note[] = [];
  for (let t = 1; t < 2.4; t += 0.125) pings.push({ f: 1760, t, d: 0.05, wave: 'square', gain: 0.035, release: 0.03, cut: 4000, pan: t % 0.25 ? 0.5 : -0.5 });
  return [
    { f: 0, t: 0, d: 0.8, wave: 'noise', gain: 0.09, attack: 0.75, release: 0.05, cut: 5000 },
    ...stab(0, 0.3, 0.1),
    ...stab(0.4, 0.3, 0.1),
    ...stab(0.8, 2.2, 1.6),
    ...pings,
    ...bassLine(38, 0.8, 2.4, 0.125, 0.16),
  ];
}

function transition(): Note[] {
  return [
    { f: 0, t: 0, d: 1.1, wave: 'noise', gain: 0.16, attack: 0.5, release: 0.55, cut: 3500 },
    { f: 200, to: 1200, t: 0, d: 0.55, wave: 'sine', gain: 0.08, attack: 0.3, release: 0.1 },
    ...[62, 69, 74].flatMap((m) => brass(m, 0.55, 0.95, 0.12, 0.8)),
    kick(0.55, 0.45),
  ];
}

function outro(): Note[] {
  const tune: [number, number][] = [[74, 0], [72, 0.5], [69, 1], [67, 1.5], [65, 2], [64, 2.5]];
  return [
    ...tune.flatMap(([m, t]) => brass(m, t, 0.5)),
    ...brass(D, 3, 4, 0.16, 3.2),
    ...pad(CHORDS.bb, 0, 1.5, 0.06, 0.05, 0.3),
    ...pad(CHORDS.c, 1.5, 1.5, 0.06, 0.05, 0.3),
    ...pad([50, 57, 62, 65, 69], 3, 4, 0.06, 0.05, 3.2),
    ...bassLine(34, 0, 1.5, 0.25),
    ...bassLine(36, 1.5, 3, 0.25),
    { f: hz(38), t: 3, d: 4, wave: 'saw', gain: 0.22, release: 3.2, cut: 420 },
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => kick(t)),
    { f: 0, t: 3, d: 2.5, wave: 'noise', gain: 0.08, release: 2.4, cut: 6000 },
  ];
}

/** Sixteen seconds at 120 beats a minute: four chords, two bars each. */
function headlines(): Note[] {
  const notes: Note[] = [];
  const progression = [CHORDS.dm, CHORDS.bb, CHORDS.f, CHORDS.c];
  progression.forEach((chord, bar) => {
    const t0 = bar * 4;
    notes.push(...pad(chord, t0, 4, 0.045));
    notes.push(...bassLine(chord[0]! - 24, t0, t0 + 4, 0.25, 0.17));
    for (let beat = 0; beat < 8; beat += 1) {
      const t = t0 + beat * 0.5;
      notes.push(kick(t, 0.38), hat(t + 0.25, 0.03, beat % 2 ? 0.4 : -0.4));
      // A plucked figure walking through the chord, the "newsroom pulse".
      const m = chord[beat % 3]! + 12;
      notes.push({ f: hz(m), t, d: 0.22, wave: 'square', gain: 0.04, release: 0.15, cut: 2200, pan: beat % 2 ? 0.6 : -0.6 });
      notes.push({ f: hz(m), t: t + 0.25, d: 0.2, wave: 'square', gain: 0.025, release: 0.15, cut: 1800, pan: beat % 2 ? -0.6 : 0.6 });
    }
  });
  return notes;
}

function soft(): Note[] {
  const notes: Note[] = [];
  [CHORDS.dm, CHORDS.bb, CHORDS.f, CHORDS.c].forEach((chord, bar) => {
    const t0 = bar * 4;
    notes.push(...pad(chord, t0, 4, 0.07, 1, 1.2));
    notes.push({ f: hz(chord[0]! - 12), t: t0, d: 4, wave: 'sine', gain: 0.14, attack: 0.4, release: 1 });
    for (let i = 0; i < 4; i += 1) {
      const m = chord[[0, 2, 1, 2][i]!]! + 12;
      notes.push({ f: hz(m), t: t0 + i, d: 0.9, wave: 'tri', gain: 0.07, attack: 0.01, release: 0.8, pan: i % 2 ? 0.5 : -0.5 });
    }
  });
  return notes;
}

function countdown(): Note[] {
  const notes: Note[] = [];
  [CHORDS.dm, CHORDS.f, CHORDS.gm, CHORDS.a].forEach((chord, bar) => {
    const t0 = bar * 4;
    // Each bar is a little louder than the last, so the loop builds and then starts over.
    const lift = 1 + bar * 0.25;
    notes.push(...pad(chord, t0, 4, 0.04 * lift));
    notes.push(...bassLine(38, t0, t0 + 4, 0.25, 0.13 * lift));
    for (let tick = 0; tick < 8; tick += 1) {
      const t = t0 + tick * 0.5;
      notes.push({ f: tick % 4 === 0 ? 1500 : 1000, t, d: 0.035, wave: 'square', gain: 0.1, release: 0.02, cut: 5000 });
      if (tick % 2 === 0) notes.push(kick(t, 0.3));
    }
  });
  return notes;
}

const SCORES: Record<string, () => Note[]> = { intro, breaking, transition, outro, headlines, soft, countdown };
const EDGE_FADE = 0.02;

/** Stereo samples between -1 and 1 for one built-in track. */
export function renderTrack(id: string, sampleRate: number): [Float32Array, Float32Array] {
  const track = BUILT_IN_TRACKS.find((t) => t.id === id);
  const score = SCORES[id];
  if (!track || !score) throw new Error(`Unknown track: ${id}`);

  const length = Math.round(track.seconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  score().forEach((note, index) => addNote(left, right, sampleRate, note, index + 1));

  // A soft limiter keeps a dense moment from clipping, and a short fade at both ends keeps a
  // looping bed from clicking where it wraps around.
  const fade = Math.max(1, Math.round(EDGE_FADE * sampleRate));
  for (let i = 0; i < length; i += 1) {
    const edge = Math.min(1, i / fade, (length - 1 - i) / fade);
    left[i] = Math.tanh(left[i]! * 1.3) * edge;
    right[i] = Math.tanh(right[i]! * 1.3) * edge;
  }
  return [left, right];
}
