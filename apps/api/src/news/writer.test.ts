import { rundownSchema, SEGMENTS } from '@studio/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import type { Collected, NewsItem, NewsKind } from './sources';
import { buildPlainRundown, buildPrompt, createWriter, extractJson, nvidiaGenerate, selectItems, type Generate } from './writer';

const NOW = new Date('2026-10-06T11:30:00Z');
const DATE = '2026-10-06';
const cfg = loadConfig({ NODE_ENV: 'test' }).news;
const { show } = cfg;

const entry = (kind: NewsKind, title: string, url: string, score = 10): NewsItem => ({ kind, title, url, site: new URL(url).hostname, summary: `About ${title}.`, score, publishedAt: null });
const collected: Collected = {
  items: [
    entry('story', 'Big model released', 'https://lab.example/post', 900),
    entry('story', 'Chip maker results', 'https://news.example/chips', 300),
    entry('repo', 'acme/agent', 'https://github.com/acme/agent', 1500),
    entry('show', 'A tool for prompts', 'https://tool.example', 60),
    entry('model', 'acme/tiny-llm', 'https://huggingface.co/acme/tiny-llm', 200),
    entry('paper', 'Attention is still needed', 'https://arxiv.org/abs/1', 0),
  ],
  warnings: ['arXiv could not be reached'],
};
/** Item numbers as the prompt lists them. */
const n = (url: string) => selectItems(collected.items).findIndex((i) => i.url === url) + 1;

const failFetch = (async () => {
  throw new Error('no network in this test');
}) as typeof fetch;
const fenced = (items: unknown[]) => `Here is the rundown:\n\`\`\`json\n${JSON.stringify({ items })}\n\`\`\``;
const provider = (generate: Generate, name = 'fake-model') => [{ name, generate }];
const full = (segment: string, patch: Record<string, unknown> = {}) => ({
  segment,
  headline: `Headline for ${segment}`,
  subhead: 'Second line',
  points: ['One', 'Two', 'Three'],
  script: 'Hello and welcome. This is the script.',
  context: 'Background.',
  ticker: 'Ticker line',
  sources: [{ n: n('https://lab.example/post'), quote: 'A quote.' }],
  ...patch,
});

describe('extractJson', () => {
  it('reads plain JSON, fenced JSON and JSON after prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a":{"b":"}"}} Hope it helps')).toEqual({ a: { b: '}' } });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('I cannot help with that')).toThrow();
    expect(() => extractJson('{"a": 1')).toThrow();
  });
});

describe('buildPrompt', () => {
  it('numbers the items, names the show and host, and never asks the model for a URL', () => {
    const { system, user } = buildPrompt(selectItems(collected.items), show, DATE);
    expect(user).toContain('[1] ');
    expect(user).toContain('Big model released');
    expect(system).toContain(show.name);
    expect(system).toContain(show.host);
    expect(system).toContain(`@${show.x}`);
    for (const segment of SEGMENTS) expect(system).toContain(`"${segment}"`);
    expect(system).toMatch(/item number/i);
  });

  it('keeps a large collection within a fixed number of items', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry('story', `Story ${i}`, `https://s.example/${i}`, i));
    const picked = selectItems(many);
    expect(picked.length).toBeLessThanOrEqual(120);
    expect(picked[0]!.title).toBe('Story 499');
  });
});

