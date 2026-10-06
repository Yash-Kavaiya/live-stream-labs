import { z } from 'zod';
import { BANNER_STYLE_INFO, rundownSourceSchema, type Banner, type Scene } from './scene';

/** The parts of the daily show, in the order they are presented. */
export const SEGMENTS = ['open', 'top', 'story', 'repo', 'project', 'model', 'paper', 'quick', 'number', 'close'] as const;
export type Segment = (typeof SEGMENTS)[number];

export interface SegmentInfo {
  /** The label in front of the headline on screen. At most 16 characters. */
  tag: string;
  label: string;
  /** How many items of this kind a show has. */
  count: number;
}

export const SEGMENT_INFO: Record<Segment, SegmentInfo> = {
  open: { tag: 'TODAY', label: 'Cold open', count: 1 },
  top: { tag: 'TOP STORY', label: 'Top story', count: 1 },
  story: { tag: 'AI NEWS', label: 'Story', count: 4 },
  repo: { tag: 'REPO OF THE DAY', label: 'Repo of the day', count: 1 },
  project: { tag: 'PROJECT', label: 'Project of the day', count: 1 },
  model: { tag: 'MODEL', label: 'Model of the day', count: 1 },
  paper: { tag: 'PAPER', label: 'Paper of the day', count: 1 },
  quick: { tag: 'QUICK HITS', label: 'Quick hits', count: 1 },
  number: { tag: 'NUMBER', label: 'Number of the day', count: 1 },
  close: { tag: 'SIGN-OFF', label: 'Sign-off', count: 1 },
};

/** One thing the host presents. The on-screen text has the same limits as the news scene's fields. */
export const rundownItemSchema = z.object({
  id: z.string().min(1).max(40),
  segment: z.enum(SEGMENTS),
  tag: z.string().max(16),
  headline: z.string().max(90),
  subhead: z.string().max(120),
  /** Story points, one per line. */
  points: z.string().max(300),
  /** The words to speak. Empty when no model wrote the rundown. */
  script: z.string().max(6000),
  /** Background for the host: who is involved, what came before, numbers, caveats. */
  context: z.string().max(2000),
  /** One line for the ticker strip. */
  ticker: z.string().max(200),
  /** Estimated speaking time. */
  seconds: z.number().int().min(0).max(1800),
  sources: z.array(rundownSourceSchema).max(6),
});
export type RundownItem = z.infer<typeof rundownItemSchema>;

export const rundownSchema = z.object({
  /** The show's day in India: YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string().max(40),
  /** The model that wrote the scripts, or null when the rundown was built without one. */
  model: z.string().max(80).nullable(),
  /** What went wrong while making it, for the host to read: a feed that failed, a model that was not used. */
  warnings: z.array(z.string().max(200)).max(20),
  items: z.array(rundownItemSchema).max(20),
});
export type Rundown = z.infer<typeof rundownSchema>;

export const RUNDOWN_TICKER_ID = 'rundown-ticker';
export const RUNDOWN_SOCIAL_ID = 'rundown-social';

/** Total speaking time of a show, in seconds. */
export function rundownSeconds(rundown: Rundown): number {
  return rundown.items.reduce((sum, item) => sum + item.seconds, 0);
}

/** Adds the banner, or replaces the one with the same id, and makes it the one showing in its slot. */
function showBanner(scene: Scene, banner: Banner): Scene {
  const slot = BANNER_STYLE_INFO[banner.style].slot;
  const exists = scene.banners.some((b) => b.id === banner.id);
  const banners = exists ? scene.banners.map((b) => (b.id === banner.id ? banner : b)) : [...scene.banners, banner].slice(-30);
  const sameSlot = new Set(banners.filter((b) => BANNER_STYLE_INFO[b.style].slot === slot).map((b) => b.id));
  const active = [...scene.activeBannerIds, ...(scene.activeBannerId ? [scene.activeBannerId] : [])].filter((id) => !sameSlot.has(id));
  return { ...scene, banners, activeBannerId: null, activeBannerIds: [...new Set([...active, banner.id])].slice(-8) };
}

function hideBanner(scene: Scene, id: string): Scene {
  if (!scene.activeBannerIds.includes(id) && scene.activeBannerId !== id) return scene;
  return {
    ...scene,
    activeBannerId: scene.activeBannerId === id ? null : scene.activeBannerId,
    activeBannerIds: scene.activeBannerIds.filter((active) => active !== id),
  };
}

/**
 * Puts an item of the rundown on air: its headline, second line and story points go into the news
 * scene, its ticker line onto the ticker strip, and any source card comes down. The sign-off also
 * shows the host's handle; every other item takes it off again.
 */
export function applyRundownItem(scene: Scene, item: RundownItem, social?: { handle: string; line: string }): Scene {
  let next: Scene = {
    ...scene,
    news: {
      ...scene.news,
      tag: item.tag,
      headline: item.headline,
      subhead: item.subhead,
      points: item.points,
      source: null,
      rundownItemId: item.id,
    },
  };
  const ticker = item.ticker.trim();
  if (ticker) next = showBanner(next, { id: RUNDOWN_TICKER_ID, text: ticker, subtitle: '', style: 'ticker' });
  if (item.segment === 'close' && social?.handle.trim()) {
    next = showBanner(next, { id: RUNDOWN_SOCIAL_ID, text: social.handle.trim().slice(0, 200), subtitle: social.line.slice(0, 120), style: 'social' });
  } else {
    next = hideBanner(next, RUNDOWN_SOCIAL_ID);
  }
  return next;
}
