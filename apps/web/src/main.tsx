import '@studio/ui/tokens.css';
import '@studio/ui/components.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProviders } from './lib/app-context';
import { AppShell, BroadcastsPage, DestinationsPage, RecordingsPage } from './pages/dashboard';
import { AuthPage, Landing, WatchPage } from './pages/public';
import { GuestJoinPage, HostStudioPage, RenderPage } from './pages/studio-pages';

// StrictMode is left off on purpose: its double-mounted effects would join the LiveKit room twice.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AppProviders>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<BroadcastsPage />} />
          <Route path="destinations" element={<DestinationsPage />} />
          <Route path="recordings" element={<RecordingsPage />} />
        </Route>
        <Route path="/studio/:id" element={<HostStudioPage />} />
        <Route path="/join/:token" element={<GuestJoinPage />} />
        <Route path="/watch/:token" element={<WatchPage />} />
        <Route path="/render" element={<RenderPage />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </AppProviders>
  </BrowserRouter>,
);
