import {
  PLATFORM_IDS,
  PLATFORMS,
  type BroadcastDto,
  type BroadcastStatus,
  type DestinationDto,
  type PlatformId,
} from '@studio/shared';
import { Button, Checkbox, Dialog, EmptyState, Icon, IconButton, Select, Spinner, TextField } from '@studio/ui';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useLoad, useToast } from '../lib/app-context';
import { formatBytes, formatDateTime, fromLocalInput, initials } from '../lib/format';
import { PlatformBadge } from '../studio/dialogs';
import { LinkButton, Logo, ThemeButton } from './public';

const NAV = [
  { to: '/app', end: true, icon: 'videocam', label: 'Broadcasts' },
  { to: '/app/destinations', end: false, icon: 'cell_tower', label: 'Destinations' },
  { to: '/app/recordings', end: false, icon: 'video_library', label: 'Recordings' },
];

/** Signed-in shell: M3 navigation rail on wide screens, navigation bar on narrow ones. */
export function AppShell() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  if (user === undefined) return <div className="center" style={{ height: '100%' }}><Spinner /></div>;
  if (user === null) return <Navigate to="/login" replace />;

  const signOut = async () => {
    await api.logout();
    setUser(null);
    navigate('/');
  };

  return (
    <div className="shell">
      <header className="shell-bar">
        <Logo />
        <span className="grow" />
        <ThemeButton />
        <span className="avatar" title={`${user.name} · ${user.email}`}>{initials(user.name)}</span>
        <IconButton icon="logout" label="Sign out" onClick={() => void signOut()} />
      </header>
      <nav className="shell-nav" aria-label="Main">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-item">
            <span className="nav-pill"><Icon name={item.icon} /></span>
            <span className="label-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="row wrap page-header">
      <div className="grow">
        <h1 className="headline">{title}</h1>
        <p className="body-large muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

// ---------- Broadcasts ----------

const STATUS_LABEL: Record<BroadcastStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: '' },
  scheduled: { label: 'Scheduled', className: 'primary' },
  live: { label: 'LIVE', className: 'live' },
  ended: { label: 'Ended', className: '' },
};

function NewBroadcastDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const destinations = useLoad(() => api.destinations(), [open]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setWhen('');
      setSelected(new Set());
    }
  }, [open]);

  const create = async () => {
    try {
      const broadcast = await api.createBroadcast({
        title,
        description,
        scheduledAt: fromLocalInput(when),
        destinationIds: [...selected],
      });
      navigate(`/studio/${broadcast.id}`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      headline="New broadcast"
      icon="videocam"
      actions={
        <>
          <Button variant="text" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={!title.trim()} data-testid="create-broadcast-submit">
            Create and open studio
          </Button>
        </>
      }
    >
      <TextField label="Title" value={title} onValue={setTitle} maxLength={120} required autoFocus data-testid="broadcast-title" />
      <TextField label="Description" type="textarea" rows={3} value={description} onValue={setDescription} maxLength={5000} />
      <TextField label="Scheduled start (optional)" type="datetime-local" value={when} onValue={setWhen} />
      <div>
        <h3 className="title-small">Destinations</h3>
        {destinations.data?.length === 0 && (
          <p className="body-medium muted">None yet. You can add them later from the Destinations page.</p>
        )}
        {destinations.data?.map((destination) => (
          <Checkbox
            key={destination.id}
            checked={selected.has(destination.id)}
            onChange={(on) =>
              setSelected((current) => {
                const next = new Set(current);
                if (on) next.add(destination.id);
                else next.delete(destination.id);
                return next;
              })
            }
            label={
              <span className="row">
                <PlatformBadge platform={destination.platform} size={28} />
                <span className="body-large truncate">{destination.label}</span>
              </span>
            }
          />
        ))}
      </div>
    </Dialog>
  );
}

function BroadcastCard({ broadcast, onDelete }: { broadcast: BroadcastDto; onDelete(): void }) {
  const status = STATUS_LABEL[broadcast.status];
  const when = broadcast.scheduledAt ?? broadcast.startedAt ?? broadcast.createdAt;
  return (
    <article className="card outlined col broadcast-card" data-testid="broadcast-card">
      <div className="row">
        <span className={`chip ${status.className}`}>{status.label}</span>
        <span className="grow" />
        <IconButton icon="delete" label="Delete broadcast" disabled={broadcast.status === 'live'} onClick={onDelete} />
      </div>
      <div className="grow">
        <h2 className="title-large truncate">{broadcast.title}</h2>
        <p className="body-medium muted">
          {broadcast.scheduledAt ? 'Starts ' : ''}
          {formatDateTime(when)}
        </p>
      </div>
      <div className="row">
        <div className="row grow" style={{ gap: 4 }}>
          {broadcast.destinations.length === 0 ? (
            <span className="body-medium muted">No destinations</span>
          ) : (
            broadcast.destinations.map((d) => <PlatformBadge key={d.destination.id} platform={d.destination.platform} size={28} />)
          )}
        </div>
        <LinkButton variant="tonal" icon="meeting_room" to={`/studio/${broadcast.id}`}>Open studio</LinkButton>
      </div>
    </article>
  );
}

export function BroadcastsPage() {
  const toast = useToast();
  const broadcasts = useLoad(() => api.broadcasts());
  const [creating, setCreating] = useState(false);

  const remove = async (id: string) => {
    try {
      await api.deleteBroadcast(id);
      broadcasts.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Broadcasts"
        subtitle="Create a broadcast, open its studio, and go live."
        action={<Button icon="add" onClick={() => setCreating(true)} data-testid="new-broadcast">New broadcast</Button>}
      />
      {!broadcasts.data ? (
        <div className="center"><Spinner /></div>
      ) : broadcasts.data.length === 0 ? (
        <EmptyState icon="videocam" title="No broadcasts yet">
          <p className="body-medium">Your first one takes about a minute to set up.</p>
          <Button variant="tonal" icon="add" onClick={() => setCreating(true)}>New broadcast</Button>
        </EmptyState>
      ) : (
        <div className="card-grid">
          {broadcasts.data.map((broadcast) => (
            <BroadcastCard key={broadcast.id} broadcast={broadcast} onDelete={() => void remove(broadcast.id)} />
          ))}
        </div>
      )}
      <NewBroadcastDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

// ---------- Destinations ----------

function AddDestinationDialog({ open, onClose, onAdded }: { open: boolean; onClose(): void; onAdded(): void }) {
  const toast = useToast();
  const [platform, setPlatform] = useState<PlatformId>('youtube');
  const [label, setLabel] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState(PLATFORMS.youtube.defaultRtmpUrl);
  const [streamKey, setStreamKey] = useState('');
  const [channel, setChannel] = useState('');
  const info = PLATFORMS[platform];

  useEffect(() => {
    if (open) {
      setLabel('');
      setStreamKey('');
      setChannel('');
    }
  }, [open]);

  const choose = (next: PlatformId) => {
    setPlatform(next);
    setRtmpUrl(PLATFORMS[next].defaultRtmpUrl);
  };

  const save = async () => {
    try {
      await api.createDestination({
        platform,
        label: label.trim() || info.name,
        rtmpUrl,
        streamKey,
        channel: platform === 'twitch' ? channel : undefined,
      });
      onAdded();
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      headline="Add a destination"
      icon="cell_tower"
      actions={
        <>
          <Button variant="text" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!rtmpUrl.trim()} data-testid="destination-save">Add destination</Button>
        </>
      }
    >
      <Select
        label="Platform"
        value={platform}
        onValue={choose}
        options={PLATFORM_IDS.map((id) => ({ value: id, label: PLATFORMS[id].name }))}
        data-testid="destination-platform"
      />
      <p className="body-medium muted">
        <Icon name="info" style={{ '--md-icon-size': '16px', verticalAlign: 'text-bottom' } as React.CSSProperties} /> {info.keyHelp}
      </p>
      <TextField label="Name" value={label} onValue={setLabel} placeholder={info.name} maxLength={80} data-testid="destination-label" />
      <TextField label="RTMP server URL" type="url" value={rtmpUrl} onValue={setRtmpUrl} required mono placeholder="rtmp://…" data-testid="destination-url" />
      <TextField label="Stream key" type="password" value={streamKey} onValue={setStreamKey} mono supportingText="Stored encrypted. It is never shown again or sent to a browser." data-testid="destination-key" />
      {platform === 'twitch' && (
        <TextField label="Channel name (optional)" value={channel} onValue={setChannel} supportingText="Lets the studio show your Twitch chat." maxLength={80} />
      )}
    </Dialog>
  );
}

const ONE_CLICK = ['youtube', 'twitch', 'facebook'] as const;

export function DestinationsPage() {
  const toast = useToast();
  const { config } = useAuth();
  const [params, setParams] = useSearchParams();
  const destinations = useLoad(() => api.destinations());
  const [adding, setAdding] = useState(false);

  // Result of a one-click connect redirect.
  useEffect(() => {
    const connected = params.get('connected') as PlatformId | null;
    if (connected && PLATFORMS[connected]) toast.show(`${PLATFORMS[connected].name} connected`);
    else if (params.get('error')) toast.show('The connection did not complete. Try again.');
    if (connected || params.get('error')) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  const remove = async (destination: DestinationDto) => {
    try {
      await api.deleteDestination(destination.id);
      destinations.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const oneClick = ONE_CLICK.filter((id) => config?.oauth[id]);

  return (
    <>
      <PageHeader
        title="Destinations"
        subtitle="The channels and pages you stream to."
        action={<Button icon="add" onClick={() => setAdding(true)} data-testid="add-destination">Add with stream key</Button>}
      />
      {oneClick.length > 0 && (
        <div className="row wrap" style={{ marginBottom: 24 }}>
          {oneClick.map((id) => (
            <Button key={id} variant="outlined" href={`/api/oauth/${id}/start`} icon="link">
              Connect {PLATFORMS[id].name}
            </Button>
          ))}
        </div>
      )}
      {!destinations.data ? (
        <div className="center"><Spinner /></div>
      ) : destinations.data.length === 0 ? (
        <EmptyState icon="cell_tower" title="No destinations yet">
          <p className="body-medium">Add a platform with its RTMP URL and stream key.</p>
        </EmptyState>
      ) : (
        <div className="card outlined" style={{ padding: 8 }}>
          {destinations.data.map((destination) => (
            <div key={destination.id} className="list-item" data-testid="destination-row">
              <PlatformBadge platform={destination.platform} size={40} />
              <div className="grow">
                <div className="body-large truncate">{destination.label}</div>
                <div className="body-medium muted truncate">
                  {PLATFORMS[destination.platform].name} ·{' '}
                  {destination.kind === 'oauth' ? 'Connected account' : (destination.rtmpHost ?? 'Stream key')}
                </div>
              </div>
              <IconButton icon="delete" label={`Remove ${destination.label}`} onClick={() => void remove(destination)} />
            </div>
          ))}
        </div>
      )}
      <AddDestinationDialog open={adding} onClose={() => setAdding(false)} onAdded={destinations.reload} />
    </>
  );
}

// ---------- Recordings ----------

export function RecordingsPage() {
  const toast = useToast();
  const recordings = useLoad(() => api.recordings());
  const navigate = useNavigate();

  const copyLink = async (shareToken: string) => {
    await navigator.clipboard.writeText(`${location.origin}/watch/${shareToken}`);
    toast.show('Share link copied');
  };
  const remove = async (id: string) => {
    try {
      await api.deleteRecording(id);
      recordings.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader title="Recordings" subtitle="Every stream is recorded. Watch, download or share a link." />
      {!recordings.data ? (
        <div className="center"><Spinner /></div>
      ) : recordings.data.length === 0 ? (
        <EmptyState icon="video_library" title="No recordings yet">
          <p className="body-medium">A recording appears here after each stream ends.</p>
        </EmptyState>
      ) : (
        <div className="card outlined" style={{ padding: 8 }}>
          {recordings.data.map((recording) => (
            <div key={recording.id} className="list-item" data-testid="recording-row">
              <span className="avatar"><Icon name="movie" /></span>
              <div className="grow">
                <div className="body-large truncate">{recording.broadcastTitle}</div>
                <div className="body-medium muted">
                  {formatDateTime(recording.createdAt)} · {formatBytes(recording.sizeBytes)}
                </div>
              </div>
              <IconButton icon="play_circle" label="Watch" onClick={() => navigate(`/watch/${recording.shareToken}`)} />
              <IconButton icon="share" label="Copy share link" onClick={() => void copyLink(recording.shareToken)} />
              <IconButton icon="delete" label="Delete recording" onClick={() => void remove(recording.id)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
