import {
  inkFits,
  visibleInkKey,
  type Classroom,
  type InkStroke,
  type Scene,
} from '@studio/shared';
import { useEffect, useRef } from 'react';
import type { LiveInk } from './graphics/classroom';

/**
 * The classroom's whiteboard pages and slide ink, owned by the host's studio window.
 *
 * The whiteboard and slides windows are separate browser windows; they draw here through a
 * BroadcastChannel and the studio is the only writer. Every surface lives in this store (and in
 * the browser's storage, so a reload keeps it); only the surface on screen goes into the scene,
 * because the scene rides in LiveKit room metadata, which is size-capped.
 */

export type ClassNav = Partial<Pick<Classroom, 'view' | 'boardPage' | 'boardPages' | 'slide' | 'slides' | 'quiz' | 'quizBank' | 'quizPick'>>;

/** Window -> studio. */
export type ClassRequest =
  | { type: 'hello' }
  | { type: 'add'; key: string; stroke: InkStroke }
  | { type: 'erase'; key: string; indices: number[] }
  | { type: 'undo' | 'redo' | 'clear'; key: string }
  | { type: 'live'; key: string; stroke: InkStroke; points: number[] }
  | { type: 'live-end' }
  | { type: 'nav'; patch: ClassNav }
  /** Confetti on the stream, as when the answer to a quiz is revealed. */
  | { type: 'celebrate' };

/** Studio -> windows. */
export type ClassMessage =
  | { type: 'state'; scene: Scene; layers: Record<string, InkStroke[]>; history: Record<string, { undo: boolean; redo: boolean }> }
  | { type: 'full'; key: string };

export const classChannelName = (broadcastId: string) => `studio-class-${broadcastId}`;

const HISTORY = 60;

// The stroke being drawn this moment. The compositor reads it every frame, so ink appears on the
// stream while the pen is still moving, not only when the stroke is finished.
let live: LiveInk | null = null;
export const getLiveInk = (): LiveInk | null => live;

export class InkStore {
  layers: Record<string, InkStroke[]> = {};
  private readonly undo: Record<string, InkStroke[][]> = {};
  private readonly redo: Record<string, InkStroke[][]> = {};
  private saveTimer = 0;

  constructor(private readonly storageKey: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as unknown;
      if (saved && typeof saved === 'object') this.layers = saved as Record<string, InkStroke[]>;
    } catch {
      // No storage (private window) or a damaged entry: start empty.
    }
  }

  history(): Record<string, { undo: boolean; redo: boolean }> {
    const keys = new Set([...Object.keys(this.undo), ...Object.keys(this.redo)]);
    return Object.fromEntries([...keys].map((k) => [k, { undo: !!this.undo[k]?.length, redo: !!this.redo[k]?.length }]));
  }

  /** Takes on the scene's ink for a surface this browser has never seen (another machine drew it). */
  adopt(key: string, strokes: InkStroke[]): void {
    if (!(key in this.layers)) this.layers[key] = strokes;
  }

  private set(key: string, next: InkStroke[]): void {
    const before = this.layers[key] ?? [];
    (this.undo[key] ??= []).push(before);
    if (this.undo[key].length > HISTORY) this.undo[key].shift();
    this.redo[key] = [];
    this.layers[key] = next;
    this.save();
  }

  /** Applies a change; returns 'full' when a stroke does not fit, true when anything changed. */
  apply(req: ClassRequest): boolean | 'full' {
    switch (req.type) {
      case 'add': {
        const current = this.layers[req.key] ?? [];
        if (!inkFits(current, req.stroke)) return 'full';
        this.set(req.key, [...current, req.stroke]);
        return true;
      }
      case 'erase': {
        const drop = new Set(req.indices);
        const current = this.layers[req.key] ?? [];
        if (!current.some((_, i) => drop.has(i))) return false;
        this.set(req.key, current.filter((_, i) => !drop.has(i)));
        return true;
      }
      case 'clear':
        if (!this.layers[req.key]?.length) return false;
        this.set(req.key, []);
        return true;
      case 'undo':
      case 'redo': {
        const from = req.type === 'undo' ? this.undo : this.redo;
        const to = req.type === 'undo' ? this.redo : this.undo;
        const previous = from[req.key]?.pop();
        if (!previous) return false;
        (to[req.key] ??= []).push(this.layers[req.key] ?? []);
        this.layers[req.key] = previous;
        this.save();
        return true;
      }
      default:
        return false;
    }
  }

  /** Forgets the ink on every slide, for a new deck. */
  clearSlides(): void {
    for (const key of Object.keys(this.layers)) {
      if (key.startsWith('slide:')) {
        delete this.layers[key];
        delete this.undo[key];
        delete this.redo[key];
      }
    }
    this.save();
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.layers));
      } catch {
        // Storage full or blocked: the ink still shows; it just will not survive a reload.
      }
    }, 400);
  }
}

