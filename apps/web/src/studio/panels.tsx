import {
  activeBanner,
  applyTemplate,
  MAX_ON_STAGE,
  PLATFORMS,
  SCREEN_IDS,
  setScreen,
  setScreenTimer,
  TEMPLATE_IDS,
  TEMPLATES,
  type AutoDirector,
  type ScreenId,
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
import { TEMPLATE_PAGES } from './template-panels';
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

// ---------- Scenes: holding screens, templates, auto director ----------

/** Quick picks for the countdown, in minutes. 0 turns it off. */
const TIMER_MINUTES = [0, 1, 2, 5, 10];

const SCREEN_BUTTONS: Record<ScreenId, { label: string; icon: string }> = {
  live: { label: 'Live', icon: 'videocam' },
  starting: { label: 'Starting', icon: 'hourglass_top' },
  brb: { label: 'BRB', icon: 'coffee' },
  ending: { label: 'Ending', icon: 'waving_hand' },
};

export function ScenesPanel({ scene, update, onOpenPage }: { scene: Scene; update: SceneUpdater; onOpenPage(): void }) {
  const template = TEMPLATES[scene.template];
  const setAuto = (patch: Partial<AutoDirector>) => update((s) => ({ ...s, auto: { ...s.auto, ...patch } }));
  const stepMax = (by: number) =>
    setAuto({ maxOnStage: Math.min(MAX_ON_STAGE, Math.max(1, scene.auto.maxOnStage + by)) });

  return (
    <div className="panel-scroll col" style={{ gap: 24 }}>
      <section className="col">
        <h3 className="title-small">On screen now</h3>
        <div className="screen-grid" role="group" aria-label="Screen">
          {SCREEN_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="screen-button"
              aria-pressed={scene.screen === id}
              data-testid={`screen-${id}`}
              onClick={() => update((s) => setScreen(s, id))}
            >
              <Icon name={SCREEN_BUTTONS[id].icon} />
              <span className="label-medium">{SCREEN_BUTTONS[id].label}</span>
            </button>
          ))}
        </div>
        <div className="col" style={{ gap: 8 }}>
          <span className="body-medium">Countdown on Starting and BRB</span>
          <div className="timer-row" role="group" aria-label="Countdown length">
            {TIMER_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="timer-chip"
                aria-pressed={scene.screenTimerSec === minutes * 60}
                data-testid={`timer-${minutes}`}
                onClick={() => update((s) => setScreenTimer(s, minutes * 60))}
              >
                {minutes === 0 ? 'Off' : `${minutes} min`}
              </button>
            ))}
          </div>
          <TextField
            label="Or type the minutes"
            value={scene.screenTimerSec ? String(Math.round((scene.screenTimerSec / 60) * 10) / 10) : ''}
            onValue={(text) => {
              const minutes = Number.parseFloat(text.replace(',', '.'));
              update((s) => setScreenTimer(s, Number.isFinite(minutes) ? Math.min(360, Math.max(0, minutes)) * 60 : 0));
            }}
            placeholder="No countdown"
            data-testid="timer-custom"
          />
        </div>
        <TextField
          label="Message on the holding screen"
          value={scene.screenMessage}
          onValue={(screenMessage) => update((s) => ({ ...s, screenMessage }))}
          maxLength={80}
          placeholder="We start at 6 pm"
        />
        <p className="body-small muted">
          Starting, BRB and Ending cover the stage and mute everyone for viewers. You can still talk
          to your guests. The countdown starts when the screen comes up; you go back to Live
          yourself when you are ready.
        </p>
      </section>

      <section className="col">
        <h3 className="title-small">Template</h3>
        <div className="template-grid">
          {TEMPLATE_IDS.map((id) => {
            const info = TEMPLATES[id];
            return (
              <button
                key={id}
                type="button"
                className="template-card"
                aria-pressed={scene.template === id}
                data-testid={`template-${id}`}
                title={info.description}
                onClick={() => update((s) => applyTemplate(s, id))}
              >
                <span
                  className="template-swatch"
                  style={{ background: `linear-gradient(160deg, ${info.backdrop[0]}, ${info.backdrop[1]})` }}
                >
                  <span className="template-accent" style={{ background: info.accent }} />
                </span>
                <span className="label-large">{info.name}</span>
              </button>
            );
          })}
        </div>
        <p className="body-small muted">{template.description}</p>
        <div>
          <Button variant="tonal" icon={TEMPLATE_PAGES[scene.template].icon} onClick={onOpenPage} data-testid="open-template-page">
            Open the {TEMPLATE_PAGES[scene.template].label} page
          </Button>
        </div>
      </section>

      <section className="col">
        <h3 className="title-small">Auto director</h3>
        <Switch label="Put guests on stage when they join" selected={scene.auto.addGuests} onChange={(addGuests) => setAuto({ addGuests })} />
        <div className="row" style={{ justifyContent: 'space-between', opacity: scene.auto.addGuests ? 1 : 0.5 }}>
          <span className="body-large">Up to this many people</span>
          <span className="row" style={{ gap: 4 }}>
            <IconButton icon="remove" label="Fewer people on stage" disabled={!scene.auto.addGuests || scene.auto.maxOnStage <= 1} onClick={() => stepMax(-1)} />
            <span className="title-medium" style={{ minWidth: 24, textAlign: 'center' }} data-testid="max-on-stage">
              {scene.auto.maxOnStage}
            </span>
            <IconButton icon="add" label="More people on stage" disabled={!scene.auto.addGuests || scene.auto.maxOnStage >= MAX_ON_STAGE} onClick={() => stepMax(1)} />
          </span>
        </div>
        <Switch label="Arrange the layout automatically" selected={scene.auto.layout} onChange={(layout) => setAuto({ layout })} />
        <Switch label="Highlight who is speaking" selected={scene.auto.highlightSpeaker} onChange={(highlightSpeaker) => setAuto({ highlightSpeaker })} />
        <Switch label="Move the speaker to the main spot" selected={scene.auto.followSpeaker} onChange={(followSpeaker) => setAuto({ followSpeaker })} />
      </section>
    </div>
  );
}
