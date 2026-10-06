/**
 * Turns the day's collected news into the show's rundown. A model ranks the items and writes what
 * the host says; it never supplies a link, only the number of an item it was given. With no model,
 * or when every model fails, the rundown is still built from the items, without scripts.
 */
import { rundownSchema, SEGMENT_INFO, SEGMENTS, type Rundown, type RundownItem, type RundownSource, type Segment } from '@studio/shared';
import type { NewsConfig } from '../config';
import type { Fetch } from '../destinations/types';
import type { Show } from './show';
import type { Collected, NewsItem, NewsKind } from './sources';

// ---------- Choosing what the model sees ----------

/** How many items of each kind go into the prompt, most-noticed first. 120 in all. */
const PROMPT_SHARE: Record<NewsKind, number> = { story: 40, blog: 22, repo: 15, paper: 15, show: 10, model: 10, space: 8 };

const byAttention = (a: NewsItem, b: NewsItem) => b.score - a.score || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');

/** The items a rundown is made from, in the order the prompt numbers them. */
export function selectItems(items: NewsItem[]): NewsItem[] {
  return (Object.keys(PROMPT_SHARE) as NewsKind[]).flatMap((kind) =>
    items.filter((i) => i.kind === kind).sort(byAttention).slice(0, PROMPT_SHARE[kind]),
  );
}

// ---------- Text that fits ----------

const tidy = (text: string) => text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const WORDS_PER_SECOND = 2.5;

/** Story points as lines that fit the points field together. */
function pointLines(value: unknown): string {
  const lines = (Array.isArray(value) ? value.map(text) : text(value).split('\n')).map((l) => oneLine(l).replace(/^[-•*]\s*/, '')).filter(Boolean);
  let out = '';
  for (const line of lines.slice(0, 5)) {
    const next = out ? `${out}\n${clip(line, 96)}` : clip(line, 96);
    if (next.length > 300) break;
    out = next;
  }
  return out;
}

function sourceOf(item: NewsItem, quote: string): RundownSource {
  return { url: item.url, title: clip(item.title, 160), site: clip(item.site, 40), quote: clip(oneLine(quote), 240) };
}

// ---------- The rundown without a model ----------

function plainItem(segment: Segment, news: NewsItem, tag = SEGMENT_INFO[segment].tag): Omit<RundownItem, 'id'> {
  const sentences = news.summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  return {
    segment,
    tag,
    headline: clip(news.title, 90),
    subhead: clip(news.site, 120),
    points: pointLines(sentences.slice(0, 3)),
    script: '',
    context: clip(news.summary, 2000),
    ticker: clip(news.title, 200),
    seconds: 45,
    sources: [sourceOf(news, sentences[0] ?? '')],
  };
}

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Headlines, summaries and links by how much attention each item has, with no spoken script.
 * `reason` says why no model wrote it, and goes to the host as a warning.
 */
