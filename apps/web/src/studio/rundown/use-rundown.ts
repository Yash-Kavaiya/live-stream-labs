import { applyRundownItem, DEFAULT_NEWS, type Rundown, type RundownItem, type RundownSource, type RundownStatusDto, type Scene } from '@studio/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../lib/api';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const POLL_MS = 4000;

export interface RundownState {
  /** The rundown on the page: the newest one, or the earlier day the host picked. */
  rundown: Rundown | null;
  show: RundownStatusDto['show'] | null;
  /** Days that have a rundown, newest first. */
  dates: string[];
  loading: boolean;
  generating: boolean;
  /** Why there is no rundown, or why the last attempt made none. */
  error: string | null;
  /** Links the host added to an item during this session, by item id. */
  extraSources: Record<string, RundownSource[]>;
  pick(date: string): void;
  generate(): void;
  /** Adds a link to an item. Returns a message when the address cannot be used. */
  addSource(itemId: string, url: string): string | null;
}

/** The day's rundown for the studio. While one is being made, asks again every few seconds. */
export function useRundown(enabled: boolean): RundownState {
  const [status, setStatus] = useState<RundownStatusDto | null>(null);
  const [picked, setPicked] = useState<Rundown | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [extraSources, setExtraSources] = useState<Record<string, RundownSource[]>>({});
  const generating = status?.generating ?? false;

  const refresh = useCallback(async () => {
    try {
      const [next, days] = await Promise.all([api.rundownLatest(), api.rundownDates()]);
      setStatus(next);
      setDates(days);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !generating) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, generating, refresh]);

  const pick = useCallback(
    (date: string) => {
      if (date === status?.rundown?.date) return setPicked(null);
      api.rundown(date).then(setPicked, (err) => setError(errorMessage(err)));
    },
    [status],
  );

  const generate = useCallback(() => {
    setPicked(null);
    api.generateRundown().then(setStatus, (err) => setError(errorMessage(err)));
  }, []);

  const addSource = useCallback((itemId: string, raw: string): string | null => {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return 'Enter a web address starting with https://';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Enter a web address starting with https://';
    const site = url.hostname.replace(/^www\./, '').slice(0, 40);
    const source: RundownSource = { url: url.toString().slice(0, 500), title: site, site, quote: '' };
    setExtraSources((all) => ({ ...all, [itemId]: [...(all[itemId] ?? []), source].slice(-6) }));
    return null;
  }, []);

  return useMemo(
    () => ({
      rundown: picked ?? status?.rundown ?? null,
      show: status?.show ?? null,
      dates,
      loading: enabled && status === null && error === null,
      generating,
      error: error ?? status?.error ?? null,
      extraSources,
      pick,
      generate,
      addSource,
    }),
    [picked, status, dates, enabled, error, generating, extraSources, pick, generate, addSource],
  );
}

/** Puts the item at `index` on air. Out-of-range indexes do nothing, so Next at the end is harmless. */
export function takeItem(update: SceneUpdater, state: Pick<RundownState, 'rundown' | 'show'>, index: number): void {
  const item = state.rundown?.items[index];
  if (!item) return;
  const { show } = state;
  const social = show ? { handle: `@${show.x}`, line: `GitHub ${show.github} · LinkedIn ${show.linkedin}` } : undefined;
  update((scene) => {
    const next = applyRundownItem(scene, item, social);
    // A studio still carrying the placeholder channel name takes the show's name.
    const unnamed = show && next.news.channel === DEFAULT_NEWS.channel;
    return unnamed ? { ...next, news: { ...next.news, channel: show.name.toUpperCase().slice(0, 24) } } : next;
  });
}

/** Where the on-air item sits in the rundown, or -1 when nothing from it is on air. */
export function onAirIndex(rundown: Rundown | null, scene: Scene): number {
  return rundown ? rundown.items.findIndex((item) => item.id === scene.news.rundownItemId) : -1;
}

export function onAirItem(rundown: Rundown | null, scene: Scene): RundownItem | null {
  return rundown?.items[onAirIndex(rundown, scene)] ?? null;
}
