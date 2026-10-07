import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleText, collectNews, dedupe, enrichItems, parseFeed, parseGitHub, parseHackerNews, parseHuggingFace, type NewsItem } from './sources';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-06T12:00:00Z');

describe('feed parsers', () => {
  it('reads Hacker News stories', () => {
    const items = parseHackerNews(JSON.parse(fixture('hn.json')), 'story');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      kind: 'story',
      title: 'AI is now capable of developing its own inference hardware',
      url: 'https://github.com/FeSens/openTPU',
      site: 'github.com',
      score: 120,
    });
    expect(items[0]!.summary).toContain('news.ycombinator.com/item?id=49980715');
  });

  it('links a Hacker News post without a URL to its discussion, and drops the Show HN prefix', () => {
    const [post] = parseHackerNews({ hits: [{ objectID: '42', title: 'Show HN: My agent', points: 12, num_comments: 3 }] }, 'show');
    expect(post).toMatchObject({ kind: 'show', title: 'My agent', url: 'https://news.ycombinator.com/item?id=42' });
  });

  it('reads GitHub repositories', () => {
    const items = parseGitHub(JSON.parse(fixture('github.json')));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'repo', title: 'QingYunA/answer-me-with-html', url: 'https://github.com/QingYunA/answer-me-with-html', site: 'GitHub', score: 1737 });
    expect(items[0]!.summary).toContain('1737 stars');
  });

  it('reads Hugging Face models and Spaces, leaving out what a news show should not put on screen', () => {
    const models = parseHuggingFace(JSON.parse(fixture('hf-models.json')), 'model');
    expect(models.map((m) => m.title)).toEqual(['Cloudflare/clef', 'autotrust/JEV-27B-VL']);
    expect(models[0]).toMatchObject({ kind: 'model', url: 'https://huggingface.co/Cloudflare/clef', site: 'Hugging Face' });
    const spaces = parseHuggingFace(JSON.parse(fixture('hf-spaces.json')), 'space');
    expect(spaces.map((s) => s.url)).toEqual(['https://huggingface.co/spaces/FineEnvs/multi-harness-rl']);
  });

  it('reads an Atom feed (arXiv)', () => {
    const items = parseFeed(fixture('arxiv.xml'), 'arXiv', 'paper');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'paper', title: 'One Figure, Every Canvas: Editable Flowchart Relayout via Agentic Pipeline', url: 'https://arxiv.org/abs/2610.06852v1', site: 'arXiv' });
    expect(items[0]!.summary).toMatch(/^Pipeline figures in ML papers/);
    expect(items[0]!.publishedAt).toBe('2026-10-05T17:59:54.000Z');
  });

  it('reads an RSS feed', () => {
    const items = parseFeed(fixture('rss.xml'), 'TechCrunch', 'story');
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ title: 'Anthropic is giving startups a free year of Claude Team and $1,000 in credits', site: 'TechCrunch' });
    expect(items[1]!.url).toMatch(/^https:\/\/techcrunch\.com\/2026\/10\/06\/anthropic-gives-startups/);
    expect(items[1]!.summary).toContain('We created this program');
  });

  it('reads an Atom feed whose links are attributes and whose text is CDATA', () => {
    const items = parseFeed(fixture('atom.xml'), 'The Verge', 'story');
    expect(items).toHaveLength(2);
    expect(items[0]!.url).toBe('https://www.theverge.com/column/1005697/we-cant-just-change-the-definition-of-recording');
    expect(items[0]!.title).toContain('change the definition of');
    expect(items[0]!.summary).not.toMatch(/[<>]/);
  });

  it('decodes entities, strips markup, and clips long text', () => {
    const xml = `<rss><channel><item><title>Tom &amp; Jerry&#39;s &lt;b&gt;model&lt;/b&gt;</title><link>https://a.example/x</link>
      <description><![CDATA[<p>Hello <script>alert(1)</script>world</p>${'y'.repeat(900)}]]></description></item></channel></rss>`;
    const [post] = parseFeed(xml, 'A', 'blog');
    expect(post!.title).toBe("Tom & Jerry's model");
    expect(post!.summary.startsWith('Hello world')).toBe(true);
    expect(post!.summary.length).toBeLessThanOrEqual(600);
  });

  it('drops entries without a web address', () => {
    const xml = '<rss><item><title>Bad</title><link>javascript:alert(1)</link></item><item><title>No link</title></item></rss>';
    expect(parseFeed(xml, 'A', 'blog')).toEqual([]);
  });

  it.each([null, undefined, {}, [], 'not json', '<html><body>Too many requests</body></html>', 42])('survives %j', (junk) => {
    expect(parseHackerNews(junk, 'story')).toEqual([]);
    expect(parseGitHub(junk)).toEqual([]);
    expect(parseHuggingFace(junk, 'model')).toEqual([]);
    expect(parseFeed(junk, 'A', 'blog')).toEqual([]);
  });

  it('survives entries with fields of the wrong type', () => {
    expect(parseHackerNews({ hits: [null, 5, { title: {}, url: [] }] }, 'story')).toEqual([]);
    expect(parseGitHub({ items: [{ full_name: 'a/b', html_url: 7 }] })).toEqual([]);
    expect(parseHuggingFace([{ id: '../../etc' }, { id: 'ok/model', private: true }], 'model')).toEqual([]);
  });
});

