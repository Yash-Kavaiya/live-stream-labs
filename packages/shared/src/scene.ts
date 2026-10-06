import { z } from 'zod';

export const LAYOUT_IDS = [
  'solo',
  'grid',
  'split',
  'stack',
  'duo',
  'mosaic',
  'spotlight',
  'pip',
  'screen',
  'cinema',
] as const;
export const layoutIdSchema = z.enum(LAYOUT_IDS);
export type LayoutId = z.infer<typeof layoutIdSchema>;

export const LAYOUT_LABELS: Record<LayoutId, string> = {
  solo: 'Solo',
  grid: 'Grid',
  split: 'Side by side',
  stack: 'Stacked',
  duo: 'Lead + guests',
  mosaic: 'Mosaic',
  spotlight: 'Spotlight',
  pip: 'Picture in picture',
  screen: 'Screen + sidebar',
  cinema: 'Cinema',
};

export const MAX_ON_STAGE = 10;

/**
 * A stage source is something the compositor can draw:
 *   cam:<identity>     a participant's camera
 *   screen:<identity>  a participant's screen share
 *   clip:<identity>    a video clip a participant is playing
 *   media              the shared image in `scene.media`
 */
export type SourceKind = 'cam' | 'screen' | 'clip' | 'media';

export const sourceIdSchema = z
  .string()
  .max(200)
  .regex(/^(?:(?:cam|screen|clip):.+|media)$/);

export function sourceId(kind: Exclude<SourceKind, 'media'>, identity: string): string {
  return `${kind}:${identity}`;
}

export function parseSourceId(id: string): { kind: SourceKind; identity: string } {
  if (id === 'media') return { kind: 'media', identity: '' };
  const cut = id.indexOf(':');
  return { kind: id.slice(0, cut) as SourceKind, identity: id.slice(cut + 1) };
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Assets are uploaded to the API first, so scene URLs are always same-origin paths. */
const assetUrl = z.string().max(300).startsWith('/assets/');

export const bannerSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(200),
  style: z.enum(['lower-third', 'ticker']),
});
export type Banner = z.infer<typeof bannerSchema>;

export const commentSchema = z.object({
  author: z.string().max(80),
  text: z.string().max(500),
  platform: z.string().max(20),
});
export type OnScreenComment = z.infer<typeof commentSchema>;

export const brandSchema = z.object({
  color: hexColor,
  logoUrl: assetUrl.nullable(),
  overlayUrl: assetUrl.nullable(),
  backgroundUrl: assetUrl.nullable(),
  showNames: z.boolean(),
});
export type Brand = z.infer<typeof brandSchema>;

export const TEMPLATE_IDS = ['none', 'newsroom', 'cricket', 'watchparty'] as const;
export const templateIdSchema = z.enum(TEMPLATE_IDS);
export type TemplateId = z.infer<typeof templateIdSchema>;

/** `live` shows the stage; the others cover it with a full-frame holding card and mute the mix. */
export const SCREEN_IDS = ['live', 'starting', 'brb', 'ending'] as const;
export const screenIdSchema = z.enum(SCREEN_IDS);
export type ScreenId = z.infer<typeof screenIdSchema>;

// ---------- News room ----------

/**
 * The shots of a news programme:
 *   anchor     one presenter, with a story panel (or the other sources) beside them
 *   interview  everyone side by side in equal boxes
 *   panel      a grid of everyone, for a discussion
 *   headline   a full-frame headline graphic with the presenter in a corner
 */
export const NEWS_VIEWS = ['anchor', 'interview', 'panel', 'headline'] as const;
export type NewsView = (typeof NEWS_VIEWS)[number];

export const newsSchema = z.object({
  view: z.enum(NEWS_VIEWS),
  channel: z.string().max(24),
  /** The label in front of the headline: BREAKING, LIVE, DEVELOPING... */
  tag: z.string().max(16),
  headline: z.string().max(90),
  subhead: z.string().max(120),
  /** Story points for the anchor panel, one per line. */
  points: z.string().max(300),
});
export type News = z.infer<typeof newsSchema>;

export const DEFAULT_NEWS: News = {
  view: 'anchor',
  channel: 'STUDIO NEWS',
  tag: 'BREAKING',
  headline: '',
  subhead: '',
  points: '',
};

// ---------- Cricket ----------