describe('writing a rundown', () => {
  it('maps cited item numbers to collected pages and drops numbers that were never listed', async () => {
    const answer = fenced([full('top', { sources: [{ n: n('https://lab.example/post'), quote: 'q' }, { n: 99, quote: 'made up' }, { url: 'https://evil.example', quote: 'typed a URL' }] })]);
    const rundown = await createWriter(cfg, failFetch, provider(async () => answer)).write(collected, DATE, NOW);
    const top = rundown.items.find((i) => i.segment === 'top')!;
    expect(top.sources).toEqual([{ url: 'https://lab.example/post', title: 'Big model released', site: 'lab.example', quote: 'q' }]);
    expect(JSON.stringify(rundown)).not.toContain('evil.example');
  });

  it('keeps an item whose every source was dropped', async () => {
    const answer = fenced([full('top', { sources: [{ n: 4242, quote: 'x' }] })]);
    const top = (await createWriter(cfg, failFetch, provider(async () => answer)).write(collected, DATE, NOW)).items.find((i) => i.segment === 'top')!;
    expect(top.sources).toEqual([]);
    expect(top.script).toContain('Hello and welcome');
  });

  it('clips text to what the screen can hold and still validates', async () => {
    const answer = fenced([full('top', { headline: 'h'.repeat(200), subhead: 's'.repeat(300), points: ['p'.repeat(200), 'q'.repeat(200), 'r'.repeat(200)], ticker: 't'.repeat(900), script: 'word '.repeat(3000) })]);
    const rundown = await createWriter(cfg, failFetch, provider(async () => answer)).write(collected, DATE, NOW);
    const top = rundown.items.find((i) => i.segment === 'top')!;
    expect(top.headline.length).toBeLessThanOrEqual(90);
    expect(top.subhead.length).toBeLessThanOrEqual(120);
    expect(top.points.length).toBeLessThanOrEqual(300);
    expect(top.script.length).toBeLessThanOrEqual(6000);
    expect(rundownSchema.safeParse(rundown).success).toBe(true);
  });

  it('puts the segments in show order, fills the ones the model left out, and limits each to its count', async () => {
    const answer = fenced([full('close'), ...Array.from({ length: 7 }, () => full('story')), full('top'), full('nonsense'), 'junk', null]);
    const rundown = await createWriter(cfg, failFetch, provider(async () => answer)).write(collected, DATE, NOW);
    const order = rundown.items.map((i) => SEGMENTS.indexOf(i.segment));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rundown.items.filter((i) => i.segment === 'story')).toHaveLength(4);
    // The model wrote no repo item; the collected repo fills it, without a script.
    const repo = rundown.items.find((i) => i.segment === 'repo')!;
    expect(repo.headline).toContain('acme/agent');
    expect(repo.script).toBe('');
    expect(new Set(rundown.items.map((i) => i.id)).size).toBe(rundown.items.length);
  });

  it('estimates speaking time from the script and uses the segment tag', async () => {
    const answer = fenced([full('top', { script: 'word '.repeat(150), tag: '' })]);
    const top = (await createWriter(cfg, failFetch, provider(async () => answer)).write(collected, DATE, NOW)).items.find((i) => i.segment === 'top')!;
    expect(top.seconds).toBe(60);
    expect(top.tag).toBe('TOP STORY');
  });

  it('keeps the feed warnings and records which model wrote it', async () => {
    const rundown = await createWriter(cfg, failFetch, provider(async () => fenced([full('top')]))).write(collected, DATE, NOW);
    expect(rundown.model).toBe('fake-model');
    expect(rundown.warnings).toContain('arXiv could not be reached');
    expect(rundown.date).toBe(DATE);
    expect(rundown.generatedAt).toBe(NOW.toISOString());
  });

  it('asks again once when the answer is not JSON, then moves to the next model', async () => {
    const calls: string[] = [];
    const providers = [
      { name: 'first', generate: async () => (calls.push('first'), 'Sorry, I cannot.') },
      { name: 'second', generate: async () => (calls.push('second'), fenced([full('top'), full('repo')])) },
    ];
    const rundown = await createWriter(cfg, failFetch, providers).write(collected, DATE, NOW);
    // The show is written in two parts. The first model fails the first part twice and is not asked again.
    expect(calls).toEqual(['first', 'first', 'second', 'second']);
    expect(rundown.model).toBe('second');
    expect(rundown.warnings.join(' ')).toContain('first could not write the scripts');
  });

  it('treats an answer with no usable script as a failure', async () => {
    const rundown = await createWriter(cfg, failFetch, provider(async () => fenced([{ segment: 'top', headline: 'x' }]))).write(collected, DATE, NOW);
    expect(rundown.model).toBeNull();
  });

  it('falls back to a rundown without scripts when every model fails, and says why', async () => {
    const boom: Generate = async () => {
      throw new Error('NVIDIA answered 503');
    };
    const rundown = await createWriter(cfg, failFetch, provider(boom)).write(collected, DATE, NOW);
    expect(rundown.model).toBeNull();
    expect(rundown.items.every((i) => i.script === '')).toBe(true);
    expect(rundown.warnings.join(' ')).toContain('NVIDIA answered 503');
    expect(rundownSchema.safeParse(rundown).success).toBe(true);
  });

  it('says so when no model key is set', async () => {
    const rundown = await createWriter({ ...cfg, nvidiaKey: undefined, geminiKey: undefined }, failFetch).write(collected, DATE, NOW);
    expect(rundown.model).toBeNull();
    expect(rundown.warnings).toContain('No model key is set, so the scripts were not written');
  });
});