describe('dedupe', () => {
  const story = (url: string, score: number): NewsItem => ({ kind: 'story', title: 't', url, site: 's', summary: '', score, publishedAt: null });

  it('treats tracking parameters, www and a trailing slash as the same page, and keeps the higher score', () => {
    const merged = dedupe([story('https://www.x.example/a/?utm_source=hn', 5), story('https://x.example/a', 90), story('https://x.example/b', 1)]);
    expect(merged).toHaveLength(2);
    expect(merged.find((i) => i.url.includes('/a'))!.score).toBe(90);
  });

  it('keeps a Show HN post a Show HN post when it is also listed as a story', () => {
    const merged = dedupe([{ ...story('https://x.example/a', 50), kind: 'show' }, story('https://x.example/a', 80)]);
    expect(merged).toEqual([{ ...story('https://x.example/a', 80), kind: 'show' }]);
  });

  it('keeps pages that differ by a real query parameter', () => {
    expect(dedupe([story('https://x.example/item?id=1', 1), story('https://x.example/item?id=2', 1)])).toHaveLength(2);
  });
});

describe('reading the article behind a link', () => {
  const para = (text: string) => `<p>${text} ${'More detail follows here. '.repeat(4)}</p>`;
  const page = `<html><head><meta property="og:description" content="The lab&#39;s new model is out."><script>var p = "<p>${'x'.repeat(100)}</p>";</script></head>
    <body><nav><p>${'Menu item. '.repeat(20)}</p></nav><article><p>By A. Writer</p>${para('The model is twice as fast.')}${para('It costs <b>half</b> as much.')}</article>
    <footer><p>${'Cookie notice. '.repeat(20)}</p></footer></body></html>`;
  const story = (url: string, score: number, kind: NewsItem['kind'] = 'story'): NewsItem => ({ kind, title: 't', url, site: 's', summary: '120 points on Hacker News', score, publishedAt: null });
  const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('takes the description and the article paragraphs, and leaves out menus, bylines, scripts and footers', () => {
    const text = articleText(page);
    expect(text.startsWith("The lab's new model is out.")).toBe(true);
    expect(text).toContain('The model is twice as fast.');
    expect(text).toContain('It costs half as much.');
    expect(text).not.toMatch(/Menu item|Cookie notice|By A\. Writer|xxxx|[<>]/);
    expect(articleText(`<p>${'long '.repeat(5000)}</p>`).length).toBeLessThanOrEqual(1800);
    expect(articleText(null)).toBe('');
  });

  it('adds the article to the most-noticed stories and keeps the original line', async () => {
    const asked: string[] = [];
    const fetch = (async (input: string | URL | Request) => (asked.push(String(input)), html(page))) as typeof globalThis.fetch;
    const items = [story('https://a.example/1', 50), story('https://a.example/2', 900), story('https://a.example/3', 10), story('https://github.com/a/b', 9999, 'repo')];
    const out = await enrichItems(fetch, items, 2);
    expect(asked.sort()).toEqual(['https://a.example/1', 'https://a.example/2']);
    expect(out[1]!.summary).toContain('twice as fast');
    expect(out[1]!.summary).toContain('120 points on Hacker News');
    expect(out[2]).toEqual(items[2]);
    expect(out[3]).toEqual(items[3]);
  });

  it('never opens private addresses or sites that have no article to read', async () => {
    const asked: string[] = [];
    const fetch = (async (input: string | URL | Request) => (asked.push(String(input)), html(page))) as typeof globalThis.fetch;
    const urls = ['http://a.example/plain-http', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://router.local/x', 'https://twitter.com/a/status/1', 'https://www.youtube.com/watch?v=1', 'https://ok.example/yes'];
    await enrichItems(fetch, urls.map((url) => story(url, 100)));
    expect(asked).toEqual(['https://ok.example/yes']);
  });

  it('leaves an item alone when its page fails, is not HTML, or says almost nothing', async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/down')) throw new Error('timeout');
      if (url.endsWith('/404')) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
      if (url.endsWith('/pdf')) return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
      return html('<p>Too short.</p>');
    }) as typeof globalThis.fetch;
    const items = ['down', '404', 'pdf', 'short'].map((path) => story(`https://a.example/${path}`, 100));
    expect(await enrichItems(fetch, items)).toEqual(items);
  });
});