const count = z.number().int().min(0).max(9999);
const playerName = z.string().max(24);

export const batterSchema = z.object({ name: playerName, runs: count, balls: count });
export type Batter = z.infer<typeof batterSchema>;

/** One innings, scored ball by ball. See `cricket.ts` for the scoring rules. */
export const cricketSchema = z.object({
  /** match: video with a score strip. dashboard: the full scorecard with cameras at the side. */
  view: z.enum(['match', 'dashboard']),
  title: z.string().max(40),
  batting: playerName,
  bowling: playerName,
  runs: count,
  wickets: z.number().int().min(0).max(10),
  /** Legal balls bowled in the innings. */
  balls: count,
  oversLimit: z.number().int().min(1).max(90),
  /** Runs needed to win when chasing; null in the first innings. */
  target: count.nullable(),
  batters: z.tuple([batterSchema, batterSchema]),
  striker: z.union([z.literal(0), z.literal(1)]),
  bowler: z.object({ name: playerName, balls: count, runs: count, wickets: count }),
  /** Outcomes of the current over, oldest first: "0".."6", "W", "wd", "nb". */
  thisOver: z.array(z.string().max(3)).max(14),
});
export type Cricket = z.infer<typeof cricketSchema>;

export const DEFAULT_CRICKET: Cricket = {
  view: 'match',
  title: 'T20 Match',
  batting: 'IND',
  bowling: 'AUS',
  runs: 0,
  wickets: 0,
  balls: 0,
  oversLimit: 20,
  target: null,
  batters: [
    { name: 'Batter 1', runs: 0, balls: 0 },
    { name: 'Batter 2', runs: 0, balls: 0 },
  ],
  striker: 0,
  bowler: { name: 'Bowler', balls: 0, runs: 0, wickets: 0 },
  thisOver: [],
};

// ---------- Celebrations ----------

/**
 * A one-shot animation over the whole frame. Every client plays it when it sees a new `id`;
 * `at` lets someone who joins later skip one that is already over.
 */
export const celebrationSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(['winner', 'reaction']),
  emoji: z.string().max(8),
  /** Winner's name. Empty for a reaction. */
  text: z.string().max(40),
  at: z.number(),
});
export type Celebration = z.infer<typeof celebrationSchema>;

// ---------- Look of the frame ----------

/**
 * How the tiles are arranged and dressed. The geometry fields mirror `LayoutOptions`; lengths are
 * in hundredths of the frame height so a look is the same at any resolution.
 */
export const layoutStyleSchema = z.object({
  gap: z.number().min(0).max(6),
  radius: z.number().min(0).max(8),
  padding: z.number().min(0).max(10),
  mainShare: z.number().min(0.5).max(0.85),
  sideLeft: z.boolean(),
  pipCorner: z.enum(['tl', 'tr', 'bl', 'br']),
  pipSize: z.number().min(0.12).max(0.35),
  /** cover crops cameras to fill their tile; contain shows the whole picture with bars. */
  cameraFit: z.enum(['cover', 'contain']),
  border: z.enum(['none', 'thin', 'thick']),
  borderColor: z.enum(['white', 'brand']),
  shadow: z.boolean(),
  /** Behind the tiles in the clean look. Templates bring their own backdrop. */
  backdrop: z.enum(['dark', 'light', 'brand', 'gradient']),
  nameStyle: z.enum(['pill', 'bar', 'text']),
  namePosition: z.enum(['bottom-left', 'bottom-center', 'top-left']),
});
export type LayoutStyle = z.infer<typeof layoutStyleSchema>;

export const DEFAULT_STYLE: LayoutStyle = {
  gap: 2.2,
  radius: 2.2,
  padding: 2.2,
  mainShare: 0.78,
  sideLeft: false,
  pipCorner: 'br',
  pipSize: 0.2,
  cameraFit: 'cover',
  border: 'none',
  borderColor: 'white',
  shadow: false,
  backdrop: 'dark',
  nameStyle: 'pill',
  namePosition: 'bottom-left',
};

