/**
 * Where the daily rundown gets its news: public feeds that need no key. All of it is untrusted
 * input, some of it undocumented, so every field is checked and clipped, and a feed that fails
 * is skipped and named rather than stopping the others.
 */
import type { Fetch } from '../destinations/types';

export type NewsKind = 'story' | 'show' | 'repo' | 'model' | 'space' | 'paper' | 'blog';

export interface NewsItem {
  kind: NewsKind;
  title: string;
  url: string;
  /** Where it was published: "openai.com", "Hacker News", "arXiv". */
  site: string;
  summary: string;
  /** How much attention it has, in the source's own units: points, stars, likes. 0 when unknown. */
  score: number;
  publishedAt: string | null;
}

export interface Collected {
  items: NewsItem[];
  /** One line per source that could not be read. */
  warnings: string[];
}

// ---------- Reading untrusted values ----------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

function webUrl(value: unknown): string | null {
  const text = str(value).trim();
  if (!/^https?:\/\//i.test(text) || text.length > 500) return null;
  try {
    return new URL(text).toString();
  } catch {
    return null;
  }
}

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

function isoDate(value: unknown): string | null {
  const time = Date.parse(str(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Trending lists carry things a news show should not put on screen. */
const UNSUITABLE = /uncensored|nsfw|abliterat|porn|\bxxx\b/i;

function item(kind: NewsKind, title: string, url: string | null, site: string, summary: string, score: number, publishedAt: string | null): NewsItem[] {
  const cleanTitle = clip(tidy(title), 200);
  if (!url || !cleanTitle || UNSUITABLE.test(cleanTitle)) return [];
  return [{ kind, title: cleanTitle, url, site: clip(site, 40), summary: clip(tidy(summary), 600), score: Math.max(0, Math.round(score)), publishedAt }];
}

// ---------- Parsers ----------

export function parseHackerNews(json: unknown, kind: 'story' | 'show'): NewsItem[] {
  return arr(obj(json).hits).flatMap((raw) => {
    const hit = obj(raw);
    const discussion = `https://news.ycombinator.com/item?id=${str(hit.objectID)}`;
    const url = webUrl(hit.url) ?? (str(hit.objectID) ? discussion : null);
    const points = num(hit.points);
    const summary = `${points} points and ${num(hit.num_comments)} comments on Hacker News (${discussion})`;
    return item(kind, str(hit.title).replace(/^Show HN:\s*/i, ''), url, url ? hostOf(url) : '', summary, points, isoDate(hit.created_at));
  });
}

export function parseGitHub(json: unknown): NewsItem[] {
  return arr(obj(json).items).flatMap((raw) => {
    const repo = obj(raw);
    const stars = num(repo.stargazers_count);
    const licence = str(obj(repo.license).spdx_id);
    const topics = arr(repo.topics).map(str).filter(Boolean).slice(0, 8).join(', ');
    const about = [
      str(repo.description),
      str(repo.language) && `Written in ${str(repo.language)}.`,
      licence && licence !== 'NOASSERTION' && `Licence: ${licence}.`,
      topics && `Topics: ${topics}.`,
      `${stars} stars.`,
    ]
      .filter(Boolean)
      .join(' ');
    return item('repo', str(repo.full_name), webUrl(repo.html_url), 'GitHub', about, stars, isoDate(repo.created_at));
  });
}

export function parseHuggingFace(json: unknown, kind: 'model' | 'space'): NewsItem[] {
  return arr(json).flatMap((raw) => {
    const entry = obj(raw);
    const id = str(entry.id);
    if (!/^[\w.-]+\/[\w.-]+$/.test(id) || entry.private === true) return [];
    const url = `https://huggingface.co/${kind === 'space' ? 'spaces/' : ''}${id}`;
    const likes = num(entry.likes);
    const facts = [
      kind === 'model' ? str(entry.pipeline_tag) && `Task: ${str(entry.pipeline_tag)}.` : str(entry.sdk) && `Built with ${str(entry.sdk)}.`,
      `${likes} likes.`,
      kind === 'model' && num(entry.downloads) ? `${num(entry.downloads)} downloads.` : '',
      `Trending on Hugging Face.`,
    ];
    return item(kind, id, url, 'Hugging Face', facts.filter(Boolean).join(' '), num(entry.trendingScore) || likes, isoDate(entry.createdAt));
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1]!.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}

/** The text inside a feed element: CDATA unwrapped, entities decoded, markup removed. */
function feedText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Feeds escape their HTML, so decode first and strip tags after; decode again for text that was escaped twice.
  const plain = decodeEntities(unwrapped)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return tidy(decodeEntities(plain));
}

function element(block: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match ? match[1]! : '';
}

function feedLink(block: string): string {
  const plain = feedText(element(block, 'link'));
  if (plain) return plain;
  // Atom: <link rel="alternate" href="…"/>. Prefer the alternate, else the first link with an href.
  const links = [...block.matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]!);
  const pick = links.find((attrs) => /rel=["']alternate["']/i.test(attrs)) ?? links.find((attrs) => !/rel=["'](?:self|related|enclosure)["']/i.test(attrs));
  const href = pick ? /href=["']([^"']+)["']/i.exec(pick) : null;
  return href ? decodeEntities(href[1]!) : '';
}

/** Reads an RSS 2.0 or Atom feed without an XML library: the fields wanted are few and flat. */
export function parseFeed(xml: unknown, site: string, kind: 'paper' | 'blog' | 'story'): NewsItem[] {
  if (typeof xml !== 'string') return [];
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!);
  return blocks.flatMap((block) => {
    const summary = feedText(element(block, 'description') || element(block, 'summary') || element(block, 'content'));
    const date = feedText(element(block, 'pubDate') || element(block, 'published') || element(block, 'updated') || element(block, 'dc:date'));
    return item(kind, feedText(element(block, 'title')), webUrl(feedLink(block)), site, summary, 0, isoDate(date));
  });
}

/** One address for a page however it was linked: no tracking parameters, fragment or trailing slash. */
function canonical(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|ref$|ref_|source$|fbclid|gclid|mc_)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = '';
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${path}${parsed.search}`;
}

/**
 * Drops repeats of the same page, keeping the one with the higher score. A Show HN post is also
 * listed among the ordinary stories; it stays a Show HN post, which is what makes it a candidate
 * for project of the day.
 */
export function dedupe(items: NewsItem[]): NewsItem[] {
  const best = new Map<string, NewsItem>();
  for (const entry of items) {
    const key = canonical(entry.url);
    const seen = best.get(key);
    if (!seen) {
      best.set(key, entry);
      continue;
    }
    const keep = entry.score > seen.score ? entry : seen;
    const isShow = entry.kind === 'show' || seen.kind === 'show';
    best.set(key, isShow && keep.kind === 'story' ? { ...keep, kind: 'show' } : keep);
  }
  return [...best.values()];
}

// ---------- Reading the article behind a link ----------

const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_CHARS = 400_000;
const ARTICLE_MAX_CHARS = 1800;
/** How many of the day's most-noticed links are opened and read. */
const READ_LIMIT = 36;
/** Sites whose pages are an app, not an article: nothing to read without running them. */
const UNREADABLE = /(^|\.)(twitter\.com|x\.com|youtube\.com|youtu\.be|reddit\.com|news\.ycombinator\.com|linkedin\.com)$/i;

/** Only public web pages are fetched: a feed must not be able to point the server at itself. */
function isPublicPage(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:' || !hostname.includes('.') || UNREADABLE.test(hostname)) return false;
  return !/^[\d.]+$/.test(hostname) && !hostname.includes(':') && !/\.(local|internal|lan|home|test)$/i.test(hostname);
}

/** The opening of an article: its description and first paragraphs, as plain text. */
export function articleText(html: unknown): string {
  if (typeof html !== 'string') return '';
  const page = html.slice(0, PAGE_MAX_CHARS).replace(/<(script|style|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const meta =
    /<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]*content=["']([^"']*)["']/i.exec(page) ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["'](?:og:description|description)["']/i.exec(page);
  const parts = meta ? [feedText(meta[1]!)] : [];
  const body = /<(article|main)\b[\s\S]*?<\/\1>/i.exec(page)?.[0] ?? page;
  for (const match of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const paragraph = feedText(match[1]!);
    // Short paragraphs are bylines, captions and cookie notices.
    if (paragraph.length < 80 || parts.some((p) => p.includes(paragraph.slice(0, 60)))) continue;
    parts.push(paragraph);
    if (parts.join(' ').length > ARTICLE_MAX_CHARS) break;
  }
  return clip(parts.filter(Boolean).join(' '), ARTICLE_MAX_CHARS);
}

/**
 * Opens the most-noticed stories and adds what the page says to their summary. A link aggregator
 * gives a title and a score, which is not enough to explain a story from. A page that cannot be
 * read leaves its item as it was.
 */
export async function enrichItems(fetch: Fetch, items: NewsItem[], limit = READ_LIMIT): Promise<NewsItem[]> {
  const worthReading = items
    .filter((i) => (i.kind === 'story' || i.kind === 'show' || i.kind === 'blog') && isPublicPage(i.url))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const read = new Map<string, string>();
  await Promise.all(
    worthReading.map(async (entry) => {
      try {
        const res = await fetch(entry.url, {
          headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return;
        const article = articleText(await res.text());
        if (article.length >= 200) read.set(entry.url, article);
      } catch {
        // Unreachable, slow or not a page: the title and score still stand.
      }
    }),
  );
  return items.map((entry) => {
    const article = read.get(entry.url);
    return article ? { ...entry, summary: clip(`${article} [${entry.summary}]`, 2400) } : entry;
  });
}

// ---------- Collecting ----------

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'streamlabs-studio/0.1 (daily news rundown)';
const DAY = 24 * 60 * 60 * 1000;
/** Blog and news posts older than this are yesterday's show. */
const FRESH_MS = 2 * DAY;

const HN_QUERIES = ['AI', 'LLM', 'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'GPT', 'agents', 'model'];

/** Blogs of AI labs and the AI sections of news sites. Each is an RSS or Atom feed. */
export const FEEDS: { site: string; url: string; kind: 'blog' | 'story' }[] = [
  { site: 'OpenAI', url: 'https://openai.com/news/rss.xml', kind: 'blog' },
  { site: 'Google', url: 'https://blog.google/technology/ai/rss/', kind: 'blog' },
  { site: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', kind: 'blog' },
  { site: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', kind: 'blog' },
  { site: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/', kind: 'blog' },
  { site: 'NVIDIA', url: 'https://blogs.nvidia.com/feed/', kind: 'blog' },
  { site: 'AWS', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', kind: 'blog' },
  { site: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', kind: 'blog' },
  { site: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', kind: 'story' },
  { site: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', kind: 'story' },
  { site: 'Ars Technica', url: 'https://arstechnica.com/ai/feed/', kind: 'story' },
  { site: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', kind: 'story' },
  { site: 'r/LocalLLaMA', url: 'https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day', kind: 'story' },
];

interface Source {
  name: string;
  url: string;
  read(body: string): NewsItem[];
}

const json = (parse: (value: unknown) => NewsItem[]) => (body: string) => {
  try {
    return parse(JSON.parse(body));
  } catch {
    return [];
  }
};

function sources(now: Date): Source[] {
  const since = Math.floor((now.getTime() - DAY) / 1000);
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const hn = (tags: string, points: number, query: string) =>
    `https://hn.algolia.com/api/v1/search?tags=${tags}&numericFilters=created_at_i>${since},points>${points}&query=${encodeURIComponent(query)}&hitsPerPage=30`;
  const fresh = (items: NewsItem[]) => items.filter((i) => !i.publishedAt || now.getTime() - Date.parse(i.publishedAt) < FRESH_MS);

  return [
    ...HN_QUERIES.map((query) => ({ name: 'Hacker News', url: hn('story', 40, query), read: json((v) => parseHackerNews(v, 'story')) })),
    ...['AI', 'LLM', 'agent'].map((query) => ({ name: 'Show HN', url: hn('show_hn', 10, query), read: json((v) => parseHackerNews(v, 'show')) })),
    {
      name: 'GitHub',
      url: `https://api.github.com/search/repositories?q=llm+OR+agent+OR+ai+in:name,description,topics+created:>${weekAgo}&sort=stars&order=desc&per_page=25`,
      read: json(parseGitHub),
    },
    { name: 'Hugging Face models', url: 'https://huggingface.co/api/models?sort=trendingScore&limit=20', read: json((v) => parseHuggingFace(v, 'model')) },
    { name: 'Hugging Face Spaces', url: 'https://huggingface.co/api/spaces?sort=trendingScore&limit=20', read: json((v) => parseHuggingFace(v, 'space')) },
    {
      name: 'arXiv',
      url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=30',
      read: (body) => parseFeed(body, 'arXiv', 'paper'),
    },
    ...FEEDS.map((feed) => ({ name: feed.site, url: feed.url, read: (body: string) => fresh(parseFeed(body, feed.site, feed.kind)).slice(0, 12) })),
  ];
}

/** Reads every source at once. A source that fails is left out and named in the warnings. */
export async function collectNews(fetch: Fetch, now: Date): Promise<Collected> {
  const list = sources(now);
  const results = await Promise.allSettled(
    list.map(async (source) => {
      const res = await fetch(source.url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${source.name} answered ${res.status}`);
      return source.read(await res.text());
    }),
  );

  const items: NewsItem[] = [];
  const failed = new Set<string>();
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else failed.add(list[index]!.name);
  });
  // Hacker News is asked several questions; it only counts as down when none of them worked.
  const answered = new Set(list.filter((_, index) => results[index]!.status === 'fulfilled').map((s) => s.name));
  const warnings = [...failed].filter((name) => !answered.has(name)).map((name) => `${name} could not be reached`);
  return { items: await enrichItems(fetch, dedupe(items)), warnings };
}
