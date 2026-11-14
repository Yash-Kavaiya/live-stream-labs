import { boardKey, MAX_BOARD_PAGES } from '@studio/shared';
import { Button, Icon } from '@studio/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { drawBoardPage } from '../graphics/classroom';
import type { Surface } from '../graphics/ink';
import { useClassChannel } from './channel';
import { InkCanvas, type InkSettings } from './ink-canvas';
import { InkToolbar } from './ink-toolbar';

/** Shown until the studio answers, or when this window was opened on its own. */
export function WaitingForStudio({ lost, what }: { lost: boolean; what: string }) {
  return (
    <div className="class-window-empty">
      <Icon name={lost ? 'link_off' : 'hourglass_top'} />
      <p className="body-large">
        {lost
          ? `Open the ${what} from the Class tab in the studio. Keep the studio open in another window while you use it.`
          : 'Connecting to the studio…'}
      </p>
    </div>
  );
}

/** The whiteboard in its own window: a big surface to draw on, with pages. */
export function BoardWindow() {
  const broadcastId = useParams().id!;
  const { state, lost, fullKey, send } = useClassChannel(broadcastId);
  const [settings, setSettings] = useState<InkSettings>({ tool: 'pen', color: '#202124', size: 'M' });

  useEffect(() => {
    document.title = 'Whiteboard';
  }, []);

  const scene = state?.scene;
  const classroom = scene?.classroom;
  const page = classroom?.boardPage ?? 0;
  const key = boardKey(page);
  const background = useCallback((ctx: CanvasRenderingContext2D, surface: Surface) => scene && drawBoardPage(ctx, surface, scene), [scene]);

  if (!state || !scene || !classroom) return <WaitingForStudio lost={lost} what="whiteboard" />;

  const pages = classroom.boardPages;
  const onAir = scene.template === 'classroom' && classroom.view === 'board';
  const history = state.history[key] ?? { undo: false, redo: false };
  const go = (boardPage: number) => send({ type: 'nav', patch: { boardPage } });

  return (
    <div className="class-window" data-testid="board-window">
      <header className="class-window-bar">
        <Icon name="draw" />
        <span className="title-medium">Whiteboard</span>
        <InkToolbar
          settings={settings}
          onChange={setSettings}
          canUndo={history.undo}
          canRedo={history.redo}
          onUndo={() => send({ type: 'undo', key })}
          onRedo={() => send({ type: 'redo', key })}
          onClear={() => send({ type: 'clear', key })}
        />
      </header>

      <main className="class-window-stage">
        <InkCanvas
          surfaceKey={key}
          strokes={state.layers[key] ?? []}
          background={background}
          settings={settings}
          send={send}
          resetToken={fullKey}
        />
      </main>

      <footer className="class-window-bar">
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="ink-tool" disabled={page === 0} onClick={() => go(page - 1)} aria-label="Previous page" data-testid="board-prev">
            <Icon name="chevron_left" />
          </button>
          <span className="label-large" data-testid="board-page">
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="ink-tool" disabled={page >= pages - 1} onClick={() => go(page + 1)} aria-label="Next page" data-testid="board-next">
            <Icon name="chevron_right" />
          </button>
          <Button
            variant="text"
            icon="note_add"
            disabled={pages >= MAX_BOARD_PAGES}
            onClick={() => send({ type: 'nav', patch: { boardPages: pages + 1, boardPage: pages } })}
            data-testid="board-add-page"
          >
            New page
          </Button>
        </div>
        {fullKey === key && <span className="chip error">This page is full. Start a new page.</span>}
        <span className="grow" />
        {scene.template !== 'classroom' ? (
          <span className="body-small muted">Switch the studio to the Classroom template to show the board.</span>
        ) : onAir ? (
          <span className="chip live" data-testid="board-on-air">
            <Icon name="sensors" /> On stream
          </span>
        ) : (
          <Button icon="cast" onClick={() => send({ type: 'nav', patch: { view: 'board' } })} data-testid="board-show">
            Show board on stream
          </Button>
        )}
      </footer>
    </div>
  );
}
