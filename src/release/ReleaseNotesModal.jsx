import React, { useEffect } from 'react';
import notes from '../../release_notes.json';
import pkg from '../../package.json';
import './ReleaseNotesModal.css';

function renderChange(text) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p);
}

export default function ReleaseNotesModal({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="release-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="release-modal" onClick={(e) => e.stopPropagation()}>
        <div className="release-header">
          <h2>Release Notes</h2>
          <span className="release-current-version">v{pkg.version}</span>
          <button
            type="button"
            className="release-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="release-body">
          {notes.length === 0 && (
            <p className="release-empty">No release notes yet.</p>
          )}
          {notes.map((entry) => (
            <div key={entry.version} className="release-entry">
              <div className="release-entry-head">
                <span className="release-entry-version">v{entry.version}</span>
                <span className="release-entry-date">{entry.date}</span>
              </div>
              <ul className="release-entry-changes">
                {entry.changes.map((c, i) => (
                  <li key={i}>{renderChange(c)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="release-footer">
          <div className="release-legend">
            {[
              ['✨', 'New'],
              ['🐛', 'Fix'],
              ['🔄', 'Update'],
              ['⚡', 'Performance'],
              ['🗑️', 'Removed'],
            ].map(([icon, label]) => (
              <span key={label} className="release-legend-item">
                {icon} {label}
              </span>
            ))}
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
