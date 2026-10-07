import { describe, expect, it } from 'vitest';
import { applyRundownItem, RUNDOWN_SOCIAL_ID, RUNDOWN_TICKER_ID, rundownItemSchema, rundownSeconds, SEGMENT_INFO, SEGMENTS, type RundownItem } from './rundown';
import { activeBanners, DEFAULT_SCENE, sceneSchema } from './scene';

const item = (patch: Partial<RundownItem> = {}): RundownItem => ({
  id: 'top-1',
  segment: 'top',
  tag: 'TOP STORY',
  headline: 'A lab ships a new model',
  subhead: 'It is faster and cheaper',
  points: 'Twice the speed\nHalf the price\nOut today',
  script: 'Good evening. A lab shipped a new model today.',
  context: 'The last version came out in March.',
  ticker: 'New model out today',
  seconds: 60,
  sources: [{ url: 'https://lab.example/post', title: 'Announcing the model', site: 'lab.example', quote: 'Our fastest yet.' }],
  ...patch,
});

describe('rundown schema', () => {
  it('accepts a full item', () => {
    expect(rundownItemSchema.parse(item())).toEqual(item());
  });

  it('rejects a source that is not a web address, and a headline too long for the screen', () => {
    const bad = item({ sources: [{ url: 'javascript:alert(1)', title: 't', site: 's', quote: '' }] });
    expect(rundownItemSchema.safeParse(bad).success).toBe(false);
    expect(rundownItemSchema.safeParse(item({ headline: 'x'.repeat(91) })).success).toBe(false);
  });

  it('gives every segment a tag that fits the tag field', () => {
    for (const segment of SEGMENTS) expect(SEGMENT_INFO[segment].tag.length).toBeLessThanOrEqual(16);
  });

  it('adds up the speaking time', () => {
    const rundown = { date: '2026-10-06', generatedAt: '', model: null, warnings: [], items: [item(), item({ id: 'b', seconds: 45 })] };
    expect(rundownSeconds(rundown)).toBe(105);
  });
});

describe('putting an item on air', () => {
  it('fills the news scene and clears the source card', () => {
    const before = { ...DEFAULT_SCENE, news: { ...DEFAULT_SCENE.news, source: item().sources[0]! } };
    const { news } = applyRundownItem(before, item());
    expect(news).toMatchObject({ tag: 'TOP STORY', headline: 'A lab ships a new model', subhead: 'It is faster and cheaper', rundownItemId: 'top-1', source: null });
    expect(news.points.split('\n')).toHaveLength(3);
    expect(news.channel).toBe(DEFAULT_SCENE.news.channel);
  });

  it('keeps one ticker banner and replaces its text', () => {
    const first = applyRundownItem(DEFAULT_SCENE, item());
    const second = applyRundownItem(first, item({ id: 'b', ticker: 'Second story' }));
    const tickers = second.banners.filter((b) => b.id === RUNDOWN_TICKER_ID);
    expect(tickers).toHaveLength(1);
    expect(tickers[0]!.text).toBe('Second story');
    expect(activeBanners(second).map((b) => b.id)).toContain(RUNDOWN_TICKER_ID);
  });

  it('replaces a ticker the host already had running, and leaves other banners alone', () => {
    const own = {
      ...DEFAULT_SCENE,
      banners: [
        { id: 'mine', text: 'My ticker', subtitle: '', style: 'ticker' as const },
        { id: 'badge', text: 'LIVE', subtitle: '', style: 'badge' as const },
      ],
      activeBannerIds: ['mine', 'badge'],
    };
    const shown = activeBanners(applyRundownItem(own, item())).map((b) => b.id);
    expect(shown).toEqual(expect.arrayContaining([RUNDOWN_TICKER_ID, 'badge']));
    expect(shown).not.toContain('mine');
  });

  it('leaves the ticker as it was when the item has no ticker line', () => {
    expect(applyRundownItem(DEFAULT_SCENE, item({ ticker: '  ' })).banners).toEqual([]);
  });

  it('shows the host handle on the sign-off and takes it off for the next item', () => {
    const social = { handle: '@yashkavaiya', line: 'Follow for the next show' };
    const closing = applyRundownItem(DEFAULT_SCENE, item({ id: 'close', segment: 'close' }), social);
    expect(activeBanners(closing).find((b) => b.id === RUNDOWN_SOCIAL_ID)?.text).toBe('@yashkavaiya');
    const next = applyRundownItem(closing, item(), social);
    expect(activeBanners(next).map((b) => b.id)).not.toContain(RUNDOWN_SOCIAL_ID);
  });

  it('produces a scene the API will accept', () => {
    expect(sceneSchema.safeParse(applyRundownItem(DEFAULT_SCENE, item())).success).toBe(true);
  });
});

describe('news scene', () => {
  it('reads a scene saved before source cards existed', () => {
    const older = { ...DEFAULT_SCENE, news: { view: 'anchor', channel: 'X', tag: '', headline: '', subhead: '', points: '' } };
    expect(sceneSchema.parse(older).news).toMatchObject({ source: null, rundownItemId: null });
  });
});
