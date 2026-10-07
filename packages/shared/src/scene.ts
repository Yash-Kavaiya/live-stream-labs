import { z } from 'zod';
import { DEFAULT_PARTY, partySchema } from './party';

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

/**
 * Banners sit in slots. One banner per slot can show at a time, so a lower third, a ticker and a
 * corner badge can all be up together, but two lower thirds cannot.
 */
export type BannerSlot = 'bottom' | 'side' | 'ticker' | 'top' | 'corner' | 'center';

export const BANNER_STYLES = [
  'lower-third',
  'name-title',
  'social',
  'cta',
  'ticker',
  'headline',
  'badge',
  'title',
] as const;
export type BannerStyle = (typeof BANNER_STYLES)[number];

export interface BannerStyleInfo {
  label: string;
  slot: BannerSlot;
  icon: string;
  hint: string;
  /** Label of the second text field, or null when the style has only one line. */
  subtitle: string | null;
}

export const BANNER_STYLE_INFO: Record<BannerStyle, BannerStyleInfo> = {
  'lower-third': { label: 'Lower third', slot: 'bottom', icon: 'call_to_action', hint: 'One line, bottom left.', subtitle: null },
  'name-title': { label: 'Name + title', slot: 'bottom', icon: 'badge', hint: 'Introduce a guest: name and role.', subtitle: 'Title or role' },
  social: { label: 'Social handle', slot: 'bottom', icon: 'alternate_email', hint: 'Your @handle and where to find it.', subtitle: 'Platform or note' },
  cta: { label: 'Call to action', slot: 'side', icon: 'ads_click', hint: 'A pulsing button, bottom right.', subtitle: 'Line above (optional)' },
  ticker: { label: 'Ticker', slot: 'ticker', icon: 'text_rotation_none', hint: 'Scrolling text along the bottom.', subtitle: null },
  headline: { label: 'Top headline', slot: 'top', icon: 'title', hint: 'A bar across the top: the topic of the show.', subtitle: 'Second line (optional)' },
  badge: { label: 'Corner badge', slot: 'corner', icon: 'new_releases', hint: 'A small label, top left: NEW, LIVE Q&A.', subtitle: null },
  title: { label: 'Title card', slot: 'center', icon: 'featured_video', hint: 'Big centred title over a dimmed picture.', subtitle: 'Line below (optional)' },
};

export const bannerSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(200),
  subtitle: z.string().max(120).default(''),
  style: z.enum(BANNER_STYLES),
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

/** A music track the host uploaded for this broadcast. Built-in tracks are not listed here. */
export const musicTrackSchema = z.object({
  id: z.string().max(40),
  name: z.string().max(60),
  url: assetUrl,
});
export type MusicTrack = z.infer<typeof musicTrackSchema>;
export const MAX_MUSIC_TRACKS = 12;

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

