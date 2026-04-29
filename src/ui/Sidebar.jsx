import React, { useEffect, useRef, useState } from 'react';
import './Sidebar.css';

export default function Sidebar({
  username,
  view,
  onSelectView,
  onOpenSettings,
  onOpenReleaseNotes,
  onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close the user menu on click-outside or Esc.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function pick(handler) {
    return () => {
      setMenuOpen(false);
      handler?.();
    };
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-logo">B</div>
          <span className="brand-name">Covaris BOM Viewer</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={
            'sidebar-item' + (view === 'boms' ? ' sidebar-item--active' : '')
          }
          type="button"
          onClick={() => onSelectView('boms')}
        >
          <span className="sidebar-item-icon">📋</span>
          <span>BOMs</span>
        </button>
        <button
          className={
            'sidebar-item' + (view === 'parts' ? ' sidebar-item--active' : '')
          }
          type="button"
          onClick={() => onSelectView('parts')}
        >
          <span className="sidebar-item-icon">🧩</span>
          <span>Part Catalog</span>
        </button>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer" ref={wrapRef}>
        {menuOpen && (
          <div className="sidebar-user-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={pick(onOpenSettings)}
            >
              <span className="sidebar-item-icon">⚙</span>
              <span>Settings</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={pick(onOpenReleaseNotes)}
            >
              <span className="sidebar-item-icon">📝</span>
              <span>Release Notes</span>
            </button>
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={pick(onSignOut)}
            >
              <span className="sidebar-item-icon">↩</span>
              <span>Sign out</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className={'sidebar-user' + (menuOpen ? ' sidebar-user--open' : '')}
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="sidebar-user-icon">👤</span>
          <span className="sidebar-user-name" title={username}>{username}</span>
          <span className="sidebar-user-chevron" aria-hidden="true">
            {menuOpen ? '▾' : '▴'}
          </span>
        </button>
      </div>
    </aside>
  );
}