/** What the studio does by itself so the host does not have to direct every change. */
export const autoSchema = z.object({
  /** Put guests on stage as they join, until `maxOnStage` people are there. */
  addGuests: z.boolean(),
  maxOnStage: z.number().int().min(1).max(MAX_ON_STAGE),
  /** Re-pick the layout whenever the set of sources on stage changes. */
  layout: z.boolean(),
  /** Move whoever is speaking into the main slot. */
  followSpeaker: z.boolean(),
  /** Ring around the tile of whoever is speaking. */
  highlightSpeaker: z.boolean(),
});
export type AutoDirector = z.infer<typeof autoSchema>;

export const DEFAULT_AUTO: AutoDirector = {
  addGuests: true,
  maxOnStage: 3,
  layout: true,
  followSpeaker: false,
  highlightSpeaker: true,
};

export const sceneSchema = z.object({
  layout: layoutIdSchema,
  stage: z.array(sourceIdSchema).max(MAX_ON_STAGE),
  banners: z.array(bannerSchema).max(30),
  activeBannerId: z.string().nullable(),
  comment: commentSchema.nullable(),
  media: z.object({ url: assetUrl }).nullable(),
  brand: brandSchema,
  // Added after the first release; defaults keep scenes saved before then valid, and `catch`
  // maps a template that no longer exists back to the clean look.
  template: templateIdSchema.default('none').catch('none'),
  screen: screenIdSchema.default('live'),
  screenMessage: z.string().max(80).default(''),
  /** Length of the countdown on the Starting and BRB screens, in seconds. 0 means no countdown. */
  screenTimerSec: z.number().int().min(0).max(6 * 60 * 60).default(0),
  /** When the running countdown reaches zero (epoch ms), so every client shows the same time. */
  screenEndsAt: z.number().nullable().default(null),
  auto: autoSchema.default(DEFAULT_AUTO),
  news: newsSchema.default(DEFAULT_NEWS),
  cricket: cricketSchema.default(DEFAULT_CRICKET),
  celebration: celebrationSchema.nullable().default(null),
  style: layoutStyleSchema.default(DEFAULT_STYLE),
});
export type Scene = z.infer<typeof sceneSchema>;

export const DEFAULT_SCENE: Scene = {
  layout: 'grid',
  stage: [],
  banners: [],
  activeBannerId: null,
  comment: null,
  media: null,
  brand: { color: '#0B57D0', logoUrl: null, overlayUrl: null, backgroundUrl: null, showNames: true },
  template: 'none',
  screen: 'live',
  screenMessage: '',
  screenTimerSec: 0,
  screenEndsAt: null,
  auto: DEFAULT_AUTO,
  news: DEFAULT_NEWS,
  cricket: DEFAULT_CRICKET,
  celebration: null,
  style: DEFAULT_STYLE,
};

/** Parses a stored or received scene, filling in fields that older scenes do not have. */
export function normalizeScene(value: unknown, fallback: Scene = DEFAULT_SCENE): Scene {
  const parsed = sceneSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

// --- Pure scene transitions. The studio applies these, then sends the result to the API. ---

export function addToStage(scene: Scene, id: string): Scene {
  if (scene.stage.includes(id) || scene.stage.length >= MAX_ON_STAGE) return scene;
  return { ...scene, stage: [...scene.stage, id] };
}

export function removeFromStage(scene: Scene, id: string): Scene {
  if (!scene.stage.includes(id)) return scene;
  return { ...scene, stage: scene.stage.filter((s) => s !== id) };
}

/** Moves a source to the front; the first source is the "main" one in every layout. */
export function promoteOnStage(scene: Scene, id: string): Scene {
  if (!scene.stage.includes(id)) return scene;
  return { ...scene, stage: [id, ...scene.stage.filter((s) => s !== id)] };
}

export function moveOnStage(scene: Scene, id: string, toIndex: number): Scene {
  const from = scene.stage.indexOf(id);
  if (from < 0) return scene;
  const stage = scene.stage.filter((s) => s !== id);
  stage.splice(Math.max(0, Math.min(toIndex, stage.length)), 0, id);
  return { ...scene, stage };
}

/** Drops every source that belongs to a participant who left the room. */
export function removeParticipantSources(scene: Scene, identity: string): Scene {
  const stage = scene.stage.filter((id) => parseSourceId(id).identity !== identity);
  return stage.length === scene.stage.length ? scene : { ...scene, stage };
}

export function activeBanner(scene: Scene): Banner | null {
  return scene.banners.find((b) => b.id === scene.activeBannerId) ?? null;
}
