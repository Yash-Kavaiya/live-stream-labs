import { rundownSeconds } from '@studio/shared';
import { Button, Spinner } from '@studio/ui';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useLoad } from '../lib/app-context';
import { formatDuration } from '../lib/format';

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** /rundown/:date, the whole day's show on one page, for reading ahead or printing. */
export function RundownPage() {
  const { date = '' } = useParams();
  const { user } = useAuth();
  const rundown = useLoad(() => api.rundown(date), [date]);

  if (user === null) return <Navigate to="/login" replace />;
  if (rundown.error) {
    return (
      <main className="script-page">
        <h1 className="headline">There is no rundown for this day</h1>
        <p className="body-large muted">{rundown.error}</p>
      </main>
    );
  }
  if (!rundown.data) return <main className="center" style={{ height: '100%' }}><Spinner /></main>;

  const { items, warnings, model } = rundown.data;
  return (
    <main className="script-page" data-testid="rundown-page">
      <header className="col" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 className="headline">Rundown for {longDate(date)}</h1>
          <span className="no-print">
            <Button variant="tonal" icon="print" onClick={() => window.print()}>Print</Button>
          </span>
        </div>
        <p className="body-large muted">
          {items.length} items · about {formatDuration(rundownSeconds(rundown.data))} of speaking
          {model ? ` · written by ${model}` : ' · headlines and links only, no spoken script'}
        </p>
        {warnings.length > 0 && (
          <ul className="body-medium muted">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
      </header>

      {items.map((item, index) => (
        <article key={item.id} className="script-item">
          <p className="label-large script-tag">{index + 1}. {item.tag} · {formatDuration(item.seconds)}</p>
          <h2 className="title-large">{item.headline}</h2>
          {item.subhead && <p className="title-medium muted">{item.subhead}</p>}

          {item.script ? (
            <div className="script-text">
              {item.script.split(/\n+/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}
            </div>
          ) : (
            <p className="body-large muted">No script was written for this item.</p>
          )}

          {item.points && (
            <>
              <h3 className="label-large">On screen</h3>
              <ul className="body-large">
                {item.points.split('\n').filter(Boolean).map((point) => <li key={point}>{point}</li>)}
              </ul>
            </>
          )}
          {item.context && (
            <>
              <h3 className="label-large">Background</h3>
              <p className="body-large">{item.context}</p>
            </>
          )}
          {item.sources.length > 0 && (
            <>
              <h3 className="label-large">Show on screen</h3>
              <ul className="body-large">
                {item.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> <span className="muted">({source.site})</span>
                    {source.quote && <div className="muted">“{source.quote}”</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      ))}
    </main>
  );
}
