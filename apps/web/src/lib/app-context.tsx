import type { ServerConfigDto, UserDto } from '@studio/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, errorMessage } from './api';

// ---------- Toasts (M3 snackbar) ----------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface ToastApi {
  show(text: string): void;
  error(err: unknown): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside AppProviders');
  return ctx;
}

// ---------- Auth and server config ----------

interface AuthState {
  /** undefined while the first /me call is in flight. */
  user: UserDto | null | undefined;
  config: ServerConfigDto | null;
  setUser(user: UserDto | null): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AppProviders');
  return ctx;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, kind: Toast['kind']) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);
  const toastApi = useMemo<ToastApi>(
    () => ({ show: (text) => push(text, 'info'), error: (err) => push(errorMessage(err), 'error') }),
    [push],
  );

  const [user, setUser] = useState<UserDto | null | undefined>(undefined);
  const [config, setConfig] = useState<ServerConfigDto | null>(null);
  useEffect(() => {
    api.me().then((res) => setUser(res.user), () => setUser(null));
    api.config().then(setConfig, () => undefined);
  }, []);
  const auth = useMemo(() => ({ user, config, setUser }), [user, config]);

  return (
    <AuthContext.Provider value={auth}>
      <ToastContext.Provider value={toastApi}>
        {children}
        <div className="snackbar-host" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`snackbar body-medium ${toast.kind === 'error' ? 'error' : ''}`}>
              {toast.text}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}

// ---------- Small data hook ----------

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  reload(): void;
  setData(next: T): void;
}

/** Fetch-on-mount with reload. Enough for this app; no cache layer needed. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && (setData(value), setError(null)),
      (err) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((n) => n + 1), setData };
}

// ---------- Theme ----------

export type ThemeChoice = 'system' | 'light' | 'dark';

export function useTheme(): [ThemeChoice, () => void] {
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const cycle = () => {
    const next: ThemeChoice = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    if (next === 'system') {
      localStorage.removeItem('theme');
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem('theme', next);
      document.documentElement.dataset.theme = next;
    }
  };
  return [theme, cycle];
}

export const THEME_ICON: Record<ThemeChoice, string> = {
  system: 'routine',
  light: 'light_mode',
  dark: 'dark_mode',
};
