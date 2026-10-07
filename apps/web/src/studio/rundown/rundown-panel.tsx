import { rundownSeconds, type RundownItem, type RundownSource, type Scene } from '@studio/shared';
import { Button, Icon, IconButton, Select, Spinner, TextField } from '@studio/ui';
import { useState } from 'react';
import { formatDuration } from '../../lib/format';
import { onAirIndex, takeItem, type RundownState } from './use-rundown';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;

const sameSource = (a: RundownSource | null, b: RundownSource) => a?.url === b.url;

/** Opens a story's page in a new tab, ready to pick in the screen share dialog. Every story reuses the same tab. */
function openToShare(url: string): void {
  window.open(url, 'studio-source');
}

function Sources({ item, extra, scene, update, onAdd }: { item: RundownItem; extra: RundownSource[]; scene: Scene; update: SceneUpdater; onAdd(url: string): string | null }) {
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const sources = [...item.sources, ...extra];
  const canShowCard = scene.news.view === 'anchor';

  const toggleCard = (source: RundownSource) =>
    update((s) => ({ ...s, news: { ...s.news, source: sameSource(s.news.source, source) ? null : source } }));
  const add = () => {
    const problem = onAdd(link);
    setLinkError(problem);
    if (!problem) setLink('');
  };

  return (
    <div className="col rundown-sources" style={{ gap: 8 }}>
      {sources.length === 0 && <span className="body-small muted">This item has no link. Add one below to open or show it.</span>}
      {sources.map((source) => {
        const shown = sameSource(scene.news.source, source);
        return (
          <div key={source.url} className="rundown-source">
            <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
              <span className="label-medium truncate">{source.site}</span>
              <span className="body-small truncate muted" title={source.title}>{source.title}</span>
            </span>
            <IconButton icon="open_in_new" label="Open to share" onClick={() => openToShare(source.url)} data-testid="rundown-open" />
            <IconButton
              icon={shown ? 'cancel_presentation' : 'featured_play_list'}
              label={shown ? 'Take the card off' : canShowCard ? 'Show as a card on the stream' : 'Switch to the Anchor scene to show a card'}
              variant={shown ? 'filled' : 'standard'}
              disabled={!canShowCard && !shown}
              onClick={() => toggleCard(source)}
              data-testid="rundown-card"
            />
          </div>
        );
      })}
      {scene.news.source && scene.stage.length > 1 && canShowCard && (
        <span className="body-small muted">The card shows when the presenter is alone on stage. Take the other sources off to see it.</span>
      )}
      <div className="row" style={{ gap: 4, alignItems: 'flex-start' }}>
        <TextField label="Add a link (a post, a tweet, a page)" type="url" value={link} onValue={setLink} onEnter={add} error={linkError ?? undefined} maxLength={500} style={{ flex: 1 }} data-testid="rundown-add-link" />
        <IconButton icon="add" label="Add link" onClick={add} disabled={!link.trim()} />
      </div>
    </div>
  );
}

interface Props {
  scene: Scene;
  update: SceneUpdater;
  state: RundownState;
}

/** The day's show on the News tab: every item in order, one click to put each on air. */
export function RundownPanel({ scene, update, state }: Props) {
  const { rundown } = state;
  const current = onAirIndex(rundown, scene);
  const take = (index: number) => takeItem(update, state, index);

  return (
    <section className="col" data-testid="rundown-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="title-small">{state.show?.name ?? 'Daily rundown'}</h3>
        <Button variant="text" icon="refresh" onClick={state.generate} disabled={state.generating} data-testid="rundown-generate">
          {state.generating ? 'Making…' : 'Generate now'}
        </Button>
      </div>

      {state.generating && (
        <div className="row body-medium" data-testid="rundown-generating">
          <Spinner size={24} />
          <span>Collecting today's AI news and writing the show. This takes a few minutes.</span>
        </div>
      )}
      {state.error && !state.generating && <p className="body-medium" style={{ color: 'var(--md-sys-color-error)' }}>{state.error}</p>}
      {state.loading && <p className="body-medium muted">Loading the rundown…</p>}
      {!rundown && !state.loading && !state.generating && !state.error && (
        <p className="body-medium muted">Today's rundown is made at 5 PM IST. Press Generate now to make one from the latest news.</p>
      )}

      {rundown && (
        <>
          <div className="row wrap" style={{ gap: 8 }}>
            {state.dates.length > 1 && (
              <Select label="Day" value={rundown.date} onValue={state.pick} options={state.dates.map((date) => ({ value: date, label: date }))} floatingMenu style={{ flex: 1, minWidth: 150 }} data-testid="rundown-date" />
            )}
            <span className="chip"><Icon name="schedule" /> {formatDuration(rundownSeconds(rundown))}</span>
            <a className="chip" href={`/rundown/${rundown.date}`} target="_blank" rel="noreferrer" data-testid="rundown-full">
              <Icon name="description" /> Full script
            </a>
          </div>
          {rundown.model === null && <p className="body-small muted">This rundown has headlines and links but no spoken script.</p>}
          {rundown.warnings.length > 0 && (
            <details className="body-small muted">
              <summary>{rundown.warnings.length === 1 ? '1 note' : `${rundown.warnings.length} notes`} about how it was made</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {rundown.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </details>
          )}

          <div className="col" style={{ gap: 6 }}>
            {rundown.items.map((item, index) => {
              const onAir = index === current;
              return (
                <div key={item.id} className={`banner-item rundown-item ${onAir ? 'shown' : ''}`}>
                  <button type="button" className="banner-toggle" aria-pressed={onAir} data-testid="rundown-item" onClick={() => take(index)}>
                    <span className="rundown-number label-medium">{index + 1}</span>
                    <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
                      <span className="label-small" style={{ opacity: 0.75 }}>{item.tag} · {formatDuration(item.seconds)}</span>
                      <span className="body-medium rundown-headline">{item.headline}</span>
                    </span>
                    {onAir && <span className="chip primary">On air</span>}
                  </button>
                  {onAir && <Sources item={item} extra={state.extraSources[item.id] ?? []} scene={scene} update={update} onAdd={(url) => state.addSource(item.id, url)} />}
                </div>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Button variant="tonal" icon="skip_previous" onClick={() => take(current - 1)} disabled={current <= 0} data-testid="rundown-prev">
              Previous
            </Button>
            <Button icon="skip_next" onClick={() => take(current + 1)} disabled={current >= rundown.items.length - 1} data-testid="rundown-next">
              {current < 0 ? 'Start the show' : 'Next'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
