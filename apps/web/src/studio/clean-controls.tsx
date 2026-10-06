import {
  DEFAULT_STYLE,
  LAYOUT_IDS,
  LAYOUT_LABELS,
  type LayoutId,
  type LayoutStyle,
  type Scene,
} from '@studio/shared';
import { Button, Icon, IconButton, Slider, Spinner, Switch } from '@studio/ui';
import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import { BACKDROPS, backdropFile, backdropUrl } from './backdrops';
import { LayoutThumb } from './LayoutThumb';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const LAYOUT_HINTS: Record<LayoutId, string> = {
  solo: 'One source fills the frame.',
  grid: 'Everyone the same size.',
  split: 'Two people side by side, full height.',
  stack: 'One above the other, full width.',
  duo: 'One person leads; guests in a column.',
  mosaic: 'A large first tile with the rest around it.',
  spotlight: 'A main tile with small tiles beside it.',
  pip: 'Screen or main camera full frame, others small in a corner.',
  screen: 'Shared screen large, people beside it.',
  cinema: 'Main on top, everyone else in a row below.',
};

/** Layouts where the main tile's share of the width and the side it sits on apply. */
const HAS_SIDEBAR: LayoutId[] = ['duo', 'spotlight', 'screen'];

interface ChoiceProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange(value: T): void;
}

/** A labelled row of mutually exclusive options (M3 segmented button). */
function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="body-medium">{label}</span>
      <div className="segmented" role="group" aria-label={label} style={{ display: 'flex' }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="grow"
            style={{ justifyContent: 'center', padding: '0 8px' }}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <Icon name={option.icon} />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const units = (v: number) => (v === 0 ? 'None' : v.toFixed(1));
const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The picture behind the tiles. It is the same background the Brand tab sets, so every viewer
 * and the stream see it; a built-in picture is uploaded like any other.
 */
function BackgroundPicture({ broadcastId, scene, update }: { broadcastId: string; scene: Scene; update: SceneUpdater }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const current = scene.brand.backgroundUrl;
  const setBackground = (backgroundUrl: string | null) => update((s) => ({ ...s, brand: { ...s.brand, backgroundUrl } }));

  const upload = async (file: File | Promise<File> | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await api.uploadAsset(broadcastId, await file);
      setBackground(url);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="body-medium">Background picture</span>
      <div className="row">
        {current ? (
          <img className="brand-preview" src={current} alt="Background preview" data-testid="background-preview" />
        ) : (
          <div className="brand-preview center"><Icon name="wallpaper" /></div>
        )}
        <label className="file-button grow">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} data-testid="background-upload" />
          <span className="label-large">{current ? 'Replace' : 'Upload'}</span>
        </label>
        {busy && <Spinner size={24} />}
        {current && !busy && <IconButton icon="delete" label="Remove background picture" onClick={() => setBackground(null)} data-testid="background-remove" />}
      </div>
      <div className="effect-grid" role="group" aria-label="Built-in backgrounds">
        {BACKDROPS.map((backdrop) => (
          <button
            key={backdrop.id}
            type="button"
            className="effect-tile"
            title={backdrop.label}
            aria-label={backdrop.label}
            disabled={busy}
            data-testid={`background-${backdrop.id}`}
            onClick={() => void upload(backdropFile(backdrop.id))}
          >
            <img src={backdropUrl(backdrop.id, 160, 90)!} alt="" />
            <span className="label-medium effect-name">{backdrop.label}</span>
          </button>
        ))}
      </div>
      <p className="body-small muted">The picture fills the frame behind the tiles. Add a margin around the frame to see more of it.</p>
    </div>
  );
}

