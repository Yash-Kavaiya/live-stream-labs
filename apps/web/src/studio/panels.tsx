import {
  activeBanner,
  PLATFORMS,
  type Banner,
  type CommentDto,
  type OnScreenComment,
  type PlatformId,
  type Scene,
} from '@studio/shared';
import { Button, EmptyState, Icon, IconButton, Switch, TextField } from '@studio/ui';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import type { ChatEntry } from './useStudioRoom';

export type SceneUpdater = (change: (scene: Scene) => Scene) => void;

function platformName(id: string): string {
  return PLATFORMS[id as PlatformId]?.name ?? 'Studio';
}

function useStickToBottom(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [dependency]);
  return ref;
}

// ---------- Comments from the platforms ----------

function sameComment(shown: OnScreenComment | null, c: CommentDto): boolean {
  return shown?.author === c.author && shown.text === c.text;
}

export function CommentsPanel({
  comments,
  scene,
  update,
}: {
  comments: CommentDto[];
  scene: Scene;
  update: SceneUpdater;
}) {
  const listRef = useStickToBottom(comments.length);
  if (comments.length === 0) {
    return (
      <EmptyState icon="forum" title="No comments yet">
        <p className="body-medium">
          Comments from Twitch and YouTube appear here while you are live. Click one to show it on
          screen.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="panel-scroll" ref={listRef}>
      {comments.map((comment) => {
        const shown = sameComment(scene.comment, comment);
        return (
          <button
            key={comment.id}
            type="button"
            className={`comment ${shown ? 'shown' : ''}`}
            aria-pressed={shown}
            title={shown ? 'Hide from screen' : 'Show on screen'}
            onClick={() =>
              update((s) => ({
                ...s,
                comment: shown
                  ? null
                  : { author: comment.author, text: comment.text, platform: platformName(comment.platform) },
              }))
            }
          >
            <span className="label-medium muted">
              {comment.author} · {platformName(comment.platform)}
            </span>
            <span className="body-medium">{comment.text}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Banners ----------

export function BannersPanel({ scene, update }: { scene: Scene; update: SceneUpdater }) {
  const [text, setText] = useState('');
  const [style, setStyle] = useState<Banner['style']>('lower-third');
  const active = activeBanner(scene);

  const add = () => {
    const value = text.trim();
    if (!value) return;
    const banner: Banner = { id: crypto.randomUUID().slice(0, 8), text: value, style };
    update((s) => ({ ...s, banners: [...s.banners, banner].slice(-30) }));
    setText('');
  };

  return (
    <div className="panel-scroll col">
      <TextField label="Banner text" value={text} onValue={setText} maxLength={200} onEnter={add} data-testid="banner-text" />
      <div className="row">
        <div className="segmented grow" role="group" aria-label="Banner style">
          <button type="button" aria-pressed={style === 'lower-third'} onClick={() => setStyle('lower-third')}>
            <Icon name="call_to_action" /> Banner
          </button>
          <button type="button" aria-pressed={style === 'ticker'} onClick={() => setStyle('ticker')}>
            <Icon name="text_rotation_none" /> Ticker
          </button>
        </div>
        <Button variant="tonal" icon="add" onClick={add} disabled={!text.trim()} data-testid="banner-add">
          Add
        </Button>
      </div>

      {scene.banners.length === 0 && (
        <p className="body-medium muted">Banners sit over the video. Add one, then click it to show or hide it.</p>
      )}
      {scene.banners.map((banner) => {
        const shown = active?.id === banner.id;
        return (
          <div key={banner.id} className={`banner-item ${shown ? 'shown' : ''}`}>
            <button
              type="button"
              className="banner-toggle"
              aria-pressed={shown}
              data-testid="banner-toggle"
              onClick={() => update((s) => ({ ...s, activeBannerId: shown ? null : banner.id }))}
            >
              <Icon name={banner.style === 'ticker' ? 'text_rotation_none' : 'call_to_action'} />
              <span className="body-medium grow">{banner.text}</span>
              {shown && <span className="chip primary">Showing</span>}
            </button>
            <IconButton
              icon="delete"
              label="Delete banner"
              onClick={() =>
                update((s) => ({
                  ...s,
                  banners: s.banners.filter((b) => b.id !== banner.id),
                  activeBannerId: s.activeBannerId === banner.id ? null : s.activeBannerId,
                }))
              }
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------- Brand ----------

// Google's core brand colours plus neutrals.
const SWATCHES = ['#0B57D0', '#D93025', '#188038', '#F9AB00', '#9334E6', '#E8710A', '#1F1F1F', '#FFFFFF'];

type BrandImage = 'logoUrl' | 'overlayUrl' | 'backgroundUrl';

const BRAND_IMAGES: { key: BrandImage; label: string; icon: string; hint: string }[] = [
  { key: 'logoUrl', label: 'Logo', icon: 'verified', hint: 'Top-right corner. A transparent PNG works best.' },
  { key: 'overlayUrl', label: 'Overlay', icon: 'layers', hint: 'Full frame, drawn over the video. 1280×720 transparent PNG.' },
  { key: 'backgroundUrl', label: 'Background', icon: 'wallpaper', hint: 'Full frame, drawn behind the video.' },
];

export function BrandPanel({ broadcastId, scene, update }: { broadcastId: string; scene: Scene; update: SceneUpdater }) {
  const toast = useToast();
  const { brand } = scene;
  const setBrand = (patch: Partial<Scene['brand']>) => update((s) => ({ ...s, brand: { ...s.brand, ...patch } }));

  const upload = async (key: BrandImage, file: File | undefined) => {
    if (!file) return;
    try {
      const { url } = await api.uploadAsset(broadcastId, file);
      setBrand({ [key]: url });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="panel-scroll col" style={{ gap: 20 }}>
      <section className="col">
        <h3 className="title-small">Brand colour</h3>
        <div className="row wrap" style={{ gap: 8 }}>
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ background: color }}
              aria-label={`Use ${color}`}
              aria-pressed={brand.color.toUpperCase() === color}
              onClick={() => setBrand({ color })}
            />
          ))}
          <label className="swatch custom" title="Custom colour">
            <Icon name="colorize" />
            <input type="color" value={brand.color} onChange={(e) => setBrand({ color: e.target.value })} aria-label="Custom colour" />
          </label>
        </div>
      </section>

      <Switch label="Show names on video" selected={brand.showNames} onChange={(showNames) => setBrand({ showNames })} />

      {BRAND_IMAGES.map(({ key, label, icon, hint }) => (
        <section key={key} className="col" style={{ gap: 8 }}>
          <h3 className="title-small">{label}</h3>
          <div className="row">
            {brand[key] ? <img className="brand-preview" src={brand[key]!} alt={`${label} preview`} /> : <div className="brand-preview center"><Icon name={icon} /></div>}
            <label className="file-button grow">
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void upload(key, e.target.files?.[0])} />
              <span className="label-large">{brand[key] ? 'Replace' : 'Upload'}</span>
            </label>
            {brand[key] && <IconButton icon="delete" label={`Remove ${label.toLowerCase()}`} onClick={() => setBrand({ [key]: null })} />}
          </div>
          <p className="body-small muted">{hint}</p>
        </section>
      ))}
    </div>
  );
}

// ---------- Private studio chat ----------

export function ChatPanel({ chat, onSend }: { chat: ChatEntry[]; onSend(text: string): void }) {
  const [text, setText] = useState('');
  const listRef = useStickToBottom(chat.length);
  const send = () => {
    onSend(text);
    setText('');
  };
  return (
    <div className="panel-chat">
      <div className="panel-scroll" ref={listRef}>
        {chat.length === 0 && (
          <p className="body-medium muted">Private chat between you and your guests. Viewers never see it.</p>
        )}
        {chat.map((entry) => (
          <div key={entry.id} className={`chat-message ${entry.mine ? 'mine' : ''}`}>
            <span className="label-medium muted">{entry.mine ? 'You' : entry.author}</span>
            <span className="body-medium">{entry.text}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ padding: 12 }}>
        <TextField label="Message" value={text} onValue={setText} onEnter={send} maxLength={1000} data-testid="chat-input" />
        <IconButton icon="send" label="Send" variant="filled" disabled={!text.trim()} onClick={send} />
      </div>
    </div>
  );
}
