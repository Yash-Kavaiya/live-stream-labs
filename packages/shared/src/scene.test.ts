import { describe, expect, it } from 'vitest';
import { buildRtmpTarget, redactRtmpTarget } from './platforms';
import {
  activeBanners,
  addBanner,
  addToStage,
  bannerInSlot,
  hideAllBanners,
  removeBanner,
  toggleBanner,
  type Banner,
  DEFAULT_SCENE,
  MAX_ON_STAGE,
  moveOnStage,
  parseSourceId,
  promoteOnStage,
  removeFromStage,
  removeParticipantSources,
  sceneSchema,
} from './scene';

describe('scene transitions', () => {
  it('adds a source once', () => {
    const a = addToStage(DEFAULT_SCENE, 'cam:a');
    expect(a.stage).toEqual(['cam:a']);
    expect(addToStage(a, 'cam:a')).toBe(a);
  });

  it('refuses to exceed the stage limit', () => {
    let scene = DEFAULT_SCENE;
    for (let i = 0; i < MAX_ON_STAGE + 3; i++) scene = addToStage(scene, `cam:${i}`);
    expect(scene.stage).toHaveLength(MAX_ON_STAGE);
  });

  it('removes, promotes and moves', () => {
    const scene = { ...DEFAULT_SCENE, stage: ['cam:a', 'cam:b', 'cam:c'] };
    expect(removeFromStage(scene, 'cam:b').stage).toEqual(['cam:a', 'cam:c']);
    expect(promoteOnStage(scene, 'cam:c').stage).toEqual(['cam:c', 'cam:a', 'cam:b']);
    expect(moveOnStage(scene, 'cam:a', 2).stage).toEqual(['cam:b', 'cam:c', 'cam:a']);
    expect(moveOnStage(scene, 'cam:x', 0)).toBe(scene);
  });

  it('drops every source of a participant who left', () => {
    const scene = { ...DEFAULT_SCENE, stage: ['cam:a', 'screen:a', 'cam:b', 'media'] };
    expect(removeParticipantSources(scene, 'a').stage).toEqual(['cam:b', 'media']);
    expect(removeParticipantSources(scene, 'zzz')).toBe(scene);
  });

  it('parses source ids, including identities that contain colons', () => {
    expect(parseSourceId('screen:guest:42')).toEqual({ kind: 'screen', identity: 'guest:42' });
    expect(parseSourceId('media')).toEqual({ kind: 'media', identity: '' });
  });
});

describe('banners', () => {
  const banner = (id: string, style: Banner['style']): Banner => ({ id, text: id, subtitle: '', style });
  const scene = [
    banner('lower', 'lower-third'),
    banner('guest', 'name-title'),
    banner('news', 'ticker'),
    banner('new', 'badge'),
  ].reduce(addBanner, DEFAULT_SCENE);

  it('shows banners from different slots together', () => {
    const shown = ['lower', 'news', 'new'].reduce(toggleBanner, scene);
    expect(activeBanners(shown).map((b) => b.id).sort()).toEqual(['lower', 'new', 'news']);
    expect(bannerInSlot(shown, 'ticker')?.id).toBe('news');
  });

  it('replaces the banner already in the same slot', () => {
    const shown = ['lower', 'guest'].reduce(toggleBanner, scene);
    expect(activeBanners(shown).map((b) => b.id)).toEqual(['guest']);
  });

  it('hides a banner that is toggled again, and all of them at once', () => {
    const shown = ['lower', 'news'].reduce(toggleBanner, scene);
    expect(activeBanners(toggleBanner(shown, 'lower')).map((b) => b.id)).toEqual(['news']);
    expect(activeBanners(hideAllBanners(shown))).toEqual([]);
  });

  it('forgets a deleted banner', () => {
    const shown = toggleBanner(scene, 'lower');
    const after = removeBanner(shown, 'lower');
    expect(after.banners.map((b) => b.id)).not.toContain('lower');
    expect(activeBanners(after)).toEqual([]);
  });

  it('still shows a banner saved by the older single-banner field', () => {
    const old = { ...scene, activeBannerId: 'lower' };
    expect(activeBanners(old).map((b) => b.id)).toEqual(['lower']);
    expect(toggleBanner(old, 'lower')).toMatchObject({ activeBannerId: null, activeBannerIds: [] });
  });

  it('accepts a banner saved before subtitles existed', () => {
    const parsed = sceneSchema.parse({ ...DEFAULT_SCENE, banners: [{ id: 'a', text: 'Hi', style: 'ticker' }] });
    expect(parsed.banners[0]).toEqual({ id: 'a', text: 'Hi', subtitle: '', style: 'ticker' });
  });
});

describe('sceneSchema', () => {
  it('accepts the default scene', () => {
    expect(sceneSchema.parse(DEFAULT_SCENE)).toEqual(DEFAULT_SCENE);
  });

  it('rejects unknown source ids and off-site asset URLs', () => {
    expect(sceneSchema.safeParse({ ...DEFAULT_SCENE, stage: ['bogus'] }).success).toBe(false);
    const brand = { ...DEFAULT_SCENE.brand, logoUrl: 'https://evil.example/x.png' };
    expect(sceneSchema.safeParse({ ...DEFAULT_SCENE, brand }).success).toBe(false);
  });
});

describe('rtmp targets', () => {
  it('joins url and key with exactly one slash', () => {
    expect(buildRtmpTarget('rtmp://a.example/live2/', '/abc')).toBe('rtmp://a.example/live2/abc');
    expect(buildRtmpTarget('rtmp://a.example/live2/abc', '')).toBe('rtmp://a.example/live2/abc');
  });

  it('redacts the key', () => {
    expect(redactRtmpTarget('rtmp://a.example/live2/secret')).toBe('rtmp://a.example/live2/***');
  });
});