export function buildPlainRundown(collected: Collected, show: Show, date: string, now: Date, reason: string): Rundown {
  const of = (...kinds: NewsKind[]) => collected.items.filter((i) => kinds.includes(i.kind)).sort(byAttention);
  const stories = of('story', 'blog');
  const [top, ...rest] = stories;
  const project = of('show')[0] ?? of('space')[0];
  const quick = rest.slice(4, 9);
  const handles = `X @${show.x}\nGitHub ${show.github}\nLinkedIn ${show.linkedin}`;

  const items: Omit<RundownItem, 'id'>[] = [];
  const blank = { script: '', context: '', sources: [] as RundownSource[] };
  items.push({
    ...blank,
    segment: 'open',
    tag: SEGMENT_INFO.open.tag,
    headline: clip(`${show.name} with ${show.host}`, 90),
    subhead: clip(longDate(date), 120),
    points: pointLines(stories.slice(0, 3).map((s) => s.title)),
    ticker: clip(`${show.name}: the day in AI, ${longDate(date)}`, 200),
    seconds: 30,
  });
  if (top) items.push(plainItem('top', top));
  for (const story of rest.slice(0, SEGMENT_INFO.story.count)) items.push(plainItem('story', story));
  const single: [Segment, NewsItem | undefined][] = [['repo', of('repo')[0]], ['project', project], ['model', of('model')[0]], ['paper', of('paper')[0]]];
  for (const [segment, news] of single) if (news) items.push(plainItem(segment, news));
  if (quick.length >= 2) {
    items.push({
      ...blank,
      segment: 'quick',
      tag: SEGMENT_INFO.quick.tag,
      headline: 'Quick hits',
      subhead: 'More from today',
      points: pointLines(quick.map((q) => q.title)),
      context: quick.map((q) => `${q.title} (${q.site})`).join('\n').slice(0, 2000),
      ticker: clip(quick.map((q) => q.title).join(' · '), 200),
      seconds: 45,
      sources: quick.map((q) => sourceOf(q, '')),
    });
  }
  items.push({
    ...blank,
    segment: 'close',
    tag: SEGMENT_INFO.close.tag,
    headline: clip(`That was ${show.name}`, 90),
    subhead: clip(`Follow ${show.host} for tomorrow's show`, 120),
    points: handles,
    ticker: clip(`Follow @${show.x} on X · ${show.github} on GitHub · ${show.linkedin} on LinkedIn`, 200),
    seconds: 20,
  });

  return rundownSchema.parse({
    date,
    generatedAt: now.toISOString(),
    model: null,
    warnings: [...collected.warnings, reason].map((w) => clip(w, 200)).slice(0, 20),
    items: withIds(items),
  });
}

function withIds(items: Omit<RundownItem, 'id'>[]): RundownItem[] {
  const seen = new Map<Segment, number>();
  return items.map((entry) => {
    const index = (seen.get(entry.segment) ?? 0) + 1;
    seen.set(entry.segment, index);
    return { ...entry, id: `${entry.segment}-${index}` };
  });
}

// ---------- The prompt ----------

/**
 * The show is written in two calls. Asked for all of it at once, a model writes every segment
 * short; asked for half, it writes each at the length the host needs.
 */
export const PARTS: Segment[][] = [
  ['open', 'top', 'story'],
  ['repo', 'project', 'model', 'paper', 'quick', 'number', 'close'],
];

/** Spoken words per item of each segment. The show comes to about 2,300. */
const WORDS: Record<Segment, number> = { open: 100, top: 400, story: 230, repo: 210, project: 210, model: 210, paper: 210, quick: 220, number: 110, close: 90 };

/**
 * The instructions and the day's items for one part of the show. `covered` lists the headlines an
 * earlier part already used, so this part does not tell the same story again.
 */
