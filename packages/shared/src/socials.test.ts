import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE, sceneSchema } from './scene';
import { DEFAULT_SOCIALS, socialLink, socialLinks } from './socials';

describe('social links', () => {
  it('turns a handle into a profile link and an @label', () => {
    expect(socialLink('x', '@yash')).toEqual({ id: 'x', label: '@yash', url: 'https://x.com/yash' });
    expect(socialLink('youtube', 'yashtalks')).toEqual({ id: 'youtube', label: '@yashtalks', url: 'https://youtube.com/@yashtalks' });
    expect(socialLink('linkedin', 'yash-kavaiya')).toEqual({ id: 'linkedin', label: 'yash-kavaiya', url: 'https://linkedin.com/in/yash-kavaiya' });
    expect(socialLink('website', 'example.com')).toEqual({ id: 'website', label: 'example.com', url: 'https://example.com' });
  });

  it('keeps a pasted link and shows it without the protocol', () => {
    expect(socialLink('instagram', 'https://www.instagram.com/yash/')).toEqual({
      id: 'instagram',
      label: 'instagram.com/yash',
      url: 'https://www.instagram.com/yash/',
    });
  });

  it('skips platforms left empty, in a fixed order', () => {
    const links = socialLinks({ ...DEFAULT_SOCIALS, links: { ...DEFAULT_SOCIALS.links, linkedin: 'yash', x: 'yash', youtube: '  ', instagram: '@' } });
    expect(links.map((l) => l.id)).toEqual(['x', 'linkedin']);
  });

  it('fills in socials for scenes saved before they existed', () => {
    const { socials: _, ...old } = DEFAULT_SCENE;
    const parsed = sceneSchema.parse(old);
    expect(parsed.socials).toEqual(DEFAULT_SOCIALS);
    expect(parsed.socials.links.x).toBe('');
  });
});
