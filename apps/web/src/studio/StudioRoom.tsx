import {
  addToStage,
  promoteOnStage,
  removeFromStage,
  sourceId,
  type BroadcastDto,
  type DestinationStatus,
  type StudioSession,
} from '@studio/shared';
import { Button, Icon, IconButton, Spinner, Tabs } from '@studio/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useLoad, useToast } from '../lib/app-context';
import { formatDuration } from '../lib/format';
import { DestinationsDialog, InviteDialog, PlatformBadge, SettingsDialog } from './dialogs';
import { shareVideoClip, useAutoDirector, useComments, useElapsed, useSceneController } from './hooks';
import { BannersPanel, BrandPanel, ChatPanel, CommentsPanel, ScenesPanel } from './panels';
import { LayoutPicker, ProgramCanvas, SourceTile } from './stage';
import { useLiveControl } from './useLiveControl';
import { useDrawableSources, useStudioRoom, type JoinOptions } from './useStudioRoom';

type PanelId = 'scenes' | 'comments' | 'banners' | 'brand' | 'chat';

const HOST_TABS: { id: PanelId; label: string; icon: string }[] = [
  { id: 'scenes', label: 'Scenes', icon: 'dashboard_customize' },
  { id: 'comments', label: 'Comments', icon: 'forum' },
  { id: 'banners', label: 'Banners', icon: 'call_to_action' },
  { id: 'brand', label: 'Brand', icon: 'palette' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
];

const STATUS_CHIP: Record<DestinationStatus, { className: string; label: string }> = {
  idle: { className: '', label: 'Ready' },
  connecting: { className: 'primary', label: 'Connecting' },
  live: { className: 'success', label: 'Live' },
  failed: { className: 'error', label: 'Failed' },
  ended: { className: '', label: 'Ended' },
};

interface Props {
  session: StudioSession;
  join: JoinOptions;
  /** Where "leave" goes: the dashboard for the host, a goodbye screen for a guest. */
  onExit(): void;
}

/** The studio itself, shared by host and guests. Guests get the same picture without the controls. */
export function StudioRoom({ session, join, onExit }: Props) {
  const isHost = session.role === 'host';
  const broadcastId = session.broadcast.id;
  const toast = useToast();
  const { config } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const studio = useStudioRoom(session, join);
  const { room, view } = studio;
  const [hostScene, updateScene] = useSceneController(broadcastId, session.scene);
  const scene = isHost ? hostScene : studio.remoteScene;
  const drawables = useDrawableSources(view.sources);

  const broadcast = useLoad<BroadcastDto | undefined>(
    () => (isHost ? api.broadcast(broadcastId) : Promise.resolve(undefined)),
    [broadcastId, isHost],
  );
  const live = useLiveControl({
    broadcastId,
    canvas: canvasRef,
    scene,
    sources: view.sources,
    egress: studio.egress,
    initiallyLive: session.broadcast.status === 'live' && config?.egressMode === 'livekit',
    onChanged: broadcast.reload,
  });
  const comments = useComments(broadcast.data, live.phase === 'live');
  const elapsed = useElapsed(live.startedAt);

  const [panel, setPanel] = useState<PanelId>(isHost ? 'scenes' : 'chat');
  const [dialog, setDialog] = useState<'invite' | 'destinations' | 'settings' | null>(null);
  const stopClip = useRef<(() => void) | null>(null);

  const me = view.participants.find((p) => p.isLocal);
  const myScreen = view.sources.find((s) => s.isLocal && s.kind === 'screen');
  const myClip = view.sources.find((s) => s.isLocal && s.kind === 'clip');

  // The host starts on stage, so a new studio is never an empty frame.
  const seeded = useRef(false);
  useEffect(() => {
    if (!isHost || seeded.current || studio.status !== 'connected') return;
    seeded.current = true;
    if (hostScene.stage.length === 0) updateScene((s) => addToStage(s, sourceId('cam', session.identity)));
  }, [isHost, studio.status, hostScene.stage.length, session.identity, updateScene]);

  useAutoDirector(hostScene, updateScene, view.sources, isHost && studio.status === 'connected');

  // Take sources off the stage once they are gone (guest left, screen share stopped). The delay
  // rides out the moment after connecting when remote tracks are not listed yet.
  const sourceIds = useMemo(() => new Set(view.sources.map((s) => s.id)), [view.sources]);
  useEffect(() => {
    if (!isHost || studio.status !== 'connected') return;
    const gone = hostScene.stage.filter((id) => id !== 'media' && !sourceIds.has(id));
    if (gone.length === 0) return;
    const timer = setTimeout(() => {
      updateScene((s) => ({ ...s, stage: s.stage.filter((id) => !gone.includes(id)) }));
    }, 2500);
    return () => clearTimeout(timer);
  }, [isHost, studio.status, hostScene.stage, sourceIds, updateScene]);

  // Live per-destination status: the worker's reports override what was loaded from the API.
  const destinations = useMemo(() => {
    const reported = new Map(studio.egress?.targets.map((t) => [t.destinationId, t]));
    return (broadcast.data?.destinations ?? []).map((d) => {
      const update = live.phase === 'live' ? reported.get(d.destination.id) : undefined;
      return update ? { ...d, status: update.status, error: update.error } : d;
    });
  }, [broadcast.data, studio.egress, live.phase]);

  const toggle = useCallback(
    async (device: 'mic' | 'camera' | 'screen') => {
      if (!room || !me) return;
      const local = room.localParticipant;
      try {
        if (device === 'mic') await local.setMicrophoneEnabled(me.micMuted);
        else if (device === 'camera') await local.setCameraEnabled(me.cameraOff);
        else await local.setScreenShareEnabled(!myScreen, { audio: true });
      } catch (err) {
        // Dismissing the browser's screen picker is not an error worth reporting.
        if ((err as Error).name !== 'NotAllowedError' || device !== 'screen') toast.error(err);
      }
    },
    [room, me, myScreen, toast],
  );

  // A new screen share or clip goes straight on stage: that is why the host started it.
  const autoStaged = useRef(new Set<string>());
  useEffect(() => {
    if (!isHost) return;
    for (const source of [myScreen, myClip]) {
      if (source && !autoStaged.current.has(source.id)) {
        autoStaged.current.add(source.id);
        updateScene((s) => addToStage(s, source.id));
      }
    }
    for (const id of autoStaged.current) if (!sourceIds.has(id)) autoStaged.current.delete(id);
  }, [isHost, myScreen, myClip, sourceIds, updateScene]);

  const shareImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { url } = await api.uploadAsset(broadcastId, file);
      updateScene((s) => addToStage({ ...s, media: { url } }, 'media'));
    } catch (err) {
      toast.error(err);
    }
  };

  const shareClip = async (file: File | undefined) => {
    if (!file || !room) return;
    stopClip.current?.();
    try {
      stopClip.current = await shareVideoClip(room, file, () => (stopClip.current = null));
    } catch (err) {
      toast.error(err);
    }
  };
  useEffect(() => () => stopClip.current?.(), []);

  const leave = async () => {
    if (live.phase === 'live') await live.end();
    await room?.disconnect();
    onExit();
  };

  if (studio.status === 'ended') {
    return (
      <main className="center" style={{ height: '100%' }}>
        <div className="col center" style={{ textAlign: 'center', padding: 24 }}>
          <Icon name="waving_hand" style={{ '--md-icon-size': '48px' } as React.CSSProperties} />
          <h1 className="headline">{studio.endReason}</h1>
          <Button variant="tonal" onClick={onExit}>{isHost ? 'Back to dashboard' : 'Close'}</Button>
        </div>
      </main>
    );
  }

  const isLive = live.phase === 'live';
  const stageHasMedia = scene.stage.includes('media');
  const templateOwnsLayout =
    scene.template === 'newsroom' || (scene.template === 'cricket' && scene.cricket.view === 'dashboard');

  return (
    <div className="studio" data-testid="studio" data-status={studio.status}>
      <header className="studio-top">
        {isHost && (
          <Link to="/app" aria-label="Back to dashboard" className="studio-back">
            <Icon name="arrow_back" />
          </Link>
        )}
        <div className="grow">
          <h1 className="title-medium truncate">{session.broadcast.title}</h1>
          <span className="body-small muted">
            {view.participants.length} in studio · {scene.stage.length} on stage
          </span>
        </div>
        {isLive && (
          <span className="chip live" data-testid="live-chip">
            LIVE {formatDuration(elapsed)}
          </span>
        )}
        {isHost && (
          <>
            <button type="button" className="destination-stack" onClick={() => setDialog('destinations')} disabled={isLive} data-testid="open-destinations" title="Destinations">
              {destinations.length === 0 ? (
                <span className="chip"><Icon name="add" /> Add destination</span>
              ) : (
                destinations.map((d) => (
                  <span key={d.destination.id} className={`destination-dot ${d.status}`} title={`${d.destination.label}: ${d.error ?? STATUS_CHIP[d.status].label}`} data-testid="destination-status" data-status={d.status}>
                    <PlatformBadge platform={d.destination.platform} size={28} />
                  </span>
                ))
              )}
            </button>
            <Button variant="tonal" icon="person_add" onClick={() => setDialog('invite')} data-testid="invite">
              Invite
            </Button>
            {isLive || live.phase === 'ending' ? (
              <Button danger icon="stop_circle" onClick={() => void live.end()} disabled={live.phase === 'ending'} data-testid="end-stream">
                End stream
              </Button>
            ) : (
              <Button icon="sensors" onClick={() => void live.goLive()} disabled={live.phase !== 'idle' || studio.status !== 'connected'} data-testid="go-live">
                {live.phase === 'starting' ? 'Starting…' : 'Go live'}
              </Button>
            )}
          </>
        )}
      </header>

      <div className="studio-body">
        <section className="studio-main">
          <div className="stage-frame">
            <ProgramCanvas scene={scene} drawables={drawables} canvasRef={canvasRef} />
            {studio.status === 'connecting' && (
              <div className="stage-overlay center"><Spinner /></div>
            )}
            {studio.status === 'connected' && scene.stage.length === 0 && (
              <div className="stage-overlay center muted col">
                <Icon name="add_to_queue" style={{ '--md-icon-size': '40px' } as React.CSSProperties} />
                <span className="body-large">{isHost ? 'Add someone to the stage to begin' : 'Waiting for the host'}</span>
              </div>
            )}
          </div>

          {isHost && (
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              {templateOwnsLayout ? (
                <span className="chip">
                  <Icon name="dashboard_customize" /> Layout is set by the {scene.template === 'newsroom' ? 'news scene' : 'match dashboard'}
                </span>
              ) : (
                <LayoutPicker value={scene.layout} onChange={(layout) => updateScene((s) => ({ ...s, layout }))} />
              )}
              {isLive && destinations.some((d) => d.status === 'failed') && (
                <span className="chip error"><Icon name="error" /> A destination dropped</span>
              )}
            </div>
          )}

          <div className="backstage" aria-label="Backstage">
            {view.sources.map((source) => {
              const onStage = scene.stage.includes(source.id);
              const participant = view.participants.find((p) => p.identity === source.identity);
              return (
                <SourceTile
                  key={source.id}
                  source={source}
                  participant={participant}
                  onStage={onStage}
                  canControl={isHost}
                  onToggleStage={() => updateScene((s) => (onStage ? removeFromStage(s, source.id) : addToStage(s, source.id)))}
                  onPromote={() => updateScene((s) => promoteOnStage(s, source.id))}
                  onMute={() => participant?.micSid && void api.muteParticipant(broadcastId, source.identity, participant.micSid).catch((err) => toast.error(err))}
                  onRemove={() => void api.removeParticipant(broadcastId, source.identity).catch((err) => toast.error(err))}
                />
              );
            })}
            {isHost && scene.media && (
              <div className={`source-tile ${stageHasMedia ? 'on-stage' : ''}`}>
                <div className="source-thumb">
                  <img src={scene.media.url} alt="Shared image" />
                  {stageHasMedia && <span className="chip primary source-badge">On stage</span>}
                </div>
                <div className="source-meta">
                  <span className="label-large grow">Shared image</span>
                  <IconButton icon="delete" label="Remove image" onClick={() => updateScene((s) => ({ ...removeFromStage(s, 'media'), media: null }))} />
                  <IconButton
                    icon={stageHasMedia ? 'remove_from_queue' : 'add_to_queue'}
                    label={stageHasMedia ? 'Remove from stage' : 'Add to stage'}
                    variant={stageHasMedia ? 'tonal' : 'filled'}
                    onClick={() => updateScene((s) => (stageHasMedia ? removeFromStage(s, 'media') : addToStage(s, 'media')))}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="control-bar" role="toolbar" aria-label="Your controls">
            <IconButton icon={me?.micMuted ? 'mic_off' : 'mic'} label={me?.micMuted ? 'Turn microphone on' : 'Turn microphone off'} variant={me?.micMuted ? 'filled' : 'tonal'} onClick={() => void toggle('mic')} data-testid="toggle-mic" />
            <IconButton icon={me?.cameraOff ? 'videocam_off' : 'videocam'} label={me?.cameraOff ? 'Turn camera on' : 'Turn camera off'} variant={me?.cameraOff ? 'filled' : 'tonal'} onClick={() => void toggle('camera')} data-testid="toggle-camera" />
            <IconButton icon={myScreen ? 'cancel_presentation' : 'present_to_all'} label={myScreen ? 'Stop sharing screen' : 'Share screen'} variant={myScreen ? 'filled' : 'tonal'} onClick={() => void toggle('screen')} data-testid="toggle-screen" />
            {isHost && (
              <>
                <label className="icon-file" title="Share an image">
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { void shareImage(e.target.files?.[0]); e.target.value = ''; }} data-testid="share-image" />
                  <Icon name="image" />
                </label>
                {myClip ? (
                  <IconButton icon="stop" label="Stop video clip" variant="filled" onClick={() => { stopClip.current?.(); stopClip.current = null; }} />
                ) : (
                  <label className="icon-file" title="Play a video clip">
                    <input type="file" accept="video/mp4,video/webm" onChange={(e) => { void shareClip(e.target.files?.[0]); e.target.value = ''; }} />
                    <Icon name="movie" />
                  </label>
                )}
              </>
            )}
            <IconButton icon="settings" label="Camera and microphone settings" variant="tonal" onClick={() => setDialog('settings')} />
            <span className="control-divider" />
            <Button variant="text" danger icon="logout" onClick={() => void leave()} data-testid="leave">
              Leave
            </Button>
          </div>
        </section>

        <aside className="studio-side">
          {isHost ? <Tabs<PanelId> tabs={HOST_TABS} active={panel} onChange={setPanel} /> : <div className="title-medium" style={{ padding: 16 }}>Studio chat</div>}
          <div className="studio-panel">
            {panel === 'scenes' && <ScenesPanel scene={scene} update={updateScene} />}
            {panel === 'comments' && <CommentsPanel comments={comments} scene={scene} update={updateScene} />}
            {panel === 'banners' && <BannersPanel scene={scene} update={updateScene} />}
            {panel === 'brand' && <BrandPanel broadcastId={broadcastId} scene={scene} update={updateScene} />}
            {panel === 'chat' && <ChatPanel chat={studio.chat} onSend={studio.sendChat} />}
          </div>
        </aside>
      </div>

      {isHost && (
        <>
          <InviteDialog broadcastId={broadcastId} open={dialog === 'invite'} onClose={() => setDialog(null)} />
          {broadcast.data && (
            <DestinationsDialog broadcast={broadcast.data} open={dialog === 'destinations'} onClose={() => setDialog(null)} onSaved={broadcast.setData} />
          )}
        </>
      )}
      {room && <SettingsDialog room={room} open={dialog === 'settings'} onClose={() => setDialog(null)} />}
    </div>
  );
}