export function buildPrompt(picked: NewsItem[], show: Show, date: string, part: readonly Segment[] = SEGMENTS, covered: string[] = []): { system: string; user: string } {
  const count = part.reduce((sum, segment) => sum + SEGMENT_INFO[segment].count, 0);
  const total = part.reduce((sum, segment) => sum + SEGMENT_INFO[segment].count * WORDS[segment], 0);
  const shape = part
    .map((segment) => `- "${segment}" × ${SEGMENT_INFO[segment].count}: ${SEGMENT_NOTES[segment]} Script: about ${WORDS[segment]} words${SEGMENT_INFO[segment].count > 1 ? ' each' : ''}.`)
    .join('\n');

  const system = `You are the head writer of "${show.name}", a daily news show about artificial intelligence presented live on video by ${show.host}. Today is ${longDate(date)}.

You are given a numbered list of today's items from news sites, lab blogs, Hacker News, GitHub, Hugging Face and arXiv. Choose what matters most to developers and people who follow AI, and write this part of the show.

Write exactly these ${count} items, in this order:
${shape}

Rules for choosing:
- Prefer items with real substance: a release, a result, a number, a decision. Skip opinion pieces, marketing and anything you cannot explain from what you were given.
- Do not use the same item in two segments. The same event reported by several sites is one story: cite each of them as a source.
- The repo, project, model and paper of the day must be chosen from items of kind repo, show or space, model, and paper.

Rules for writing:
- "script" is what ${show.host} says out loud, word for word, in the first person. Plain spoken English: short sentences, no jargon without a quick explanation, no hype words, no stage directions, no markdown, no emoji. Say what is confirmed and what is only claimed. When a number matters, say it.
- Explain each story the way a good presenter would: what happened, the details that make it concrete, why it matters to the viewer, and what to watch next. Use the facts in the item's text; that is where the substance is.
- Only state facts that are in the items you were given. Do not bring in other products, companies, benchmarks, licences, install steps or numbers from memory. If a detail is missing, say in a few words that it is not known yet, and move on. Never mention scores, points, likes or comment counts as if they were the news, unless the segment is about that number.
- Keep to the word counts above. This part is about ${total} words of script in all. Writing much less leaves the host with nothing to say on air.
- The opening welcomes viewers to ${show.name}, says the host's name and the date, and teases the three biggest headlines.
- The sign-off recaps the day in two sentences, drawing on the stories already covered as well as this part, says what to watch for tomorrow, and asks viewers to follow ${show.host}: on X at @${show.x}, on GitHub at ${show.github} and on LinkedIn at ${show.linkedin}.
- "headline" is what appears on screen in large type: at most 60 characters, no full stop. "subhead" is one more line of at most 110 characters.
- "points" are exactly three short lines for the side panel, each at most 80 characters. Every item has them.
- "context" is private background for the host, not read out: who is involved, what came before, the numbers, what is uncertain, and one question viewers may ask. About 80 words.
- "ticker" is one line of at most 120 characters for the strip at the bottom of the screen.
- "sources" lists the items the segment is based on, by item number, most important first, at most 4. For each, "quote" is one sentence from that item's text that is worth showing on screen, at most 200 characters; it is about the news itself, never about points or comments. Never write a web address anywhere. Item numbers belong in "sources" only: the script and the context never say "item 12".

Answer with one JSON object and nothing else, in this shape, with ${count} items:
{"items":[{"segment":"${part[0]}","headline":"","subhead":"","points":["","",""],"script":"","context":"","ticker":"","sources":[{"n":1,"quote":""}]}]}`;

  const lines = picked.map((entry, index) => `[${index + 1}] ${entry.kind} | ${entry.site} | score ${entry.score} | ${entry.title} | ${clip(entry.summary, 1500)}`);
  const earlier = covered.length ? `\n\nAlready covered earlier in today's show, so do not tell these again:\n${covered.map((h) => `- ${h}`).join('\n')}` : '';
  return { system, user: `Today's items:\n\n${lines.join('\n')}${earlier}\n\nWrite this part of the rundown for ${longDate(date)} as JSON.` };
}

const SEGMENT_NOTES: Record<Segment, string> = {
  open: 'the welcome and the three biggest headlines. No sources.',
  top: 'the biggest story of the day, in depth: what happened, why it matters, what comes next.',
  story: 'the next most important stories, each different in subject from the others.',
  repo: 'repo of the day, one GitHub repository: what it does, who it is for, how to try it.',
  project: 'project of the day, one Show HN post or Hugging Face Space that someone built.',
  model: 'model of the day, one trending model: what it is, what it is good at, how big it is.',
  paper: 'paper of the day, one arXiv paper explained in plain words, with the takeaway.',
  quick: 'quick hits: four or five more items, one or two sentences each, in one script. The points are their headlines.',
  number: 'number of the day: one figure taken from the items, and what it tells us. The headline is the number.',
  close: 'the sign-off. No sources.',
};

// ---------- Reading the model's answer ----------

