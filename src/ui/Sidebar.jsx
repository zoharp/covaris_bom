import React from 'react';
import './Sidebar.css';

export default function Sidebar({
  username,
  onOpenSettings,
  onOpenReleaseNotes,
  onSignOut,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-logo">B</div>
          <span className="brand-name">Covaris BOM Viewer</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className="sidebar-item sidebar-item--active" type="button">
          <span className="sidebar-item-icon">📋</span>
          <span>BOMs</span>
        </button>
        <button
          className="sidebar-item"
          type="button"
          onClick={onOpenReleaseNotes}
        >
          <span className="sidebar-item-icon">📝</span>
          <span>Release Notes</span>
        </button>
        <button
          className="sidebar-item"
          type="button"
          onClick={onOpenSettings}
        >
          <span className="sidebar-item-icon">⚙</span>
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-icon">👤</span>
          <span className="sidebar-user-name" title={username}>{username}</span>
        </div>
        <button
          className="sidebar-signout"
          type="button"
          onClick={onSignOut}
        >
          <span className="sidebar-item-icon">↩</span>
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