/** Puts the ink of the surface on screen into the scene, or returns the scene unchanged. */
export function withVisibleInk(scene: Scene, layers: Record<string, InkStroke[]>): Scene {
  const key = visibleInkKey(scene.classroom);
  const strokes = key ? (layers[key] ?? []) : [];
  const current = scene.classroom.ink;
  const ink = key && strokes.length ? { key, strokes } : null;
  if (ink === null ? current === null : current?.key === key && current.strokes === strokes) return scene;
  return { ...scene, classroom: { ...scene.classroom, ink } };
}

/** A navigation change from a window, kept inside the deck and the pages. */
export function applyNav(scene: Scene, patch: ClassNav): Scene {
  const c = { ...scene.classroom, ...patch };
  c.boardPages = Math.max(1, Math.min(20, c.boardPages));
  c.boardPage = Math.max(0, Math.min(c.boardPages - 1, c.boardPage));
  c.slide = Math.max(0, Math.min(Math.max(0, c.slides.length - 1), c.slide));
  c.quizPick = Math.max(-1, Math.min(c.quizBank.length - 1, c.quizPick));
  return { ...scene, classroom: c };
}

/**
 * Host only: serves the whiteboard and slides windows, and keeps the scene's ink in step with the
 * surface on screen.
 */
export function useClassInk(broadcastId: string, scene: Scene, update: (change: (scene: Scene) => Scene) => void, enabled: boolean): InkStore | null {
  const store = useRef<InkStore | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  if (enabled && !store.current) {
    store.current = new InkStore(`class-ink:${broadcastId}`);
    const ink = scene.classroom.ink;
    if (ink) store.current.adopt(ink.key, ink.strokes);
  }

  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') return;
    const ink = store.current!;
    const bc = new BroadcastChannel(classChannelName(broadcastId));
    channel.current = bc;
    bc.onmessage = (event: MessageEvent<ClassRequest>) => {
      const req = event.data;
      if (req.type === 'hello') {
        post();
        return;
      }
      if (req.type === 'live') {
        live = { key: req.key, stroke: req.stroke, points: req.points };
        return;
      }
      if (req.type === 'live-end') {
        live = null;
        return;
      }
      if (req.type === 'celebrate') {
        update((s) => ({ ...s, celebration: { id: Math.random().toString(36).slice(2, 12), kind: 'reaction', emoji: '🎉', text: '', at: Date.now() } }));
        return;
      }
      if (req.type === 'nav') {
        // A removed deck takes the ink written on its slides with it.
        if (req.patch.slides?.length === 0) ink.clearSlides();
        update((s) => withVisibleInk(applyNav(s, req.patch), ink.layers));
        post();
        return;
      }
      const result = ink.apply(req);
      if (req.type === 'add') live = null;
      if (result === 'full') bc.postMessage({ type: 'full', key: req.key } satisfies ClassMessage);
      if (result === true) {
        update((s) => withVisibleInk(s, ink.layers));
        post();
      }
    };
    function post() {
      bc.postMessage({ type: 'state', scene: sceneRef.current, layers: ink.layers, history: ink.history() } satisfies ClassMessage);
    }
    return () => {
      bc.close();
      channel.current = null;
      live = null;
    };
  }, [broadcastId, enabled, update]);

  // Keep the scene's ink on the surface on screen, and tell the windows about every change.
  const c = scene.classroom;
  useEffect(() => {
    if (!enabled) return;
    update((s) => withVisibleInk(s, store.current!.layers));
  }, [enabled, update, c.view, c.boardPage, c.slide, c.slides]);

  useEffect(() => {
    const ink = store.current;
    if (!enabled || !ink) return;
    channel.current?.postMessage({ type: 'state', scene, layers: ink.layers, history: ink.history() } satisfies ClassMessage);
  }, [enabled, scene]);

  return enabled ? store.current : null;
}

/** Opens (or brings forward) one of the classroom windows. */
export function openClassWindow(broadcastId: string, kind: 'board' | 'slides' | 'quiz'): void {
  const width = Math.min(1400, screen.availWidth - 80);
  const height = Math.min(900, screen.availHeight - 80);
  const win = window.open(`/studio/${broadcastId}/${kind}`, `class-${kind}-${broadcastId}`, `popup,width=${width},height=${height}`);
  win?.focus();
}