describe('writing the show in parts', () => {
  it('asks for the stories first, then the segments, telling the second call what was covered', async () => {
    const prompts: { system: string; user: string }[] = [];
    const generate: Generate = async (system, user) => {
      prompts.push({ system, user });
      return prompts.length === 1 ? fenced([full('open'), full('top', { headline: 'The top story' })]) : fenced([full('repo'), full('close'), full('top', { headline: 'Out of place' })]);
    };
    const rundown = await createWriter(cfg, failFetch, provider(generate)).write(collected, DATE, NOW);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]!.system).toContain('"top"');
    expect(prompts[0]!.system).not.toContain('"repo"');
    expect(prompts[1]!.system).toContain('"repo"');
    expect(prompts[1]!.user).toContain('- The top story');
    // A segment that belongs to the other part is ignored.
    expect(rundown.items.map((i) => i.headline)).not.toContain('Out of place');
    expect(rundown.items.find((i) => i.segment === 'repo')!.script).not.toBe('');
  });

  it('keeps the part that was written when the other part fails', async () => {
    let call = 0;
    const generate: Generate = async () => {
      call += 1;
      if (call > 1) throw new Error('NVIDIA answered 503');
      return fenced([full('top')]);
    };
    const rundown = await createWriter(cfg, failFetch, provider(generate)).write(collected, DATE, NOW);
    expect(rundown.model).toBe('fake-model');
    expect(rundown.items.find((i) => i.segment === 'top')!.script).not.toBe('');
    expect(rundown.items.find((i) => i.segment === 'repo')!.script).toBe('');
    expect(rundown.warnings.join(' ')).toContain('NVIDIA answered 503');
  });

  it('takes story points from the script when the model leaves them out, and drops a quote that is only a score', async () => {
    const answer = fenced([full('top', { points: [], script: 'First fact. Second fact. Third fact. Fourth fact.', sources: [{ n: n('https://lab.example/post'), quote: '120 points and 88 comments on Hacker News' }] })]);
    const top = (await createWriter(cfg, failFetch, provider(async () => answer)).write(collected, DATE, NOW)).items.find((i) => i.segment === 'top')!;
    expect(top.points).toBe('First fact.\nSecond fact.\nThird fact.');
    expect(top.sources[0]!.quote).toBe('');
  });
});

describe('the rundown without a model', () => {
  const plain = buildPlainRundown(collected, show, DATE, NOW, 'reason');

  it('has an item for every segment it has news for, in show order', () => {
    expect(plain.items.map((i) => i.segment)).toEqual(['open', 'top', 'story', 'repo', 'project', 'model', 'paper', 'close']);
    expect(plain.items.find((i) => i.segment === 'top')!.headline).toBe('Big model released');
    expect(plain.items.find((i) => i.segment === 'project')!.sources[0]!.url).toBe('https://tool.example');
  });

  it('names the show and the handles in the opening and the sign-off', () => {
    const open = plain.items[0]!;
    const close = plain.items.at(-1)!;
    expect(open.headline).toContain(show.name);
    expect(close.points).toContain(`@${show.x}`);
    expect(close.points).toContain(show.github);
  });

  it('is still a rundown when nothing but one story was collected', () => {
    const tiny = buildPlainRundown({ items: [collected.items[0]!], warnings: [] }, show, DATE, NOW, 'reason');
    expect(tiny.items.map((i) => i.segment)).toEqual(['open', 'top', 'close']);
    expect(rundownSchema.safeParse(tiny).success).toBe(true);
  });
});

describe('the NVIDIA call', () => {
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it('retries a busy model three times and then gives up', async () => {
    let calls = 0;
    const fetch = (async () => ((calls += 1), new Response('{"error":{"message":"Service temporarily overloaded"}}', { status: 503 }))) as typeof globalThis.fetch;
    await expect(nvidiaGenerate(fetch, 'key', 'some/model', async () => undefined)('s', 'u')).rejects.toThrow('NVIDIA answered 503');
    expect(calls).toBe(4);
  });

  it('returns the answer once the model stops being busy', async () => {
    let calls = 0;
    const fetch = (async () => ((calls += 1) < 3 ? new Response('', { status: 503 }) : ok('{"items":[]}'))) as typeof globalThis.fetch;
    expect(await nvidiaGenerate(fetch, 'key', 'some/model', async () => undefined)('s', 'u')).toBe('{"items":[]}');
  });

  it('does not retry a refusal, and never puts the key in the URL or the body', async () => {
    const seen: { url: string; body: string; auth: string | null }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), body: String(init?.body), auth: new Headers(init?.headers).get('authorization') });
      return new Response('{"detail":"Authorization failed"}', { status: 403 });
    }) as typeof globalThis.fetch;
    await expect(nvidiaGenerate(fetch, 'nvapi-secret', 'some/model', async () => undefined)('s', 'u')).rejects.toThrow('NVIDIA answered 403');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.auth).toBe('Bearer nvapi-secret');
    expect(seen[0]!.url + seen[0]!.body).not.toContain('nvapi-secret');
  });

  it('throws when the answer has no text', async () => {
    const fetch = (async () => new Response('{"choices":[]}', { status: 200 })) as typeof globalThis.fetch;
    await expect(nvidiaGenerate(fetch, 'key', 'some/model')('s', 'u')).rejects.toThrow('empty answer');
  });
});
