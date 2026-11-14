import type { InkStroke, Scene } from '@studio/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { classChannelName, type ClassMessage, type ClassRequest } from '../class-ink';

export interface ClassWindowState {
  scene: Scene;
  layers: Record<string, InkStroke[]>;
  history: Record<string, { undo: boolean; redo: boolean }>;
}

/**
 * A classroom window's line to the studio window that opened it. The studio owns the ink and the
 * scene; this window sends what the teacher does and draws whatever state comes back.
 */
export function useClassChannel(broadcastId: string) {
  const [state, setState] = useState<ClassWindowState | null>(null);
  const [lost, setLost] = useState(false);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const bc = new BroadcastChannel(classChannelName(broadcastId));
    channel.current = bc;
    bc.onmessage = (event: MessageEvent<ClassMessage>) => {
      const msg = event.data;
      if (msg.type === 'state') {
        setState({ scene: msg.scene, layers: msg.layers, history: msg.history });
        setLost(false);
        setFullKey(null);
      } else if (msg.type === 'full') {
        setFullKey(msg.key);
      }
    };
    bc.postMessage({ type: 'hello' } satisfies ClassRequest);
    // Ask again now and then, so a studio reloaded behind this window is found again.
    const retry = window.setInterval(() => bc.postMessage({ type: 'hello' } satisfies ClassRequest), 3000);
    const giveUp = window.setTimeout(() => setLost(true), 2500);
    return () => {
      clearInterval(retry);
      clearTimeout(giveUp);
      bc.close();
      channel.current = null;
    };
  }, [broadcastId]);

  // Once state has arrived, a quiet studio is fine; only a window that never heard back is lost.
  useEffect(() => {
    if (state) setLost(false);
  }, [state]);

  const send = useCallback((req: ClassRequest) => channel.current?.postMessage(req), []);
  return { state, lost: lost && !state, fullKey, send };
}
