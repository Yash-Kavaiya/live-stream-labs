import { z } from 'zod';

/**
 * Social links shown on the Starting, BRB and Ending screens, each with an optional QR code so
 * viewers can follow from their phone. The host types a handle (`@yash`) or pastes a full link.
 */
export const SOCIAL_IDS = ['x', 'youtube', 'instagram', 'linkedin', 'tiktok', 'twitch', 'github', 'facebook', 'website'] as const;
export type SocialId = (typeof SOCIAL_IDS)[number];

export interface SocialInfo {
  name: string;
  /** A short mark drawn in the badge on the video, since the icon font is not on the canvas. */
  mark: string;
  /** The platform's colour for that badge. */
  color: string;
  /** Builds the profile link from a bare handle. */
  url(handle: string): string;
  /** Whether a bare handle reads as `@handle`. */
  at: boolean;
  placeholder: string;
}

export const SOCIALS: Record<SocialId, SocialInfo> = {
  x: { name: 'X', mark: 'X', color: '#000000', url: (h) => `https://x.com/${h}`, at: true, placeholder: '@yourhandle' },
  youtube: { name: 'YouTube', mark: '▶', color: '#FF0000', url: (h) => `https://youtube.com/@${h}`, at: true, placeholder: '@yourchannel' },
  instagram: { name: 'Instagram', mark: 'IG', color: '#E1306C', url: (h) => `https://instagram.com/${h}`, at: true, placeholder: '@yourhandle' },
  linkedin: { name: 'LinkedIn', mark: 'in', color: '#0A66C2', url: (h) => `https://linkedin.com/in/${h}`, at: false, placeholder: 'your-name' },
  tiktok: { name: 'TikTok', mark: '♪', color: '#111111', url: (h) => `https://tiktok.com/@${h}`, at: true, placeholder: '@yourhandle' },
  twitch: { name: 'Twitch', mark: 'TV', color: '#9146FF', url: (h) => `https://twitch.tv/${h}`, at: false, placeholder: 'yourchannel' },
  github: { name: 'GitHub', mark: 'GH', color: '#24292F', url: (h) => `https://github.com/${h}`, at: true, placeholder: '@yourname' },
  facebook: { name: 'Facebook', mark: 'f', color: '#1877F2', url: (h) => `https://facebook.com/${h}`, at: false, placeholder: 'yourpage' },
  website: { name: 'Website', mark: 'www', color: '#5F6368', url: (h) => `https://${h}`, at: false, placeholder: 'example.com' },
};

const handle = z.string().max(120).default('');
const EMPTY_LINKS = Object.fromEntries(SOCIAL_IDS.map((id) => [id, ''])) as Record<SocialId, string>;

export const socialsSchema = z.object({
  links: z.object(Object.fromEntries(SOCIAL_IDS.map((id) => [id, handle])) as Record<SocialId, typeof handle>).default(EMPTY_LINKS),
  /** Show the links on the Starting, BRB and Ending screens. */
  show: z.boolean().default(true),
  /** Draw a QR code above each link. */
  qr: z.boolean().default(true),
});
export type Socials = z.infer<typeof socialsSchema>;

export const DEFAULT_SOCIALS: Socials = { links: EMPTY_LINKS, show: true, qr: true };

export interface SocialLink {
  id: SocialId;
  /** What viewers read: `@yash`, `linkedin.com/in/yash`. */
  label: string;
  /** Where the QR code points. */
  url: string;
}

const isUrl = (value: string) => /^https?:\/\//i.test(value);

/** The link for one platform, or null when nothing usable was typed. */
export function socialLink(id: SocialId, raw: string): SocialLink | null {
  const value = raw.trim();
  if (!value) return null;
  const info = SOCIALS[id];
  if (isUrl(value)) {
    return { id, url: value, label: value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') };
  }
  const bare = value.replace(/^@/, '').replace(/\s+/g, '');
  if (!bare) return null;
  return { id, url: info.url(id === 'website' ? bare : encodeURI(bare)), label: info.at ? `@${bare}` : bare };
}

/** Every filled-in link, in the order of SOCIAL_IDS. */
export function socialLinks(socials: Socials): SocialLink[] {
  return SOCIAL_IDS.map((id) => socialLink(id, socials.links[id])).filter((link): link is SocialLink => link !== null);
}
