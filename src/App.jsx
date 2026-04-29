import React, { useState, useCallback } from 'react';
import Login from './auth/Login';
import Sidebar from './ui/Sidebar';
import BomTree from './bom/BomTree';
import SettingsModal from './settings/SettingsModal';
import { ToastProvider, useToast } from './ui/Toast';
import { getAuth, getUser, signOut as apiSignOut } from './api/orcanosClient';

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

function AppShell() {
  const [auth, setAuth] = useState(() => !!getAuth());
  const [username, setUsername] = useState(() => getUser() || '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped after a successful login or sign-out so children can reset.
  const [authEpoch, setAuthEpoch] = useState(0);
  const { showToast } = useToast();

  // ─── Login / sign-out handlers ──────────────────────────────────────────
  const handleLoginSuccess = useCallback((user) => {
    setUsername(user);
    setAuth(true);
    setAuthEpoch((e) => e + 1);
  }, []);

  const handleSignOut = useCallback(() => {
    apiSignOut();
    setAuth(false);
    setUsername('');
    setAuthEpoch((e) => e + 1);
  }, []);

  // 401 anywhere in the app → bounce to login.
  const handleAuthExpired = useCallback(
    (msg) => {
      apiSignOut();
      setAuth(false);
      setUsername('');
      setAuthEpoch((e) => e + 1);
      showToast(msg || 'Your session expired — please sign in again.', 'error');
    },
    [showToast]
  );

  if (!auth) {
    return <Login onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        username={username}
        onOpenSettings={() => setSettingsOpen(true)}
        onSignOut={handleSignOut}
      />
      <main className="app-main">
        <BomTree key={authEpoch} onAuthExpired={handleAuthExpired} />
      </main>
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
