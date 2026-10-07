import {
  addToQueue,
  countVotes,
  createPoll,
  extractEmojis,
  MAX_BURST,
  nextHype,
  nextInQueue,
  parseVote,
  pausePlaying,
  removeFromQueue,
  resumePlaying,
  seekPlaying,
  startPlaying,
  stopPlaying,
  type CommentDto,
  type Party,
  type PartyItem,
  type Scene,
} from '@studio/shared';
import type { Room } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PartyPlayer } from './player';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

/** How long the "Up next" card shows between two videos. */
export const UP_NEXT_MS = 5000;
/** Chat reactions and votes reach the scene this often, however fast chat moves. */
const FLUSH_MS = 2000;
const VOLUME_KEY = 'studio.party.volume';

const newId = () => crypto.randomUUID().slice(0, 8);
const titleOf = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Video';

function savedVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY) ?? '1');
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
}

export interface PartyControls {
  /** Item ids whose video file is in this browser's memory and can be played. */
  ready: ReadonlySet<string>;
  /** The queue item that last failed, and why. */
  error: { id: string; message: string } | null;
  volume: number;
  /** The host's shared tab is on stage, which is how a link is shown. */
  sharing: boolean;
  /** Opens the browser's picker so the host can put the link's tab, with its sound, on stage. */
  shareLink(): Promise<void>;
  addFiles(files: Iterable<File>): void;
  /** Gives a queued file item its file again, after a reload. */
  attachFile(id: string, file: File): void;
  /** Adds a link. Returns a message when the address cannot be used. */
  addLink(title: string, url: string): string | null;
  remove(id: string): void;
  play(item: PartyItem): void;
  togglePause(): void;
  seek(seconds: number): void;
  stop(): void;
  next(): void;
  setVolume(volume: number): void;
  /** Where the file really is, in seconds, for the seek slider. */
  position(): number;
  startPoll(question: string, options: string[]): boolean;
  /** Adds the host's own reaction to the hype meter. */
  react(): void;
}

interface Options {
  room: Room | null;
  scene: Scene;
  update: SceneUpdater;
  /** Viewer comments while live. New ones are read for votes and emoji. */
  comments: CommentDto[];
  /** The host is sharing a screen or tab right now. */
  sharing: boolean;
  /** Only the host, in the watch party template, runs any of this. */
  enabled: boolean;
}

/**
 * The host's side of the watch party: the video files and their player, links and their tab, moving
 * through the queue, and turning chat into poll votes and reactions. Everything viewers see goes
 * through `update` into `scene.party`.
 */
