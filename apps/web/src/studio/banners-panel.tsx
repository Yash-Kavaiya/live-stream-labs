import {
  activeBanners,
  addBanner,
  BANNER_STYLE_INFO,
  BANNER_STYLES,
  hideAllBanners,
  removeBanner,
  toggleBanner,
  type Banner,
  type BannerSlot,
  type BannerStyle,
  type Scene,
} from '@studio/shared';
import { Button, Icon, IconButton, TextField } from '@studio/ui';
import { useState } from 'react';
import { MusicPanel } from './music/music-panel';
import type { MusicPlayer } from './music/player';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const SLOT_LABELS: Record<BannerSlot, string> = {
  bottom: 'Bottom left',
  side: 'Bottom right',
  ticker: 'Bottom strip',
  top: 'Top',
  corner: 'Top-left corner',
  center: 'Centre',
};

/** Ready-made banners. One click adds the banner and puts it on screen. */
const PRESETS: { name: string; style: BannerStyle; text: string; subtitle?: string }[] = [
  { name: 'Subscribe', style: 'cta', text: 'Subscribe', subtitle: 'Enjoying the show?' },
  { name: 'Follow', style: 'social', text: '@yourhandle', subtitle: 'Follow us everywhere' },
  { name: 'Q&A', style: 'badge', text: 'Live Q&A' },
  { name: 'Ask us', style: 'lower-third', text: 'Ask your questions in the chat' },
  { name: 'Guest', style: 'name-title', text: 'Guest name', subtitle: 'Role, Company' },
  { name: 'Topic', style: 'headline', text: "Today's topic", subtitle: 'What we are covering' },
  { name: 'Up next', style: 'title', text: 'Up next', subtitle: 'Stay with us' },
  { name: 'Ticker', style: 'ticker', text: 'Welcome to the stream · New here? Say hello in the chat' },
];

const newId = () => crypto.randomUUID().slice(0, 8);

interface Props {
  broadcastId: string;
  scene: Scene;
  update: SceneUpdater;
  music: MusicPlayer | null;
  ensureMusic(): MusicPlayer;
  /** The host's handle, for the Follow preset. */
  handle?: string;
}

export function BannersPanel({ broadcastId, scene, update, music, ensureMusic, handle }: Props) {
  const [style, setStyle] = useState<BannerStyle>('lower-third');
  const [text, setText] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const info = BANNER_STYLE_INFO[style];
  const shown = new Set(activeBanners(scene).map((b) => b.id));

  const add = () => {
    const value = text.trim();
    if (!value) return;
    const banner: Banner = { id: newId(), text: value, subtitle: info.subtitle ? subtitle.trim() : '', style };
    update((s) => addBanner(s, banner));
    setText('');
    setSubtitle('');
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const text = preset.style === 'social' && handle ? `@${handle}` : preset.text;
    const banner: Banner = { id: newId(), text, subtitle: preset.subtitle ?? '', style: preset.style };
    update((s) => toggleBanner(addBanner(s, banner), banner.id));
  };

  return (
    <div className="panel-scroll col" style={{ gap: 20 }}>
      <MusicPanel broadcastId={broadcastId} scene={scene} update={update} player={music} ensurePlayer={ensureMusic} />

      <section className="col">
        <h3 className="title-small">Quick banners</h3>
        <div className="timer-row">
          {PRESETS.map((preset) => (
            <button key={preset.name} type="button" className="timer-chip" data-testid={`preset-${preset.name}`} title={`${BANNER_STYLE_INFO[preset.style].label}: ${preset.text}`} onClick={() => applyPreset(preset)}>
              {preset.name}
            </button>
          ))}
        </div>
        <p className="body-small muted">Adds the banner and shows it. Edit the wording by deleting it and making your own below.</p>
      </section>

      <section className="col">
        <h3 className="title-small">Make a banner</h3>
        <div className="banner-styles" role="group" aria-label="Banner type">
          {BANNER_STYLES.map((id) => (
            <button
              key={id}
              type="button"
              className="screen-button"
              aria-pressed={style === id}
              data-testid={`banner-style-${id}`}
              title={BANNER_STYLE_INFO[id].hint}
              onClick={() => setStyle(id)}
            >
              <Icon name={BANNER_STYLE_INFO[id].icon} />
              <span className="label-medium">{BANNER_STYLE_INFO[id].label}</span>
            </button>
          ))}
        </div>
        <p className="body-small muted">
          {info.hint} Shows in: {SLOT_LABELS[info.slot].toLowerCase()}.
        </p>
        <TextField label={style === 'social' ? 'Handle' : style === 'name-title' ? 'Name' : 'Text'} value={text} onValue={setText} maxLength={200} onEnter={add} data-testid="banner-text" />
        {info.subtitle && <TextField label={info.subtitle} value={subtitle} onValue={setSubtitle} maxLength={120} onEnter={add} data-testid="banner-subtitle" />}
        <div>
          <Button variant="tonal" icon="add" onClick={add} disabled={!text.trim()} data-testid="banner-add">
            Add banner
          </Button>
        </div>
      </section>

      <section className="col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 className="title-small">Your banners</h3>
          {shown.size > 0 && (
            <Button variant="text" icon="visibility_off" onClick={() => update(hideAllBanners)} data-testid="banner-hide-all">
              Hide all
            </Button>
          )}
        </div>
        {scene.banners.length === 0 && (
          <p className="body-medium muted">
            Banners sit over the video. Click one to show or hide it. Banners in different positions
            can be up at the same time; a new one replaces the banner already in its position.
          </p>
        )}
        {scene.banners.map((banner) => {
          const isShown = shown.has(banner.id);
          const bannerInfo = BANNER_STYLE_INFO[banner.style];
          return (
            <div key={banner.id} className={`banner-item ${isShown ? 'shown' : ''}`}>
              <button
                type="button"
                className="banner-toggle"
                aria-pressed={isShown}
                data-testid="banner-toggle"
                title={`${bannerInfo.label} · ${SLOT_LABELS[bannerInfo.slot]}`}
                onClick={() => update((s) => toggleBanner(s, banner.id))}
              >
                <Icon name={bannerInfo.icon} />
                <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
                  <span className="body-medium truncate">{banner.text}</span>
                  <span className="body-small truncate" style={{ opacity: 0.75 }}>
                    {banner.subtitle || bannerInfo.label}
                  </span>
                </span>
                {isShown && <span className="chip primary">Showing</span>}
              </button>
              <IconButton icon="delete" label="Delete banner" onClick={() => update((s) => removeBanner(s, banner.id))} />
            </div>
          );
        })}
      </section>
    </div>
  );
}