/** The JSON object in a model's answer, with or without a code fence or words around it. */
export function extractJson(answer: string): unknown {
  const start = answer.indexOf('{');
  if (start < 0) throw new Error('The model did not answer with JSON');
  // Walk to the brace that closes the first one, skipping braces inside strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < answer.length; i += 1) {
    const char = answer[i]!;
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && (depth -= 1) === 0) return JSON.parse(answer.slice(start, i + 1));
  }
  throw new Error('The model stopped before finishing its answer');
}

const isSegment = (value: unknown): value is Segment => (SEGMENTS as readonly string[]).includes(value as string);

type Draft = Omit<RundownItem, 'id'>;

/** A quote that is the aggregator's score line says nothing worth putting on screen. */
const SCORE_LINE = /\b\d+\s+(points?|comments?|likes?|stars?|downloads?)\b/i;

/** The first sentences of a script, as story points, for a model that left the points out. */
const pointsFrom = (script: string) => pointLines(script.split(/(?<=[.!?])\s+/).slice(0, 3));

/**
 * The usable items in a model's answer for one part of the show. Unknown segments and sources are
 * dropped and text is cut to fit the screen. Throws when nothing usable was written.
 */
function readItems(raw: unknown, picked: NewsItem[], part: readonly Segment[]): Draft[] {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw) ? raw : Array.isArray(root.items) ? root.items : [];
  const taken = new Map<Segment, number>();
  const drafts: Draft[] = [];

  for (const value of list) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (!isSegment(entry.segment) || !part.includes(entry.segment)) continue;
    const segment = entry.segment;
    const headline = clip(oneLine(text(entry.headline)), 90);
    const script = clip(tidy(text(entry.script)), 6000);
    const count = taken.get(segment) ?? 0;
    if (!headline || !script || count >= SEGMENT_INFO[segment].count) continue;
    taken.set(segment, count + 1);

    const sources: RundownSource[] = [];
    for (const cited of Array.isArray(entry.sources) ? entry.sources : []) {
      const ref = cited && typeof cited === 'object' ? (cited as Record<string, unknown>) : {};
      const news = Number.isInteger(ref.n) ? picked[(ref.n as number) - 1] : undefined;
      if (!news || sources.some((s) => s.url === news.url) || sources.length >= 6) continue;
      const quote = text(ref.quote);
      sources.push(sourceOf(news, SCORE_LINE.test(quote) ? '' : quote));
    }

    drafts.push({
      segment,
      tag: clip(oneLine(text(entry.tag)), 16) || SEGMENT_INFO[segment].tag,
      headline,
      subhead: clip(oneLine(text(entry.subhead)), 120),
      points: pointLines(entry.points) || pointsFrom(script),
      script,
      context: clip(tidy(text(entry.context)), 2000),
      ticker: clip(oneLine(text(entry.ticker)), 200) || headline,
      seconds: Math.min(1800, Math.max(5, Math.round(script.split(/\s+/).length / WORDS_PER_SECOND))),
      sources,
    });
  }
  if (drafts.length === 0) throw new Error('The model wrote no usable segment');
  return drafts;
}

/** The finished rundown: what the models wrote, in show order, with the plain item for any segment they left out. */
function assemble(drafts: Draft[], plain: Rundown, model: string, warnings: string[]): Rundown {
  const items = SEGMENTS.flatMap((segment) => {
    const written = drafts.filter((d) => d.segment === segment);
    return written.length ? written : plain.items.filter((i) => i.segment === segment).map(({ id: _id, ...rest }) => rest);
  });
  return rundownSchema.parse({ ...plain, model: clip(model, 80), warnings: warnings.map((w) => clip(w, 200)).slice(0, 20), items: withIds(items) });
}

// ---------- The models ----------

