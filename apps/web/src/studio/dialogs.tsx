import { PLATFORMS, type BroadcastDto, type DestinationDto, type InviteDto } from '@studio/shared';
import { Button, Checkbox, Dialog, EmptyState, IconButton, Select, Spinner, TextField } from '@studio/ui';
import { Room } from 'livekit-client';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad, useToast } from '../lib/app-context';

export function PlatformBadge({ platform, size = 32 }: { platform: DestinationDto['platform']; size?: number }) {
  const info = PLATFORMS[platform];
  return (
    <span
      className="platform-badge"
      style={{ background: info.color, width: size, height: size, fontSize: size * 0.42 }}
      title={info.name}
      aria-label={info.name}
    >
      {info.name === 'X' ? '𝕏' : info.name[0]}
    </span>
  );
}

// ---------- Invite a guest ----------

export function InviteDialog({ broadcastId, open, onClose }: { broadcastId: string; open: boolean; onClose(): void }) {
  const toast = useToast();
  const [invite, setInvite] = useState<InviteDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setInvite(null);
    api.createInvite(broadcastId).then(setInvite, (err) => toast.error(err));
  }, [open, broadcastId, toast]);

  const copy = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.url);
    toast.show('Invite link copied');
  };
  const share = () => invite && navigator.share?.({ title: 'Join my live stream', url: invite.url }).catch(() => undefined);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      headline="Invite a guest"
      icon="person_add"
      actions={<Button variant="text" onClick={onClose}>Done</Button>}
    >
      <p className="body-medium muted">
        Anyone with this link can join the studio from their browser, with no account. They wait
        backstage until you add them to the stage. The link works for 7 days.
      </p>
      {invite ? (
        <div className="row">
          <TextField label="Invite link" value={invite.url} onValue={() => undefined} mono data-testid="invite-url" />
          <IconButton icon="content_copy" label="Copy link" variant="tonal" onClick={() => void copy()} />
          {'share' in navigator && <IconButton icon="share" label="Share" onClick={share} />}
        </div>
      ) : (
        <div className="center"><Spinner /></div>
      )}
    </Dialog>
  );
}

// ---------- Choose where this broadcast goes ----------

export function DestinationsDialog({
  broadcast,
  open,
  onClose,
  onSaved,
}: {
  broadcast: BroadcastDto;
  open: boolean;
  onClose(): void;
  onSaved(next: BroadcastDto): void;
}) {
  const toast = useToast();
  const all = useLoad(() => api.destinations(), [open]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(broadcast.destinations.map((d) => d.destination.id)));
  }, [open, broadcast]);

  const save = async () => {
    try {
      onSaved(await api.updateBroadcast(broadcast.id, { destinationIds: [...selected] }));
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      headline="Destinations"
      icon="cell_tower"
      actions={
        <>
          <Button variant="text" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} data-testid="destinations-save">Save</Button>
        </>
      }
    >
      {!all.data ? (
        <div className="center"><Spinner /></div>
      ) : all.data.length === 0 ? (
        <EmptyState icon="cell_tower" title="No destinations yet">
          <Link to="/app/destinations">Add your first destination</Link>
        </EmptyState>
      ) : (
        <div className="col" style={{ gap: 0 }}>
          {all.data.map((destination) => (
            <Checkbox
              key={destination.id}
              checked={selected.has(destination.id)}
              onChange={(on) => toggle(destination.id, on)}
              label={
                <span className="row">
                  <PlatformBadge platform={destination.platform} size={28} />
                  <span className="body-large truncate">{destination.label}</span>
                </span>
              }
            />
          ))}
        </div>
      )}
    </Dialog>
  );
}

// ---------- Camera and microphone ----------

export function useDevices(kind: MediaDeviceKind, refreshKey: unknown): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => Room.getLocalDevices(kind, false).then((list) => live && setDevices(list), () => undefined);
    void load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener('devicechange', load);
    };
  }, [kind, refreshKey]);
  return devices;
}

export function DeviceSelect({
  kind,
  label,
  value,
  onValue,
  refreshKey,
}: {
  kind: MediaDeviceKind;
  label: string;
  value: string;
  onValue(id: string): void;
  refreshKey?: unknown;
}) {
  const devices = useDevices(kind, refreshKey);
  if (devices.length === 0) return <p className="body-medium muted">{label}: none found</p>;
  const current = devices.some((d) => d.deviceId === value) ? value : devices[0]!.deviceId;
  return (
    <Select
      label={label}
      value={current}
      onValue={onValue}
      options={devices.map((d, i) => ({ value: d.deviceId, label: d.label || `${label} ${i + 1}` }))}
    />
  );
}

export function SettingsDialog({ room, open, onClose }: { room: Room; open: boolean; onClose(): void }) {
  const toast = useToast();
  const switchTo = (kind: MediaDeviceKind) => (id: string) =>
    void room.switchActiveDevice(kind, id).catch((err) => toast.error(err));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      headline="Camera and microphone"
      icon="settings"
      actions={<Button variant="text" onClick={onClose}>Done</Button>}
    >
      <DeviceSelect kind="videoinput" label="Camera" value={room.getActiveDevice('videoinput') ?? ''} onValue={switchTo('videoinput')} refreshKey={open} />
      <DeviceSelect kind="audioinput" label="Microphone" value={room.getActiveDevice('audioinput') ?? ''} onValue={switchTo('audioinput')} refreshKey={open} />
      <DeviceSelect kind="audiooutput" label="Speakers" value={room.getActiveDevice('audiooutput') ?? ''} onValue={switchTo('audiooutput')} refreshKey={open} />
    </Dialog>
  );
}
