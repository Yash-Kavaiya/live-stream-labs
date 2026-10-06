import { z } from 'zod';

export const PLATFORM_IDS = [
  'youtube',
  'twitch',
  'facebook',
  'linkedin',
  'x',
  'instagram',
  'custom',
] as const;

export const platformIdSchema = z.enum(PLATFORM_IDS);
export type PlatformId = z.infer<typeof platformIdSchema>;

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  /** Brand colour, used only for the small platform badge. */
  color: string;
  /** Pre-filled ingest URL for the manual RTMP form. Empty when the platform issues one per stream. */
  defaultRtmpUrl: string;
  /** True when a one-click OAuth adapter exists (it still needs app credentials on the server). */
  oauth: boolean;
  /** Where the user finds the RTMP URL and stream key on the platform. */
  keyHelp: string;
}

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    color: '#FF0000',
    defaultRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    oauth: true,
    keyHelp: 'YouTube Studio → Go live → Stream → Stream key.',
  },
  twitch: {
    id: 'twitch',
    name: 'Twitch',
    color: '#9146FF',
    defaultRtmpUrl: 'rtmp://live.twitch.tv/app',
    oauth: true,
    keyHelp: 'Creator Dashboard → Settings → Stream → Primary stream key.',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    color: '#1877F2',
    defaultRtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp',
    oauth: true,
    keyHelp: 'Facebook Live Producer → Streaming software → Stream key.',
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    color: '#0A66C2',
    defaultRtmpUrl: '',
    oauth: false,
    keyHelp: 'LinkedIn → Create event or post → Go live → Custom stream. Copy the URL and key.',
  },
  x: {
    id: 'x',
    name: 'X',
    color: '#000000',
    defaultRtmpUrl: '',
    oauth: false,
    keyHelp: 'X Media Studio → Producer → Sources → Create source. Copy the RTMP URL and key.',
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    color: '#E4405F',
    defaultRtmpUrl: 'rtmps://live-upload.instagram.com:443/rtmp',
    oauth: false,
    keyHelp: 'Instagram on desktop → Create → Live video → Streaming software. Copy the stream key.',
  },
  custom: {
    id: 'custom',
    name: 'Custom RTMP',
    color: '#5F6368',
    defaultRtmpUrl: '',
    oauth: false,
    keyHelp: 'Any RTMP or RTMPS ingest: paste its server URL and stream key.',
  },
};

/** Joins an ingest URL and a stream key the way every RTMP platform expects. */
export function buildRtmpTarget(url: string, key: string): string {
  const base = url.trim().replace(/\/+$/, '');
  const streamKey = key.trim().replace(/^\/+/, '');
  return streamKey ? `${base}/${streamKey}` : base;
}

/** Hides the stream key when a target has to appear in logs or error messages. */
export function redactRtmpTarget(target: string): string {
  const cut = target.lastIndexOf('/');
  return cut > 'rtmps://'.length ? `${target.slice(0, cut)}/***` : target;
}