/** Asks a model for the rundown and returns its answer as text. */
export type Generate = (system: string, user: string) => Promise<string>;

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_TIMEOUT_MS = 240_000;
/** Pauses before asking a busy model again. */
const BUSY_WAITS_MS = [5_000, 15_000, 30_000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** NVIDIA's hosted models, through their OpenAI-compatible chat endpoint. */
export function nvidiaGenerate(fetch: Fetch, key: string, model: string, wait: (ms: number) => Promise<void> = sleep): Generate {
  return async (system, user) => {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.5,
          max_tokens: 16000,
          response_format: { type: 'json_object' },
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error('NVIDIA gave an empty answer');
        return content;
      }
      // The big models answer "busy" at peak times; that is worth waiting for. Nothing else is.
      const busy = res.status === 503 || res.status === 429;
      if (!busy || attempt >= BUSY_WAITS_MS.length) throw new Error(`NVIDIA answered ${res.status}`);
      await wait(BUSY_WAITS_MS[attempt]!);
    }
  };
}

export function geminiGenerate(key: string, model: string): Generate {
  return async (system, user) => {
    const { GoogleGenAI } = await import('@google/genai');
    const response = await new GoogleGenAI({ apiKey: key }).models.generateContent({
      model,
      contents: user,
      config: { systemInstruction: system, responseMimeType: 'application/json', temperature: 0.5 },
    });
    if (!response.text) throw new Error('Gemini gave an empty answer');
    return response.text;
  };
}

export interface Provider {
  /** The model's name, recorded on the rundown it writes. */
  name: string;
  generate: Generate;
}

function providersFor(config: NewsConfig, fetch: Fetch): Provider[] {
  const list: Provider[] = [];
  if (config.nvidiaKey) {
    list.push({ name: config.model, generate: nvidiaGenerate(fetch, config.nvidiaKey, config.model) });
    if (config.fallbackModel !== config.model) list.push({ name: config.fallbackModel, generate: nvidiaGenerate(fetch, config.nvidiaKey, config.fallbackModel) });
  }
  if (config.geminiKey) list.push({ name: config.geminiModel, generate: geminiGenerate(config.geminiKey, config.geminiModel) });
  return list;
}

export interface Writer {
  write(collected: Collected, date: string, now: Date): Promise<Rundown>;
}

/** An error's message with anything that looks like a key taken out, safe to show the host. */
function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : 'The model call failed';
  return clip(oneLine(message).replace(/(nvapi-|AIza|AQ\.)[\w.-]+/g, '[key]'), 160);
}

/**
 * Writes the show part by part. Each part goes to the first model that gives a usable answer; a
 * model gets a second try at an answer it garbled, and is not asked again once it has failed. With
 * no model, or when none wrote anything, the rundown is built from the items without scripts.
 */
export function createWriter(config: NewsConfig, fetch: Fetch, providers: Provider[] = providersFor(config, fetch)): Writer {
  return {
    async write(collected, date, now) {
      const picked = selectItems(collected.items);
      const out = new Set<string>();
      const drafts: Draft[] = [];
      const models: string[] = [];
      const problems: string[] = [];
      if (providers.length === 0) problems.push('No model key is set, so the scripts were not written');

      for (const part of PARTS) {
        const { system, user } = buildPrompt(picked, config.show, date, part, drafts.map((d) => d.headline));
        let written: Draft[] | null = null;
        for (const provider of providers) {
          if (out.has(provider.name)) continue;
          let failure = '';
          for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
            let answer: string;
            try {
              answer = await provider.generate(system, user);
            } catch (err) {
              // The call itself failed (busy, refused, timed out): asking again will not help.
              failure = reasonOf(err);
              break;
            }
            try {
              written = readItems(extractJson(answer), picked, part);
            } catch (err) {
              failure = reasonOf(err);
            }
          }
          if (written) {
            if (!models.includes(provider.name)) models.push(provider.name);
            break;
          }
          out.add(provider.name);
          problems.push(`${provider.name} could not write the scripts: ${failure}`);
        }
        if (written) drafts.push(...written);
      }

      const reason = problems.at(-1) ?? '';
      if (drafts.length === 0) return buildPlainRundown(collected, config.show, date, now, reason || 'No model wrote the scripts');
      const plain = buildPlainRundown(collected, config.show, date, now, '');
      return assemble(drafts, plain, models.join(' + '), [...collected.warnings, ...problems]);
    },
  };
}
