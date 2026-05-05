import React, { useState, useCallback } from 'react';
import Login from './auth/Login';
import { useIdleTimeout } from './auth/useIdleTimeout';
import Sidebar from './ui/Sidebar';
import BomTree from './bom/BomTree';
import SettingsModal from './settings/SettingsModal';
import ReleaseNotesModal from './release/ReleaseNotesModal';
import { ToastProvider, useToast } from './ui/Toast';
import {
  getAuth,
  getUser,
  signOut as apiSignOut,
  whereUsedFilterBy,
} from './api/orcanosClient';
import { getSettings } from './settings/settingsStore';

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
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  // Active main-view: 'boms' (BOM Filter) or 'parts' (Part Catalog filter).
  // Both views share BomTree — only the top filter ID and label differ.
  const [view, setView] = useState(
    () => localStorage.getItem('covaris_view') || 'boms'
  );
  // Where-Used target: { id, label } when active, null otherwise. When set,
  // BomTree renders the BOMs that contain that part, and offers a Locate
  // button on each root. Cleared by the back banner.
  const [whereUsedTarget, setWhereUsedTarget] = useState(null);
  // Bumped after a successful login or sign-out so children can reset.
  const [authEpoch, setAuthEpoch] = useState(0);
  const [idleMinutes, setIdleMinutes] = useState(null);
  const { showToast } = useToast();

  // Switching the sidebar view also exits Where-Used (we'd otherwise show
  // where-used results under the wrong view label).
  const handleSelectView = useCallback((nextView) => {
    setWhereUsedTarget(null);
    setView(nextView);
    localStorage.setItem('covaris_view', nextView);
  }, []);

  const handleWhereUsed = useCallback((node) => {
    // Two values get captured per Where-Used target:
    //
    // 1. `sqlArg` — passed to dbo.fn_GetRootParentByCS21(<sqlArg>) inside
    //    the Filter_By override. Per spec:
    //      PRT click → the part's own ID (itemId).
    //      PI  click → cs21Int (the numeric ID extracted from Master Part Source).
    //    cs21Raw is NOT used here because it can fall back to Display_text, which
    //    is the long "PRT-37679-600244 Label…" label rather than a bare ID.
    //
    // 2. `cs21Int` — the integer Locate uses to match descendants by their
    //    own cs21Int. Both PRT.itemId and the integer pulled from CS21
    //    represent the same source-PRT id.
    const isPart = node.row.type === 'PRT';
    const sqlArg = isPart
      ? String(node.row.itemId || '').trim()
      : String(node.row.cs21Int || '').trim();
    const cs21Int = isPart
      ? String(node.row.itemId || '').trim()
      : node.row.cs21Int || '';
    setWhereUsedTarget({
      sqlArg,
      cs21Int,
      label: node.row.objName || `#${sqlArg}`,
    });
  }, []);

  const handleExitWhereUsed = useCallback(() => setWhereUsedTarget(null), []);

  // ─── Login / sign-out handlers ──────────────────────────────────────────
  const handleLoginSuccess = useCallback((user, idleMin) => {
    setUsername(user);
    setAuth(true);
    setIdleMinutes(idleMin || null);
    setAuthEpoch((e) => e + 1);
  }, []);

  const handleSignOut = useCallback(() => {
    apiSignOut();
    setAuth(false);
    setUsername('');
    setIdleMinutes(null);
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

  useIdleTimeout({
    idleMinutes: auth ? idleMinutes : null,
    onIdle: () => handleAuthExpired('You were signed out due to inactivity.'),
  });

  if (!auth) {
    return <Login onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        username={username}
        view={view}
        onSelectView={handleSelectView}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenReleaseNotes={() => setReleaseNotesOpen(true)}
        onSignOut={handleSignOut}
      />
      <main className="app-main">
        {(() => {
          const s = getSettings();
          const isBoms = view === 'boms';
          const wuActive = !!whereUsedTarget;
          // The main BomTree (BOMs / Part Catalog) stays mounted whenever
          // Where Used is active — we just hide it with `display:none` so its
          // pagination, search, expanded subtrees and child cache survive a
          // round-trip into Where Used and back. The Where Used tree mounts
          // alongside, only while active; clicking Back unmounts it and the
          // hidden main tree reappears in its previous state.
          return (
            <>
              <div
                className="app-main-pane"
                style={{ display: wuActive ? 'none' : 'contents' }}
              >
                <BomTree
                  key={`main/${view}/${authEpoch}`}
                  onAuthExpired={handleAuthExpired}
                  view={view}
                  topFilterId={isBoms ? s.bomFilterId : s.partCatalogFilterId}
                  topLabel={isBoms ? 'BOMs' : 'Parts'}
                  onWhereUsed={handleWhereUsed}
                />
              </div>
              {wuActive && (
                <BomTree
                  key={`wu/${authEpoch}/${whereUsedTarget.sqlArg}`}
                  onAuthExpired={handleAuthExpired}
                  view="boms"
                  topFilterId={s.bomFilterId}
                  topLabel="BOMs"
                  topFilterByOverride={whereUsedFilterBy(
                    whereUsedTarget.sqlArg
                  )}
                  targetOriginalId={whereUsedTarget.sqlArg}
                  targetCs21Int={whereUsedTarget.cs21Int}
                  whereUsedLabel={whereUsedTarget.label}
                  onExitWhereUsed={handleExitWhereUsed}
                  onWhereUsed={handleWhereUsed}
                />
              )}
            </>
          );
        })()}
      </main>
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
      {releaseNotesOpen && (
        <ReleaseNotesModal onClose={() => setReleaseNotesOpen(false)} />
      )}
    </div>
  );
}