/** A page a story came from: drawn as a card on the stream, and opened by the host to share. */
export const rundownSourceSchema = z.object({
  url: z.string().max(500).regex(/^https?:\/\//i),
  title: z.string().max(160),
  site: z.string().max(40),
  /** The sentence worth showing on screen. */
  quote: z.string().max(240),
});
export type RundownSource = z.infer<typeof rundownSourceSchema>;

export const newsSchema = z.object({
  view: z.enum(NEWS_VIEWS),
  channel: z.string().max(24),
  /** The label in front of the headline: BREAKING, LIVE, DEVELOPING... */
  tag: z.string().max(16),
  headline: z.string().max(90),
  subhead: z.string().max(120),
  /** Story points for the anchor panel, one per line. */
  points: z.string().max(300),
  /** The source card on screen, or null. */
  source: rundownSourceSchema.nullable().default(null),
  /** The item of the day's rundown that is on air, so the studio can mark it and step from it. */
  rundownItemId: z.string().max(40).nullable().default(null),
});
export type News = z.infer<typeof newsSchema>;

export const DEFAULT_NEWS: News = {
  view: 'anchor',
  channel: 'STUDIO NEWS',
  tag: 'BREAKING',
  headline: '',
  subhead: '',
  points: '',
  source: null,
  rundownItemId: null,
};

// ---------- Cricket ----------

const count = z.number().int().min(0).max(9999);
const playerName = z.string().max(24);

export const batterSchema = z.object({ name: playerName, runs: count, balls: count });
export type Batter = z.infer<typeof batterSchema>;

/**
 * How the cricket template arranges the frame:
 *
 *   match      cameras in the usual layout above a score strip
 *   bug        cameras fill the frame, with a small score box in the corner
 *   split      cameras on the left, a score panel on the right
 *   dashboard  the full scoreboard, cameras in a column at the side
 *   card       the batting and bowling card, cameras in a column at the side
 */
export const CRICKET_VIEWS = ['match', 'bug', 'split', 'dashboard', 'card'] as const;
export type CricketView = (typeof CRICKET_VIEWS)[number];

/** One innings, scored ball by ball by hand or followed from a live score feed. See `cricket.ts`. */
export const cricketSchema = z.object({
  view: z.enum(CRICKET_VIEWS).catch('match'),
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

  // Added with live scores; the defaults keep scenes saved before then valid.
  /** manual: the host taps each ball. live: the host's studio copies a real match into this innings. */
  source: z.enum(['manual', 'live']).default('manual'),
  /** The feed's ids for the match being followed. */
  liveMatch: z.object({ league: z.string().max(20), event: z.string().max(20) }).nullable().default(null),
  /** Live only: where the match stands, e.g. "IND need 165 from 118 balls". */
  status: z.string().max(80).default(''),
  /** Live only: the other side's score, e.g. "WI 171 (19.1 ov)". */
  other: z.string().max(40).default(''),
  /** Live only: the batting card of this innings, in batting order. */
  card: z
    .array(z.object({ name: playerName, how: z.string().max(40), runs: count, balls: count }))
    .max(11)
    .default([]),
  /** Live only: the bowlers used in this innings. */
  attack: z
    .array(z.object({ name: playerName, overs: z.string().max(6), runs: count, wickets: count }))
    .max(8)
    .default([]),
  /** Live only: runs and wickets in each over of this innings, for the over-by-over chart. */
  overs: z
    .array(z.object({ over: count, runs: count, wickets: z.number().int().min(0).max(10) }))
    .max(50)
    .default([]),
  /** Live only: the unbroken stand between the two batters at the crease. */
  partnership: z.object({ runs: count, balls: count }).nullable().default(null),
  /** Live only: the total the batting side is heading for at this rate (first innings). */
  projected: count.nullable().default(null),
  /** Live only: team colours, batting side first; null draws both in the brand colour. */
  colors: z.tuple([hexColor, hexColor]).nullable().default(null),
  /** Play a moment over the frame when the score earns one: a boundary, a wicket, a milestone, a free hit. */
  autoMoments: z.boolean().default(true),
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
  // A new cricket scene follows a real match; scenes saved before live scores stay hand-scored.
  source: 'live',
  liveMatch: null,
  status: '',
  other: '',
  card: [],
  attack: [],
  overs: [],
  partnership: null,
  projected: null,
  colors: null,
  autoMoments: true,
};

// ---------- Celebrations ----------

/**
 * A one-shot animation over the whole frame. Every client plays it when it sees a new `id`;
 * `at` lets someone who joins later skip one that is already over.
 */
/** The cricket moments. Each has its own cartoon; `custom` shows an emoji instead. */
export const CRICKET_MOMENTS = ['four', 'six', 'wicket', 'fifty', 'hundred', 'freehit', 'custom'] as const;
export type CricketMoment = (typeof CRICKET_MOMENTS)[number];

export const celebrationSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(['winner', 'reaction', 'moment']),
  emoji: z.string().max(8),
  /** Winner's name, or a moment's headline when it is not the usual one. Empty for a reaction. */
  text: z.string().max(40),
  at: z.number(),
  /** Moment only: which cartoon plays. */
  moment: z.enum(CRICKET_MOMENTS).optional(),
  /** Moment only: the line under the headline, e.g. "Kohli 52 (31)". */
  detail: z.string().max(40).optional(),
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
  /** Superseded by `activeBannerIds`; still read so scenes saved before then keep their banner. */
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
  activeBannerIds: z.array(z.string().max(40)).max(8).default([]),
  music: z.array(musicTrackSchema).max(MAX_MUSIC_TRACKS).default([]),
  party: partySchema.default(DEFAULT_PARTY),
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
  activeBannerIds: [],
  music: [],
  party: DEFAULT_PARTY,
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

/** Every banner that is showing, at most one per slot. */
export function activeBanners(scene: Scene): Banner[] {
  const ids = new Set(scene.activeBannerIds);
  if (scene.activeBannerId) ids.add(scene.activeBannerId);
  const bySlot = new Map<BannerSlot, Banner>();
  for (const banner of scene.banners) {
    if (ids.has(banner.id)) bySlot.set(BANNER_STYLE_INFO[banner.style].slot, banner);
  }
  return [...bySlot.values()];
}

export function bannerInSlot(scene: Scene, slot: BannerSlot): Banner | null {
  return activeBanners(scene).find((b) => BANNER_STYLE_INFO[b.style].slot === slot) ?? null;
}

/** Shows a banner, replacing whatever was in its slot, or hides it if it was showing. */
export function toggleBanner(scene: Scene, id: string): Scene {
  const banner = scene.banners.find((b) => b.id === id);
  if (!banner) return scene;
  const shown = activeBanners(scene);
  const slot = BANNER_STYLE_INFO[banner.style].slot;
  const others = shown.filter((b) => BANNER_STYLE_INFO[b.style].slot !== slot).map((b) => b.id);
  const wasShown = shown.some((b) => b.id === id);
  return { ...scene, activeBannerId: null, activeBannerIds: wasShown ? others : [...others, id] };
}

export function addBanner(scene: Scene, banner: Banner): Scene {
  return { ...scene, banners: [...scene.banners, banner].slice(-30) };
}

export function removeBanner(scene: Scene, id: string): Scene {
  return {
    ...scene,
    banners: scene.banners.filter((b) => b.id !== id),
    activeBannerId: scene.activeBannerId === id ? null : scene.activeBannerId,
    activeBannerIds: scene.activeBannerIds.filter((active) => active !== id),
  };
}

export function addMusicTrack(scene: Scene, track: MusicTrack): Scene {
  if (scene.music.length >= MAX_MUSIC_TRACKS) return scene;
  return { ...scene, music: [...scene.music, track] };
}

export function removeMusicTrack(scene: Scene, id: string): Scene {
  if (!scene.music.some((t) => t.id === id)) return scene;
  return { ...scene, music: scene.music.filter((t) => t.id !== id) };
}

export function hideAllBanners(scene: Scene): Scene {
  return { ...scene, activeBannerId: null, activeBannerIds: [] };
}
