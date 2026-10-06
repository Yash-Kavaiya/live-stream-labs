import { z } from 'zod';

export const LAYOUT_IDS = ['solo', 'grid', 'spotlight', 'pip', 'screen', 'cinema'] as const;
export const layoutIdSchema = z.enum(LAYOUT_IDS);
export type LayoutId = z.infer<typeof layoutIdSchema>;

export const LAYOUT_LABELS: Record<LayoutId, string> = {
  solo: 'Solo',
  grid: 'Grid',
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

export const TEMPLATE_IDS = ['none', 'newsroom', 'sports', 'cricket', 'watchparty'] as const;
export const templateIdSchema = z.enum(TEMPLATE_IDS);
export type TemplateId = z.infer<typeof templateIdSchema>;

/** `live` shows the stage; the others cover it with a full-frame holding card and mute the mix. */
export const SCREEN_IDS = ['live', 'starting', 'brb', 'ending'] as const;
export const screenIdSchema = z.enum(SCREEN_IDS);
export type ScreenId = z.infer<typeof screenIdSchema>;

/** Free-text on purpose: "2", "182/4" and "40-15" are all scores. */
export const scoreboardSchema = z.object({
  teamA: z.string().max(24),
  teamB: z.string().max(24),
  scoreA: z.string().max(12),
  scoreB: z.string().max(12),
  info: z.string().max(60),
});
export type Scoreboard = z.infer<typeof scoreboardSchema>;

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
  // Added after the first release; defaults keep scenes saved before then valid.
  template: templateIdSchema.default('none'),
  screen: screenIdSchema.default('live'),
  screenMessage: z.string().max(80).default(''),
  scoreboard: scoreboardSchema.nullable().default(null),
  auto: autoSchema.default(DEFAULT_AUTO),
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
  scoreboard: null,
  auto: DEFAULT_AUTO,
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
