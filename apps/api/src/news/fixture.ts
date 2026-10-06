import type { Collected, NewsItem } from './sources';

const story = (kind: NewsItem['kind'], title: string, url: string, score: number, summary: string): NewsItem => ({ kind, title, url, site: new URL(url).hostname, summary, score, publishedAt: null });

/** Fixed news for end-to-end tests (`NEWS_FIXTURE=1`): no network, no model, the same every run. */
export async function collectFixture(): Promise<Collected> {
  return {
    items: [
      story('story', 'Fixture Labs releases a faster model', 'https://example.com/faster-model', 900, 'Fixture Labs released a model that is twice as fast. It costs half as much. It is available today.'),
      story('story', 'A chip maker reports record demand', 'https://example.com/chips', 400, 'Demand for accelerators reached a record. Supply remains tight. Prices are steady.'),
      story('repo', 'fixture/agent-kit', 'https://github.com/fixture/agent-kit', 1200, 'A small toolkit for building agents. Written in TypeScript. 1200 stars.'),
    ],
    warnings: [],
  };
}
