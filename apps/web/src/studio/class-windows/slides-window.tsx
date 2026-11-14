import { MAX_SLIDES, slideKey } from '@studio/shared';
import { Button, Icon } from '@studio/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Surface } from '../graphics/ink';
import { importSlides, SLIDE_ACCEPT } from '../slides-import';
import { WaitingForStudio } from './board-window';
import { useClassChannel } from './channel';
import { InkCanvas, type InkSettings } from './ink-canvas';
import { InkToolbar } from './ink-toolbar';

/** Loads slide pictures once; `version` changes as each one arrives so the canvas can redraw. */
function useImages() {
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [version, setVersion] = useState(0);
  const get = useCallback((url: string | undefined) => {
    if (!url) return null;
    let img = cache.current.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => setVersion((v) => v + 1);
      img.src = url;
      cache.current.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }, []);
  return { get, version };
}

function drawContained(ctx: CanvasRenderingContext2D, surface: Surface, img: HTMLImageElement | null): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(surface.x, surface.y, surface.width, surface.height);
  if (!img) return;
  const scale = Math.min(surface.width / img.naturalWidth, surface.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, surface.x + (surface.width - w) / 2, surface.y + (surface.height - h) / 2, w, h);
}

/** The presenter's window for slides: the slide to write on, what comes next, and every slide. */
export function SlidesWindow() {
  const broadcastId = useParams().id!;
  const { state, lost, fullKey, send } = useClassChannel(broadcastId);
  const [settings, setSettings] = useState<InkSettings>({ tool: 'pen', color: '#d93025', size: 'M' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const images = useImages();

  useEffect(() => {
    document.title = 'Slides';
  }, []);

  const classroom = state?.scene.classroom;
  const slides = classroom?.slides ?? [];
  const index = Math.min(classroom?.slide ?? 0, Math.max(0, slides.length - 1));
  const key = slideKey(index);
  const current = slides[index];
  const background = useCallback(
    (ctx: CanvasRenderingContext2D, surface: Surface) => drawContained(ctx, surface, images.get(current)),
    [current, images],
  );
  // Fetch the next slide ahead of time.
  images.get(slides[index + 1]);

  const go = useCallback((slide: number) => send({ type: 'nav', patch: { slide } }), [send]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        if (index < slides.length - 1) go(index + 1);
      } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        if (index > 0) go(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, slides.length]);

  // Keep the current slide's thumbnail in view.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  if (!state || !classroom) return <WaitingForStudio lost={lost} what="slides" />;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      const { urls, skipped } = await importSlides(broadcastId, [...files], MAX_SLIDES - slides.length, (done, total) => setProgress({ done, total }));
      const first = slides.length;
      send({ type: 'nav', patch: { slides: [...slides, ...urls], slide: first, view: 'slides' } });
      if (skipped > 0) setError(`A deck holds up to ${MAX_SLIDES} slides; ${skipped} were left out.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read those slides');
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onAir = state.scene.template === 'classroom' && classroom.view === 'slides';
  const history = state.history[key] ?? { undo: false, redo: false };
  const next = slides[index + 1];

  return (
    <div className="class-window" data-testid="slides-window">
      <header className="class-window-bar">
        <Icon name="slideshow" />
        <span className="title-medium">Slides</span>
        {slides.length > 0 && (
          <InkToolbar
            settings={settings}
            onChange={setSettings}
            canUndo={history.undo}
            canRedo={history.redo}
            onUndo={() => send({ type: 'undo', key })}
            onRedo={() => send({ type: 'redo', key })}
            onClear={() => send({ type: 'clear', key })}
          />
        )}
        <span className="grow" />
        <input ref={fileInput} type="file" accept={SLIDE_ACCEPT} multiple hidden onChange={(e) => void upload(e.target.files)} data-testid="slides-file" />
        {slides.length > 0 && (
          <>
            <Button variant="tonal" icon="add" disabled={!!progress || slides.length >= MAX_SLIDES} onClick={() => fileInput.current?.click()}>
              Add slides
            </Button>
            <Button variant="text" danger icon="delete" disabled={!!progress} onClick={() => send({ type: 'nav', patch: { slides: [], slide: 0 } })} data-testid="slides-remove">
              Remove deck
            </Button>
          </>
        )}
      </header>

      {progress && (
        <div className="class-window-progress" data-testid="slides-progress">
          <span className="body-medium">
            Preparing slide {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </span>
          <progress max={progress.total} value={progress.done} />
        </div>
      )}
      {error && <p className="class-window-error body-medium">{error}</p>}

      {slides.length === 0 ? (
        <button
          type="button"
          className="slides-drop"
          disabled={!!progress}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(e.dataTransfer.files);
          }}
          data-testid="slides-upload"
        >
          <Icon name="upload_file" />
          <span className="title-large">Upload your slides</span>
          <span className="body-medium muted">
            A PDF (export it from PowerPoint, Google Slides or Keynote) or PNG and JPEG images, one per slide. Drop them here or click to choose.
          </span>
        </button>
      ) : (
        <>
          <main className="slides-main">
            <InkCanvas
              surfaceKey={key}
              strokes={state.layers[key] ?? []}
              background={background}
              backgroundVersion={images.version}
              settings={settings}
              send={send}
              resetToken={fullKey}
            />
            <aside className="slides-side">
              <span className="label-large muted">Next</span>
              <div className="slides-next">{next ? <img src={next} alt={`Slide ${index + 2}`} /> : <span className="body-medium muted">End of deck</span>}</div>
              <div className="slides-counter">
                <button type="button" className="slides-step" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous slide" data-testid="slides-prev">
                  <Icon name="arrow_back" />
                </button>
                <span className="headline-small" data-testid="slides-index">
                  {index + 1} / {slides.length}
                </span>
                <button type="button" className="slides-step" disabled={index >= slides.length - 1} onClick={() => go(index + 1)} aria-label="Next slide" data-testid="slides-next">
                  <Icon name="arrow_forward" />
                </button>
              </div>
              <span className="body-small muted">← → or Space to move. Ink stays on its own slide.</span>
              {fullKey === key && <span className="chip error">This slide is full of ink. Clear some first.</span>}
              <span className="grow" />
              {state.scene.template !== 'classroom' ? (
                <span className="body-small muted">Switch the studio to the Classroom template to show slides.</span>
              ) : onAir ? (
                <span className="chip live" data-testid="slides-on-air">
                  <Icon name="sensors" /> On stream
                </span>
              ) : (
                <Button icon="cast" onClick={() => send({ type: 'nav', patch: { view: 'slides' } })} data-testid="slides-show">
                  Show slides on stream
                </Button>
              )}
            </aside>
          </main>
          <footer className="slides-strip" ref={strip}>
            {slides.map((url, i) => (
              <button
                key={`${url}-${i}`}
                type="button"
                className="slides-thumb"
                aria-current={i === index}
                onClick={() => go(i)}
                title={`Slide ${i + 1}`}
                data-testid="slides-thumb"
              >
                <img src={url} alt="" loading="lazy" />
                <span className="label-small">{i + 1}</span>
                {(state.layers[slideKey(i)]?.length ?? 0) > 0 && <Icon name="draw" />}
              </button>
            ))}
          </footer>
        </>
      )}
    </div>
  );
}