export function useParty({ room, scene, update, comments, sharing, enabled }: Options): PartyControls {
  const files = useRef(new Map<string, File>());
  const player = useRef<PartyPlayer | null>(null);
  const upNextTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The tab a link was opened in, so stopping can close it again. */
  const linkTab = useRef<Window | null>(null);
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<PartyControls['error']>(null);
  const [volume, setVolumeState] = useState(savedVolume);

  // Timers and player callbacks need the scene and room as they are when they fire.
  const live = useRef({ scene, room, volume });
  live.current = { scene, room, volume };

  const setParty = useCallback((change: (party: Party) => Party) => update((s) => {
    const party = change(s.party);
    return party === s.party ? s : { ...s, party };
  }), [update]);

  /** Takes a link off the stage: ends the share that showed it and closes its tab. */
  const dropLink = useCallback(() => {
    const { scene: current, room: currentRoom } = live.current;
    if (current.party.playing?.kind !== 'link') return;
    void currentRoom?.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
    linkTab.current?.close();
    linkTab.current = null;
  }, []);

  const halt = useCallback(() => {
    clearTimeout(upNextTimer.current);
    player.current?.stop();
    dropLink();
    setParty(stopPlaying);
  }, [dropLink, setParty]);

  const play = useCallback(
    (item: PartyItem) => {
      clearTimeout(upNextTimer.current);
      setError(null);
      dropLink();
      if (item.kind === 'link') {
        player.current?.stop();
        // A new tab, not a window. The browser only lets a page onto the stream through its
        // share picker, so the host puts the tab on stage from the player as the next step.
        linkTab.current = window.open(item.url, 'studio-party');
        if (!linkTab.current) setError({ id: item.id, message: 'The link could not be opened. Allow pop-ups for the studio and try again.' });
        setParty((p) => startPlaying(p, item, 0, Date.now()));
        return;
      }
      const file = files.current.get(item.id);
      const { room: currentRoom } = live.current;
      if (!file || !currentRoom) {
        setError({ id: item.id, message: file ? 'The studio is not connected yet.' : 'Choose this file again to play it.' });
        return;
      }
      player.current ??= new PartyPlayer();
      const p = player.current;
      p.onEnded = () => {
        const { party } = live.current.scene;
        const next = nextInQueue(party, party.playing?.itemId ?? null);
        // A link needs a click to open its window, and a file may need choosing again: stop there.
        if (!party.autoAdvance || !next || next.kind !== 'file' || !files.current.has(next.id)) return halt();
        setParty((current) => ({ ...current, upNextUntil: Date.now() + UP_NEXT_MS }));
        upNextTimer.current = setTimeout(() => play(next), UP_NEXT_MS);
      };
      p.load(currentRoom, file).then(
        (duration) => {
          p.setVolume(live.current.volume);
          setParty((current) => startPlaying(current, item, duration, Date.now()));
        },
        (err: unknown) => {
          setError({ id: item.id, message: err instanceof Error ? err.message : 'This file could not be played' });
          setParty(stopPlaying);
        },
      );
    },
    [dropLink, halt, setParty],
  );

  const controls = useMemo<Omit<PartyControls, 'ready' | 'error' | 'volume' | 'sharing'>>(
    () => ({
      async shareLink() {
        const { scene: current, room: currentRoom } = live.current;
        const playing = current.party.playing;
        if (!currentRoom || playing?.kind !== 'link') return;
        try {
          await currentRoom.localParticipant.setScreenShareEnabled(true, { audio: true });
        } catch (err) {
          // Closing the browser's picker without choosing is not a failure.
          if ((err as Error).name !== 'NotAllowedError') setError({ id: playing.itemId, message: 'The tab could not be put on stage. Try again.' });
        }
      },
      addFiles(picked) {
        const added: PartyItem[] = [];
        for (const file of picked) {
          const item: PartyItem = { id: newId(), kind: 'file', title: titleOf(file.name), url: '' };
          files.current.set(item.id, file);
          added.push(item);
        }
        setReady(new Set(files.current.keys()));
        setParty((p) => added.reduce(addToQueue, p));
      },
      attachFile(id, file) {
        files.current.set(id, file);
        setReady(new Set(files.current.keys()));
        setError((current) => (current?.id === id ? null : current));
      },
      addLink(title, raw) {
        let url: URL;
        try {
          url = new URL(raw.trim());
        } catch {
          return 'Enter a web address starting with https://';
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Enter a web address starting with https://';
        const name = title.trim().slice(0, 80) || url.hostname.replace(/^www\./, '').slice(0, 80);
        setParty((p) => addToQueue(p, { id: newId(), kind: 'link', title: name, url: url.toString().slice(0, 500) }));
        return null;
      },
      remove(id) {
        if (live.current.scene.party.playing?.itemId === id) {
          clearTimeout(upNextTimer.current);
          player.current?.stop();
          dropLink();
        }
        files.current.delete(id);
        setReady(new Set(files.current.keys()));
        setParty((p) => removeFromQueue(p, id));
      },
      play,
      togglePause() {
        const playing = live.current.scene.party.playing;
        const p = player.current;
        if (!playing || playing.kind !== 'file' || !p?.loaded) return;
        // The file's own clock is the truth; the scene is brought to it at each pause and resume.
        const at = p.position;
        if (playing.pausedAt === null) {
          p.pause();
          setParty((current) => pausePlaying(seekPlaying(current, at, Date.now()), Date.now()));
        } else {
          p.play();
          setParty((current) => resumePlaying(seekPlaying(current, at, Date.now()), Date.now()));
        }
      },
      seek(seconds) {
        if (!player.current?.loaded) return;
        clearTimeout(upNextTimer.current);
        player.current.seek(seconds);
        setParty((current) => ({ ...seekPlaying(current, seconds, Date.now()), upNextUntil: null }));
      },
      stop: halt,
      next() {
        const { party } = live.current.scene;
        const next = nextInQueue(party, party.playing?.itemId ?? null);
        if (next) play(next);
        else halt();
      },
      setVolume(value) {
        const level = Math.min(1, Math.max(0, value));
        setVolumeState(level);
        player.current?.setVolume(level);
        try {
          localStorage.setItem(VOLUME_KEY, String(level));
        } catch {
          // Private browsing: the choice just is not remembered.
        }
      },
      position: () => player.current?.position ?? 0,
      startPoll(question, options) {
        const poll = createPoll(newId(), question, options);
        if (poll) setParty((p) => ({ ...p, poll }));
        return poll !== null;
      },
      react() {
        setParty((p) => ({ ...p, hype: Math.min(100, p.hype + 8) }));
      },
    }),
    [dropLink, halt, play, setParty],
  );

  // ---------- Chat: votes and reactions ----------

  const seen = useRef(new Set<string>());
  const pending = useRef<string[]>([]);
  const voters = useRef<{ pollId: string | null; choices: Map<string, number> }>({ pollId: null, choices: new Map() });

  useEffect(() => {
    if (!enabled) return;
    const poll = live.current.scene.party.poll;
    if (voters.current.pollId !== (poll?.id ?? null)) voters.current = { pollId: poll?.id ?? null, choices: new Map() };
    for (const comment of comments) {
      if (seen.current.has(comment.id)) continue;
      seen.current.add(comment.id);
      const vote = poll?.open ? parseVote(comment.text, poll.options.length) : null;
      // One vote per viewer on each platform; a later vote replaces the earlier one.
      if (vote !== null) voters.current.choices.set(`${comment.platform}:${comment.author}`, vote);
      else pending.current.push(...extractEmojis(comment.text));
    }
  }, [enabled, comments, scene.party.poll?.id]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const reactions = pending.current.splice(0);
      setParty((party) => {
        const hype = nextHype(party.hype, reactions.length);
        const { poll } = party;
        const counted = poll?.open && voters.current.pollId === poll.id ? countVotes(voters.current.choices, poll.options.length) : null;
        const votesChanged = counted !== null && poll !== null && counted.some((n, i) => n !== poll.chat[i]);
        if (reactions.length === 0 && hype === party.hype && !votesChanged) return party;
        return {
          ...party,
          hype,
          burst: reactions.length ? { id: newId(), emojis: reactions.slice(0, MAX_BURST), at: Date.now() } : party.burst,
          poll: votesChanged && poll && counted ? { ...poll, chat: counted } : poll,
        };
      });
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, [enabled, setParty]);

  // Leaving the studio, or the watch party, takes the video off the stage.
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (enabled) {
      wasEnabled.current = true;
      // After a reload the scene may still say a file is playing, but its player is gone.
      setParty((party) => (party.playing?.kind === 'file' && !player.current?.loaded ? stopPlaying(party) : party));
      return;
    }
    if (!wasEnabled.current) return;
    wasEnabled.current = false;
    clearTimeout(upNextTimer.current);
    player.current?.stop();
    dropLink();
    setParty(stopPlaying);
  }, [dropLink, enabled, setParty]);
  useEffect(
    () => () => {
      clearTimeout(upNextTimer.current);
      player.current?.close();
    },
    [],
  );

  return useMemo(() => ({ ...controls, ready, error, volume, sharing }), [controls, ready, error, volume, sharing]);
}
