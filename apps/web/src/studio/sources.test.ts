import { describe, expect, it } from 'vitest';
import { onAir, programAudio, type StudioSource } from './sources';

const track = (id: string) => ({ id }) as MediaStreamTrack;

function source(id: string, audio: MediaStreamTrack[], speaking = false): StudioSource {
  const [kind, identity] = id.split(':') as [StudioSource['kind'], string];
  return { id, kind, identity, label: id, isLocal: false, video: null, audio, speaking };
}

const hostMic = track('host-mic');
const tabSound = track('host-tab');
const guestMic = track('guest-mic');
const sources = [
  source('cam:host', [hostMic], true),
  source('screen:host', [tabSound]),
  source('cam:guest', [guestMic]),
];

describe('programAudio', () => {
  it('keeps the presenter audible when only their screen is on stage', () => {
    expect(programAudio(sources, { screen: 'live', stage: ['screen:host'] })).toEqual([hostMic, tabSound]);
  });

  it('mixes each track once when a camera and a screen are both on stage', () => {
    expect(programAudio(sources, { screen: 'live', stage: ['cam:host', 'screen:host'] })).toEqual([hostMic, tabSound]);
  });

  it('leaves out a shared screen that is off stage, and people who are off stage', () => {
    expect(programAudio(sources, { screen: 'live', stage: ['cam:host'] })).toEqual([hostMic]);
  });

  it('is silent on a holding screen', () => {
    expect(programAudio(sources, { screen: 'brb', stage: ['cam:host', 'cam:guest'] })).toEqual([]);
  });
});

describe('onAir', () => {
  it('names everyone with a camera, screen or video on stage', () => {
    expect([...onAir(sources, { screen: 'live', stage: ['screen:host', 'media'] })]).toEqual(['host']);
    expect(onAir(sources, { screen: 'starting', stage: ['screen:host'] }).size).toBe(0);
  });
});