describe('collectNews', () => {
  const respond = (body: string, status = 200) => new Response(body, { status });

  it('gathers every source that answers and names the ones that do not', async () => {
    const seen: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('hn.algolia.com')) return respond(fixture('hn.json'));
      if (url.includes('api.github.com')) return respond('<html>rate limited</html>', 429);
      if (url.includes('api/models')) return respond(fixture('hf-models.json'));
      if (url.includes('api/spaces')) return respond('not json at all');
      if (url.includes('arxiv.org')) throw new Error('socket hang up');
      if (url.includes('techcrunch.com')) return respond(fixture('rss.xml'));
      return respond('', 500);
    }) as typeof globalThis.fetch;

    const { items, warnings } = await collectNews(fetch, NOW);
    // The fixture's three posts answer the Show HN question too, so that is what they are; the stories are TechCrunch's.
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['show', 'model', 'story']));
    expect(items.filter((i) => i.kind === 'story').every((i) => i.site === 'TechCrunch')).toBe(true);
    // The same three Hacker News hits came back for every query; each is kept once.
    expect(items.filter((i) => i.summary.includes('Hacker News'))).toHaveLength(3);
    expect(warnings).toContain('GitHub could not be reached');
    expect(warnings).toContain('arXiv could not be reached');
    expect(warnings).not.toContain('Hacker News could not be reached');
    expect(warnings).not.toContain('TechCrunch could not be reached');
    // A source that answers with junk is not an outage: it just has nothing to add.
    expect(warnings).not.toContain('Hugging Face Spaces could not be reached');
    expect(seen.every((url) => url.startsWith('https://'))).toBe(true);
  });

  it('leaves out blog posts from before yesterday', async () => {
    const old = '<rss><item><title>Old</title><link>https://a.example/old</link><pubDate>Mon, 28 Sep 2026 10:00:00 +0000</pubDate></item><item><title>New</title><link>https://a.example/new</link><pubDate>Tue, 06 Oct 2026 10:00:00 +0000</pubDate></item></rss>';
    const fetch = (async (input: string | URL | Request) => (String(input).includes('openai.com') ? respond(old) : respond('', 500))) as typeof globalThis.fetch;
    const { items } = await collectNews(fetch, NOW);
    expect(items.map((i) => i.title)).toEqual(['New']);
  });

  it('reports every source when nothing can be reached', async () => {
    const fetch = (async () => {
      throw new Error('offline');
    }) as typeof globalThis.fetch;
    const { items, warnings } = await collectNews(fetch, NOW);
    expect(items).toEqual([]);
    expect(warnings).toContain('Hacker News could not be reached');
    expect(warnings.length).toBeGreaterThan(10);
  });
});
