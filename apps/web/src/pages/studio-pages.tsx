import { DEFAULT_SCENE, normalizeScene, type Scene, type StudioSession } from '@studio/shared';
import { Icon, Spinner } from '@studio/ui';
import { Room, RoomEvent, type RemoteTrack } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useLoad, useToast } from '../lib/app-context';
import { GreenRoom } from '../studio/GreenRoom';
import { programAudio, readRoom } from '../studio/sources';
import { ProgramCanvas } from '../studio/stage';
import { LinkButton } from './public';
import { StudioRoom } from '../studio/StudioRoom';
import { useDrawableSources, type JoinOptions } from '../studio/useStudioRoom';

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="center" style={{ height: '100%', padding: 24, textAlign: 'center' }}>{children}</main>;
}

/** /studio/:id, the host's studio. */
export function HostStudioPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const session = useLoad(() => api.hostSession(id), [id]);
  const [join, setJoin] = useState<JoinOptions | null>(null);

  if (user === null) return <Navigate to="/login" replace />;
  if (session.error) {
    return (
      <Centered>
        <div className="col center">
          <p className="title-large">{session.error}</p>
          <LinkButton variant="tonal" to="/app">Back to dashboard</LinkButton>
        </div>
      </Centered>
    );
  }
  if (!session.data) return <Centered><Spinner /></Centered>;
  if (!join) return <GreenRoom title={session.data.broadcast.title} askName={false} busy={false} onJoin={setJoin} />;
  return <StudioRoom session={session.data} join={join} onExit={() => navigate('/app')} />;
}

/** /join/:token, where a guest lands from an invite link. */
export function GuestJoinPage() {
  const { token = '' } = useParams();
  const toast = useToast();
  const invite = useLoad(() => api.invite(token), [token]);
  const [joined, setJoined] = useState<{ session: StudioSession; join: JoinOptions } | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(false);

  if (left) {
    return (
      <Centered>
        <div className="col center">
          <Icon name="waving_hand" style={{ '--md-icon-size': '48px' } as React.CSSProperties} />
          <h1 className="headline">Thanks for joining</h1>
          <p className="body-large muted">You can close this tab.</p>
        </div>
      </Centered>
    );
  }
  if (invite.error) {
    return (
      <Centered>
        <div className="col center">
          <Icon name="link_off" style={{ '--md-icon-size': '48px' } as React.CSSProperties} />
          <h1 className="headline">This invite link is not valid</h1>
          <p className="body-large muted">It may have expired. Ask the host for a new one.</p>
        </div>
      </Centered>
    );
  }
  if (!invite.data) return <Centered><Spinner /></Centered>;
  if (joined) return <StudioRoom session={joined.session} join={joined.join} onExit={() => setLeft(true)} />;

  const enter = async (join: JoinOptions, name: string) => {
    setBusy(true);
    try {
      setJoined({ session: await api.joinInvite(token, name), join });
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };
  return <GreenRoom title={invite.data.title} askName busy={busy} onJoin={(join, name) => void enter(join, name)} />;
}

/**
 * /render: the page LiveKit Egress opens in headless Chrome (production egress mode).
 * Egress passes `url` and `token` for a hidden participant; the page shows only the program,
 * plays the on-stage audio, and prints START_RECORDING / END_RECORDING, which Egress waits for.
 */
export function RenderPage() {
  const [params] = useSearchParams();
  const url = params.get('url');
  const token = params.get('token');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [scene, setScene] = useState<Scene>(DEFAULT_SCENE);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url || !token) return;
    const next = new Room({ adaptiveStream: false });
    const readScene = (metadata: string | undefined) => {
      try {
        setScene((current) => normalizeScene(JSON.parse(metadata || 'null'), current));
      } catch {
        // Keep the previous scene.
      }
    };
    const bump = () => setVersion((n) => n + 1);
    next
      .on(RoomEvent.RoomMetadataChanged, readScene)
      .on(RoomEvent.Disconnected, () => console.log('END_RECORDING'))
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        bump();
      })
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.ParticipantDisconnected, bump);

    void next.connect(url, token).then(() => {
      readScene(next.metadata);
      setRoom(next);
      console.log('START_RECORDING');
    });
    return () => void next.disconnect();
  }, [url, token]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => (room ? readRoom(room) : { participants: [], sources: [] }), [room, version]);
  const drawables = useDrawableSources(view.sources);

  // Only what is on stage is audible to viewers.
  const playing = useRef(new Map<MediaStreamTrack, HTMLAudioElement>());
  useEffect(() => {
    const wanted = new Set(programAudio(view.sources, { stage: scene.stage, screen: scene.screen }));
    for (const [track, el] of playing.current) {
      if (wanted.has(track)) continue;
      el.remove();
      playing.current.delete(track);
    }
    for (const track of wanted) {
      if (playing.current.has(track)) continue;
      const el = new Audio();
      el.srcObject = new MediaStream([track]);
      el.autoplay = true;
      document.body.append(el);
      playing.current.set(track, el);
    }
  }, [scene.stage, scene.screen, view.sources]);

  if (!url || !token) return <Centered>This page is opened by the streaming server.</Centered>;
  return (
    <div className="render-page">
      <ProgramCanvas scene={scene} drawables={drawables} canvasRef={canvasRef} />
    </div>
  );
}
