import { LAYOUT_IDS, LAYOUT_LABELS, type LayoutId, type Scene } from '@studio/shared';
import { Icon, IconButton } from '@studio/ui';
import type { Track } from 'livekit-client';
import { useEffect, useRef, type RefObject } from 'react';
import { initials } from '../lib/format';
import { Compositor, type DrawableSource } from './compositor';
import type { ParticipantView, StudioSource } from './sources';

/** The program output. What is painted here is exactly what goes to the platforms. */
export function ProgramCanvas({
  scene,
  drawables,
  canvasRef,
}: {
  scene: Scene;
  drawables: Map<string, DrawableSource>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const compositor = useRef<Compositor | null>(null);

  useEffect(() => {
    const instance = new Compositor(canvasRef.current!);
    compositor.current = instance;
    instance.start();
    return () => instance.stop();
  }, [canvasRef]);

  useEffect(() => {
    compositor.current?.update(scene, drawables);
  }, [scene, drawables]);

  return <canvas ref={canvasRef} className="program-canvas" data-testid="program-canvas" aria-label="Program output" />;
}

const LAYOUT_ICONS: Record<LayoutId, string> = {
  solo: 'crop_square',
  grid: 'grid_view',
  spotlight: 'view_sidebar',
  pip: 'picture_in_picture',
  screen: 'present_to_all',
  cinema: 'view_agenda',
};

export function LayoutPicker({ value, onChange }: { value: LayoutId; onChange(layout: LayoutId): void }) {
  return (
    <div className="segmented" role="group" aria-label="Layout">
      {LAYOUT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          title={LAYOUT_LABELS[id]}
          aria-label={LAYOUT_LABELS[id]}
          aria-pressed={value === id}
          data-testid={`layout-${id}`}
          onClick={() => onChange(id)}
        >
          <Icon name={LAYOUT_ICONS[id]} />
        </button>
      ))}
    </div>
  );
}

function VideoThumb({ track }: { track: Track }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    return () => void track.detach(el);
  }, [track]);
  return <video ref={ref} muted playsInline />;
}

const KIND_ICON = { cam: 'person', screen: 'present_to_all', clip: 'movie', media: 'image' } as const;

export interface SourceTileProps {
  source: StudioSource;
  participant: ParticipantView | undefined;
  onStage: boolean;
  /** Host only: stage control and moderation. */
  canControl: boolean;
  onToggleStage(): void;
  onPromote(): void;
  onMute(): void;
  onRemove(): void;
}

/** One backstage tile: a live thumbnail plus the host's controls for that source. */
export function SourceTile(props: SourceTileProps) {
  const { source, participant, onStage, canControl } = props;
  const isCam = source.kind === 'cam';
  const isGuestCam = isCam && !source.isLocal;

  return (
    <div
      className={`source-tile ${onStage ? 'on-stage' : ''} ${participant?.speaking && isCam ? 'speaking' : ''}`}
      data-testid={`source-${source.kind}`}
      data-on-stage={onStage}
    >
      <div className="source-thumb">
        {source.video ? (
          <VideoThumb track={source.video} />
        ) : (
          <div className="avatar">{isCam ? initials(source.label) : <Icon name={KIND_ICON[source.kind]} />}</div>
        )}
        {onStage && <span className="chip primary source-badge">On stage</span>}
        {isCam && participant?.micMuted && (
          <span className="source-muted" title="Microphone off">
            <Icon name="mic_off" />
          </span>
        )}
      </div>
      <div className="source-meta">
        <span className="label-large truncate grow" title={source.label}>
          {source.label}
          {source.isLocal && isCam ? ' (you)' : ''}
        </span>
        {canControl && (
          <>
            {onStage && (
              <IconButton icon="keyboard_double_arrow_up" label="Make main" onClick={props.onPromote} />
            )}
            {isGuestCam && !participant?.micMuted && (
              <IconButton icon="mic_off" label={`Mute ${source.label}`} onClick={props.onMute} />
            )}
            {isGuestCam && (
              <IconButton icon="person_remove" label={`Remove ${source.label}`} onClick={props.onRemove} />
            )}
            <IconButton
              icon={onStage ? 'remove_from_queue' : 'add_to_queue'}
              label={onStage ? 'Remove from stage' : 'Add to stage'}
              variant={onStage ? 'tonal' : 'filled'}
              data-testid="toggle-stage"
              onClick={props.onToggleStage}
            />
          </>
        )}
      </div>
    </div>
  );
}
