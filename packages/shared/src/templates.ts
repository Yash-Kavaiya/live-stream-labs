import type { LayoutId, Scene, ScreenId, TemplateId } from './scene';
import { parseSourceId } from './scene';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
  /** Becomes the brand colour when the template is applied. */
  accent: string;
  /** Top and bottom colour of the backdrop gradient behind the video tiles. */
  backdrop: [string, string];
  /** True when the template shows the scoreboard. */
  scoreboard: boolean;
}

export const TEMPLATES: Record<TemplateId, TemplateInfo> = {
  none: {
    id: 'none',
    name: 'Clean',
    description: 'Just your video on a dark backdrop.',
    accent: '#0B57D0',
    backdrop: ['#101114', '#101114'],
    scoreboard: false,
  },
  newsroom: {
    id: 'newsroom',
    name: 'News room',
    description: 'Live bug, clock and a headline bar.',
    accent: '#D93025',
    backdrop: ['#0B1F47', '#040A18'],
    scoreboard: false,
  },
  sports: {
    id: 'sports',
    name: 'Sports',
    description: 'Scoreboard in the corner, bold stripes.',
    accent: '#F9AB00',
    backdrop: ['#111827', '#05070D'],
    scoreboard: true,
  },
  cricket: {
    id: 'cricket',
    name: 'Cricket',
    description: 'Score strip along the bottom: runs, wickets, overs.',
    accent: '#188038',
    backdrop: ['#06391C', '#02140A'],
    scoreboard: true,
  },
  watchparty: {
    id: 'watchparty',
    name: 'Watch party',
    description: 'Shared video up top, everyone in a row below.',
    accent: '#9334E6',
    backdrop: ['#2E1065', '#831843'],
    scoreboard: false,
  },
};

export const SCREEN_LABELS: Record<ScreenId, string> = {
  live: 'Live',
  starting: 'Starting soon',
  brb: 'Be right back',
  ending: 'Thanks for watching',
};

const DEFAULT_SCOREBOARDS: Partial<Record<TemplateId, NonNullable<Scene['scoreboard']>>> = {
  sports: { teamA: 'HOME', teamB: 'AWAY', scoreA: '0', scoreB: '0', info: '1st half' },
  cricket: { teamA: 'IND', teamB: 'AUS', scoreA: '0/0', scoreB: '', info: 'Overs 0.0' },
};

function hasSharedContent(stage: string[]): boolean {
  return stage.some((id) => parseSourceId(id).kind !== 'cam');
}

/**
 * The layout the auto director picks for what is on stage. Shared content (a screen, clip or
 * image) always gets the big slot; otherwise people share the frame equally unless the studio is
 * following the speaker.
 */
export function pickAutoLayout(
  stage: string[],
  options: { followSpeaker: boolean; template: TemplateId },
): LayoutId {
  if (hasSharedContent(stage)) return options.template === 'watchparty' ? 'cinema' : 'screen';
  // A themed backdrop should stay visible around a single person; a clean look fills the frame.
  if (stage.length <= 1) return options.template === 'none' ? 'solo' : 'grid';
  return options.followSpeaker ? 'spotlight' : 'grid';
}

/** Switches the look: accent colour, a scoreboard where the template has one, and a fitting layout. */
export function applyTemplate(scene: Scene, id: TemplateId): Scene {
  const template = TEMPLATES[id];
  return {
    ...scene,
    template: id,
    brand: { ...scene.brand, color: template.accent },
    scoreboard: template.scoreboard ? (scene.scoreboard ?? DEFAULT_SCOREBOARDS[id] ?? null) : scene.scoreboard,
    layout: pickAutoLayout(scene.stage, { followSpeaker: scene.auto.followSpeaker, template: id }),
  };
}
