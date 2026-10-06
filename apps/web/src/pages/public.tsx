import { APP_NAME, PLATFORMS, type PlatformId } from '@studio/shared';
import { Button, Icon, IconButton, Spinner, TextField, type ButtonProps } from '@studio/ui';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { THEME_ICON, useAuth, useLoad, useTheme } from '../lib/app-context';
import { formatBytes, formatDateTime } from '../lib/format';
import { PlatformBadge } from '../studio/dialogs';

export function Logo() {
  return (
    <Link to="/" className="logo">
      <img src="/favicon.svg" alt="" width={32} height={32} />
      <span className="title-large">{APP_NAME}</span>
    </Link>
  );
}

/** A Material button that navigates inside the app without a page reload. */
export function LinkButton({ to, ...props }: Omit<ButtonProps, 'href' | 'onClick'> & { to: string }) {
  const navigate = useNavigate();
  return (
    <Button
      {...props}
      href={to}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}

export function ThemeButton() {
  const [theme, cycle] = useTheme();
  return <IconButton icon={THEME_ICON[theme]} label={`Theme: ${theme}`} onClick={cycle} />;
}

const FEATURES = [
  { icon: 'cell_tower', title: 'One stream, every platform', text: 'Go live to YouTube, Twitch, Facebook, LinkedIn, X and Instagram at the same time from one studio.' },
  { icon: 'group_add', title: 'Guests join with a link', text: 'Send an invite link. Guests join from their browser with no account and no download.' },
  { icon: 'dashboard_customize', title: 'Layouts that fit the moment', text: 'Solo, grid, spotlight, picture in picture and screen layouts, switched with one click while live.' },
  { icon: 'present_to_all', title: 'Share anything', text: 'Share your screen with audio, show an image, or play a video clip to your audience.' },
  { icon: 'palette', title: 'Your brand on screen', text: 'Brand colour, logo, overlays, lower-third banners and a scrolling ticker.' },
  { icon: 'forum', title: 'Bring viewers into the show', text: 'Read Twitch and YouTube comments in the studio and put the best ones on screen.' },
];

const HERO_PLATFORMS: PlatformId[] = ['youtube', 'twitch', 'facebook', 'linkedin', 'x', 'instagram'];

export function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <header className="public-bar">
        <Logo />
        <span className="grow" />
        <ThemeButton />
        {user ? (
          <LinkButton to="/app" icon="dashboard">Dashboard</LinkButton>
        ) : (
          <>
            <LinkButton variant="text" to="/login">Sign in</LinkButton>
            <LinkButton to="/signup">Get started</LinkButton>
          </>
        )}
      </header>

      <section className="hero">
        <h1 className="display">Your live show, on every platform at once</h1>
        <p className="title-large muted">
          A studio in your browser. Invite guests, share your screen, add your brand, and stream to
          all your channels together.
        </p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <LinkButton to={user ? '/app' : '/signup'} icon="sensors">Start streaming</LinkButton>
          <Button variant="outlined" href="#features">See what it does</Button>
        </div>
        <div className="row wrap" style={{ justifyContent: 'center', marginTop: 16 }}>
          {HERO_PLATFORMS.map((id) => (
            <span key={id} className="chip" style={{ height: 36, paddingLeft: 4 }}>
              <PlatformBadge platform={id} size={28} />
              {PLATFORMS[id].name}
            </span>
          ))}
        </div>
      </section>

      <section id="features" className="feature-grid">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="card col">
            <span className="feature-icon"><Icon name={feature.icon} /></span>
            <h2 className="title-large">{feature.title}</h2>
            <p className="body-large muted">{feature.text}</p>
          </article>
        ))}
      </section>

      <footer className="body-medium muted" style={{ textAlign: 'center', padding: 32 }}>
        {APP_NAME} · Built with Material Design 3
      </footer>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user, config, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(params.get('error') ? 'Google sign-in did not complete. Try again.' : '');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;
  const isSignup = mode === 'signup';

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(isSignup ? await api.signup({ name, email, password }) : await api.login({ email, password }));
      navigate('/app');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card outlined col auth-card" onSubmit={submit}>
        <Logo />
        <div>
          <h1 className="headline">{isSignup ? 'Create your account' : 'Sign in'}</h1>
          <p className="body-large muted">{isSignup ? 'Start streaming in a minute.' : 'Welcome back.'}</p>
        </div>
        {config?.oauth.google && (
          <Button variant="outlined" href="/api/auth/google/start" icon="account_circle">Continue with Google</Button>
        )}
        {isSignup && <TextField label="Name" value={name} onValue={setName} required autoComplete="name" data-testid="name" />}
        <TextField label="Email" type="email" value={email} onValue={setEmail} required autoComplete="email" data-testid="email" />
        <TextField
          label="Password"
          type="password"
          value={password}
          onValue={setPassword}
          required
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          supportingText={isSignup ? 'At least 8 characters' : undefined}
          data-testid="password"
        />
        {error && <p className="body-medium" role="alert" style={{ color: 'var(--md-sys-color-error)' }}>{error}</p>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link to={isSignup ? '/login' : '/signup'} className="label-large">
            {isSignup ? 'I already have an account' : 'Create account'}
          </Link>
          <Button type="submit" disabled={busy} data-testid="submit">
            {isSignup ? 'Create account' : 'Sign in'}
          </Button>
        </div>
      </form>
    </main>
  );
}

/** Public page for a shared recording link. */
export function WatchPage() {
  const { token = '' } = useParams();
  const recording = useLoad(() => api.watch(token), [token]);
  const src = `/api/watch/${token}/video`;

  return (
    <div className="landing">
      <header className="public-bar">
        <Logo />
        <span className="grow" />
        <ThemeButton />
      </header>
      <main className="watch">
        {recording.error ? (
          <p className="title-large">This recording is not available.</p>
        ) : !recording.data ? (
          <Spinner />
        ) : (
          <>
            <video src={src} controls playsInline className="watch-video" />
            <div className="row wrap">
              <div className="grow">
                <h1 className="headline">{recording.data.title}</h1>
                <p className="body-large muted">
                  {formatDateTime(recording.data.createdAt)} · {formatBytes(recording.data.sizeBytes)}
                </p>
              </div>
              <Button variant="tonal" icon="download" href={`${src}?download=1`}>Download</Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
