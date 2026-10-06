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
}

export const TEMPLATES: Record<TemplateId, TemplateInfo> = {
  none: {
    id: 'none',
    name: 'Clean',
    description: 'Just your video on a dark backdrop.',
    accent: '#0B57D0',
    backdrop: ['#101114', '#101114'],
  },
  newsroom: {
    id: 'newsroom',
    name: 'News room',
    description: 'Anchor, interview, panel and headline shots with a channel bar and headlines.',
    accent: '#D93025',
    backdrop: ['#0B1F47', '#040A18'],
  },
  cricket: {
    id: 'cricket',
    name: 'Cricket',
    description: 'Ball-by-ball scoring with a score strip or a full match dashboard.',
    accent: '#188038',
    backdrop: ['#06391C', '#02140A'],
  },
  watchparty: {
    id: 'watchparty',
    name: 'Watch party',
    description: 'Shared video up top, everyone below, with reactions and a winner celebration.',
    accent: '#9334E6',
    backdrop: ['#2E1065', '#831843'],
  },
};

export const SCREEN_LABELS: Record<ScreenId, string> = {
  live: 'Live',
  starting: 'Starting soon',
  brb: 'Be right back',
  ending: 'Thanks for watching',
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

/** Switches the look: the template's accent colour and a layout that suits it. */
export function applyTemplate(scene: Scene, id: TemplateId): Scene {
  return {
    ...scene,
    template: id,
    brand: { ...scene.brand, color: TEMPLATES[id].accent },
    layout: pickAutoLayout(scene.stage, { followSpeaker: scene.auto.followSpeaker, template: id }),
  };
}

/** The screens that can run a countdown. */
export function hasCountdown(screen: ScreenId): boolean {
  return screen === 'starting' || screen === 'brb';
}

/**
 * Switches what viewers see. Going to Starting or BRB starts the countdown, if one is set;
 * any other screen clears it.
 */
export function setScreen(scene: Scene, screen: ScreenId, now = Date.now()): Scene {
  const timed = hasCountdown(screen) && scene.screenTimerSec > 0;
  return { ...scene, screen, screenEndsAt: timed ? now + scene.screenTimerSec * 1000 : null };
}

/** Changes the countdown length; if a countdown screen is showing, it restarts from the new length. */
export function setScreenTimer(scene: Scene, seconds: number, now = Date.now()): Scene {
  return setScreen({ ...scene, screenTimerSec: Math.max(0, Math.round(seconds)) }, scene.screen, now);
}

/** 299_400 ms -> "5:00", 61_000 -> "1:01", 3_725_000 -> "1:02:05". Never negative. */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
}