/** The Layout page: every layout as a picture, and every knob that shapes the frame. */
export function CleanControls({ broadcastId, scene, update }: { broadcastId: string; scene: Scene; update: SceneUpdater }) {
  const { style, layout } = scene;
  const set = (patch: Partial<LayoutStyle>) => update((s) => ({ ...s, style: { ...s.style, ...patch } }));
  const customised = JSON.stringify(style) !== JSON.stringify(DEFAULT_STYLE);

  return (
    <div className="panel-scroll col" style={{ gap: 24 }}>
      <section className="col">
        <h3 className="title-small">Layout</h3>
        <div className="layout-gallery">
          {LAYOUT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="layout-card"
              aria-pressed={layout === id}
              data-testid={`gallery-${id}`}
              title={LAYOUT_HINTS[id]}
              // Picking by hand turns automatic layout off, or the next change on stage would undo it.
              onClick={() => update((s) => ({ ...s, layout: id, auto: { ...s.auto, layout: false } }))}
            >
              <LayoutThumb layout={id} style={style} />
              <span className="label-medium">{LAYOUT_LABELS[id]}</span>
            </button>
          ))}
        </div>
        <p className="body-small muted">{LAYOUT_HINTS[layout]}</p>
        <Switch
          label="Arrange the layout automatically"
          selected={scene.auto.layout}
          onChange={(on) => update((s) => ({ ...s, auto: { ...s.auto, layout: on } }))}
        />
      </section>

      <section className="col">
        <h3 className="title-small">Spacing and shape</h3>
        <Slider label="Space between tiles" value={style.gap} min={0} max={6} step={0.2} format={units} onValue={(gap) => set({ gap })} data-testid="style-gap" />
        <Slider label="Margin around the frame" value={style.padding} min={0} max={10} step={0.2} format={units} onValue={(padding) => set({ padding })} />
        <Slider label="Rounded corners" value={style.radius} min={0} max={8} step={0.2} format={units} onValue={(radius) => set({ radius })} />
      </section>

      {HAS_SIDEBAR.includes(layout) && (
        <section className="col">
          <h3 className="title-small">Main tile</h3>
          <Slider label="Size of the main tile" value={style.mainShare} min={0.5} max={0.85} step={0.01} format={percent} onValue={(mainShare) => set({ mainShare })} />
          <Choice
            label="Side column"
            value={style.sideLeft ? 'left' : 'right'}
            options={[
              { value: 'left', label: 'Left', icon: 'align_horizontal_left' },
              { value: 'right', label: 'Right', icon: 'align_horizontal_right' },
            ]}
            onChange={(side) => set({ sideLeft: side === 'left' })}
          />
        </section>
      )}

      {layout === 'pip' && (
        <section className="col">
          <h3 className="title-small">Picture in picture</h3>
          <Slider label="Size of the small tiles" value={style.pipSize} min={0.12} max={0.35} step={0.01} format={percent} onValue={(pipSize) => set({ pipSize })} />
          <Choice
            label="Corner"
            value={style.pipCorner}
            options={[
              { value: 'tl', label: 'Top left' },
              { value: 'tr', label: 'Top right' },
              { value: 'bl', label: 'Bottom left' },
              { value: 'br', label: 'Bottom right' },
            ]}
            onChange={(pipCorner) => set({ pipCorner })}
          />
        </section>
      )}

      <section className="col">
        <h3 className="title-small">Tiles</h3>
        <Choice
          label="Cameras"
          value={style.cameraFit}
          options={[
            { value: 'cover', label: 'Fill (crop)', icon: 'crop' },
            { value: 'contain', label: 'Fit (whole picture)', icon: 'fit_screen' },
          ]}
          onChange={(cameraFit) => set({ cameraFit })}
        />
        <Choice
          label="Border"
          value={style.border}
          options={[
            { value: 'none', label: 'None' },
            { value: 'thin', label: 'Thin' },
            { value: 'thick', label: 'Thick' },
          ]}
          onChange={(border) => set({ border })}
        />
        {style.border !== 'none' && (
          <Choice
            label="Border colour"
            value={style.borderColor}
            options={[
              { value: 'white', label: 'White' },
              { value: 'brand', label: 'Brand colour' },
            ]}
            onChange={(borderColor) => set({ borderColor })}
          />
        )}
        <Switch label="Shadow under tiles" selected={style.shadow} onChange={(shadow) => set({ shadow })} />
      </section>

      <section className="col">
        <h3 className="title-small">Backdrop</h3>
        <Choice
          label="Behind the tiles"
          value={style.backdrop}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'brand', label: 'Brand' },
            { value: 'gradient', label: 'Gradient' },
          ]}
          onChange={(backdrop) => set({ backdrop })}
        />
        <BackgroundPicture broadcastId={broadcastId} scene={scene} update={update} />
      </section>

      <section className="col">
        <h3 className="title-small">Name tags</h3>
        <Switch
          label="Show names on video"
          selected={scene.brand.showNames}
          onChange={(showNames) => update((s) => ({ ...s, brand: { ...s.brand, showNames } }))}
        />
        <Choice
          label="Style"
          value={style.nameStyle}
          options={[
            { value: 'pill', label: 'Pill' },
            { value: 'bar', label: 'Bar' },
            { value: 'text', label: 'Text' },
          ]}
          onChange={(nameStyle) => set({ nameStyle })}
        />
        <Choice
          label="Position"
          value={style.namePosition}
          options={[
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'bottom-center', label: 'Centre' },
            { value: 'top-left', label: 'Top left' },
          ]}
          onChange={(namePosition) => set({ namePosition })}
        />
      </section>

      <div>
        <Button variant="outlined" icon="restart_alt" disabled={!customised} onClick={() => set(DEFAULT_STYLE)} data-testid="style-reset">
          Reset the look
        </Button>
      </div>
    </div>
  );
}
