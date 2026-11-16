import type { LiveKitSettingsDto } from '@studio/shared';
import { Button, Icon, Spinner, TextField } from '@studio/ui';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLoad, useToast } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

const SOURCE: Record<
  LiveKitSettingsDto['source'],
  { label: string; className: string; text: string }
> = {
  account: {
    label: 'Your project',
    className: 'success',
    text: 'Your studios, and the guests you invite, connect through this LiveKit project.',
  },
  server: {
    label: 'Server default',
    className: 'primary',
    text: "Your studios use this server's LiveKit project. Save your own below to use it instead.",
  },
  none: {
    label: 'Not set',
    className: 'error',
    text: 'Add a LiveKit project before you open a studio. LiveKit carries the cameras, microphones and guests.',
  },
};

/** /app/settings: the account's own LiveKit project (e.g. LiveKit Cloud). */
export function SettingsPage() {
  const toast = useToast();
  const settings = useLoad(() => api.livekitSettings());
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from what is saved; the secret is never sent back, so it is always typed again.
  const current = settings.data;
  useEffect(() => {
    if (current?.source === 'account') {
      setUrl(current.url ?? '');
      setApiKey(current.apiKey ?? '');
    }
  }, [current]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      settings.setData(await api.saveLivekitSettings({ url, apiKey, apiSecret }));
      setApiSecret('');
      toast.show('LiveKit project saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      settings.setData(await api.deleteLivekitSettings());
      setUrl('');
      setApiKey('');
      setApiSecret('');
      toast.show('LiveKit project removed');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  if (!current)
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  const source = SOURCE[current.source];
  const complete = url.trim() && apiKey.trim() && apiSecret.trim();

  return (
    <>
      <div className="row wrap page-header">
        <div className="grow">
          <h1 className="headline">Settings</h1>
          <p className="body-large muted">Where your studio's video runs.</p>
        </div>
      </div>

      <div>
        <section
          className="card outlined col"
          style={{ padding: 24, gap: 16, maxWidth: 640 }}
          data-testid="livekit-settings"
        >
          <div className="row">
            <Icon name="hub" />
            <h2 className="title-large grow">LiveKit project</h2>
            <span className={`chip ${source.className}`} data-testid="livekit-source">
              {source.label}
            </span>
          </div>
          <p className="body-medium muted">{source.text}</p>
          {current.url && (
            <p className="body-medium">
              <span className="muted">Connected to </span>
              <code>{current.url}</code>
              {current.updatedAt && (
                <span className="muted"> · saved {formatDateTime(current.updatedAt)}</span>
              )}
            </p>
          )}

          <p className="body-medium muted">
            Create a free project at{' '}
            <a href="https://cloud.livekit.io" target="_blank" rel="noreferrer">
              cloud.livekit.io
            </a>
            , then open <b>Settings → API keys</b> and copy the WebSocket URL, the API key and the
            API secret.
          </p>
          <TextField
            label="WebSocket URL"
            type="url"
            value={url}
            onValue={setUrl}
            mono
            placeholder="wss://your-project.livekit.cloud"
            autoComplete="off"
            data-testid="livekit-url"
          />
          <TextField
            label="API key"
            value={apiKey}
            onValue={setApiKey}
            mono
            autoComplete="off"
            maxLength={200}
            data-testid="livekit-key"
          />
          <TextField
            label="API secret"
            type="password"
            value={apiSecret}
            onValue={setApiSecret}
            mono
            autoComplete="new-password"
            maxLength={500}
            supportingText={
              current.source === 'account'
                ? 'Stored encrypted and never shown again. Enter it again to change the project.'
                : 'Stored encrypted. It is never shown again or sent to a browser.'
            }
            onEnter={() => complete && void save()}
            data-testid="livekit-secret"
          />
          {error && (
            <p className="body-medium" role="alert" style={{ color: 'var(--md-sys-color-error)' }}>
              {error}
            </p>
          )}
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            {current.source === 'account' && (
              <Button variant="text" icon="delete" onClick={() => void remove()} disabled={busy}>
                Remove
              </Button>
            )}
            <Button
              icon="check"
              onClick={() => void save()}
              disabled={busy || !complete}
              data-testid="livekit-save"
            >
              {busy ? 'Checking…' : 'Test and save'}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
