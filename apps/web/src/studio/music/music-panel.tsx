import { addMusicTrack, MAX_MUSIC_TRACKS, removeMusicTrack, type Scene } from '@studio/shared';
import { Icon, IconButton, Slider, Switch } from '@studio/ui';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/app-context';
import { readMusicPrefs, type MusicPlayer, type MusicState, type TrackData } from './player';
import { BUILT_IN_TRACKS, renderTrack, type TrackKind } from './synth';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = 'audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a';

interface Props {
  broadcastId: string;
  scene: Scene;
  update: SceneUpdater;
  /** Null until the host first plays something: the browser only starts audio after a click. */
  player: MusicPlayer | null;
  ensurePlayer(): MusicPlayer;
}

/** The player's state, or the saved volume and switch while there is no player yet. */
function useMusicState(player: MusicPlayer | null): MusicState {
  const [state, setState] = useState<MusicState>(() => player?.current ?? { bed: null, sting: null, loading: null, error: null, ...readMusicPrefs() });
  useEffect(() => {
    if (!player) return;
    setState(player.current);
    return player.subscribe(setState);
  }, [player]);
  return state;
}

/** Music for the stream: built-in stings and beds, and the host's own tracks. */
export function MusicPanel({ broadcastId, scene, update, player, ensurePlayer }: Props) {
  const toast = useToast();
  const state = useMusicState(player);
  const [uploading, setUploading] = useState(false);
  const playingId = (id: string) => state.bed === id || state.sting === id;

  const toggle = (id: string, kind: TrackKind, load: (p: MusicPlayer) => Promise<TrackData> | TrackData) => {
    const p = ensurePlayer();
    if (p.current.bed === id || p.current.sting === id) p.stop(id);
    else void p.play(id, kind, () => load(p));
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return toast.show('A track can be up to 20 MB.');
    if (scene.music.length >= MAX_MUSIC_TRACKS) return toast.show(`A broadcast can hold ${MAX_MUSIC_TRACKS} tracks. Remove one first.`);
    setUploading(true);
    try {
      const { url } = await api.uploadAsset(broadcastId, file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Track';
      update((s) => addMusicTrack(s, { id: crypto.randomUUID().slice(0, 8), name, url }));
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  const chip = (id: string, name: string, kind: TrackKind, load: (p: MusicPlayer) => Promise<TrackData> | TrackData) => (
    <button
      key={id}
      type="button"
      className="timer-chip music-chip"
      aria-pressed={playingId(id)}
      data-testid={`music-${id}`}
      title={kind === 'bed' ? `${name}: loops until you stop it` : `${name}: plays once`}
      onClick={() => toggle(id, kind, load)}
    >
      <Icon name={playingId(id) ? 'stop' : state.loading === id ? 'hourglass_top' : kind === 'bed' ? 'repeat' : 'play_arrow'} />
      {name}
    </button>
  );
  const builtIn = (kind: TrackKind) =>
    BUILT_IN_TRACKS.filter((t) => t.kind === kind).map((t) => chip(t.id, t.name, kind, (p) => renderTrack(t.id, p.sampleRate)));

  return (
    <section className="col" data-testid="music-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="title-small">Music</h3>
        {(state.bed || state.sting) && (
          <button type="button" className="timer-chip" data-testid="music-fade" onClick={() => player?.fadeOut()}>
            Fade out
          </button>
        )}
      </div>

      <span className="label-medium muted">Stings (play once)</span>
      <div className="timer-row">{builtIn('sting')}</div>
      <span className="label-medium muted">Beds (loop)</span>
      <div className="timer-row">{builtIn('bed')}</div>

      <span className="label-medium muted">Your tracks</span>
      {scene.music.map((track) => (
        <div key={track.id} className={`banner-item ${playingId(track.id) ? 'shown' : ''}`}>
          <button
            type="button"
            className="banner-toggle"
            aria-pressed={playingId(track.id)}
            data-testid="music-upload-track"
            onClick={() => toggle(track.id, 'bed', async (p) => p.decode(await (await fetch(track.url)).arrayBuffer()))}
          >
            <Icon name={playingId(track.id) ? 'stop' : 'play_arrow'} />
            <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
              <span className="body-medium truncate">{track.name}</span>
              {state.error?.id === track.id && (
                <span className="body-small" style={{ color: 'var(--md-sys-color-error)' }}>{state.error.message}</span>
              )}
            </span>
            {playingId(track.id) && <span className="chip primary">Playing</span>}
          </button>
          <IconButton
            icon="delete"
            label="Remove track"
            onClick={() => {
              player?.forget(track.id);
              update((s) => removeMusicTrack(s, track.id));
            }}
          />
        </div>
      ))}
      <label className="file-button timer-chip music-chip" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center' }}>
        <input type="file" accept={AUDIO_TYPES} disabled={uploading} data-testid="music-upload" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <Icon name="upload" />
        {uploading ? 'Uploading…' : 'Upload a track'}
      </label>

      <Slider label="Music volume" value={Math.round(state.volume * 100)} onValue={(v) => ensurePlayer().setVolume(v / 100)} min={0} max={100} format={(v) => `${v}%`} data-testid="music-volume" />
      <Switch label="Lower while someone speaks" selected={state.duck} onChange={(duck) => ensurePlayer().setDuck(duck)} data-testid="music-duck" />
      <p className="body-small muted">
        Music goes out on the stream and the recording, and keeps playing on the Starting soon and
        Be right back screens. Guests in the studio do not hear it. Only upload music you have the
        right to use.
      </p>
    </section>
  );
}
