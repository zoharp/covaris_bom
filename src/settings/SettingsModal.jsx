import React, { useEffect } from 'react';
import { getSettings, getApiUrl, getWebUrlPreview } from './settingsStore';
import './SettingsModal.css';

export default function SettingsModal({ onClose }) {
  // Esc to close.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = getSettings();
  const apiUrl = getApiUrl();
  const webUrl = getWebUrlPreview();

  return (
    <div
      className="settings-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="settings-note">
          Settings are configured by the administrator. To change them, edit
          {' '}<code>public/settings.xml</code>{' '}— and if changing
          {' '}<code>baseUrl</code>{' '}also update the matching rewrite in
          {' '}<code>vercel.json</code>{' '}— then redeploy.
        </div>

        <div className="settings-body">
          <Field label="Base URL" value={s.baseUrl} mono />
          <Field label="Version ID" value={String(s.versionId)} />
          <Field label="BOM Filter ID" value={String(s.bomFilterId)} />
          <Field label="Instance Filter ID" value={String(s.instanceFilterId)} />

          <div className="settings-divider" />

          <Field label="API URL" value={apiUrl} mono />
          <Field label="Web URL preview" value={webUrl} mono />
        </div>

        <div className="settings-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">{label}</div>
      <div className={'settings-field-value' + (mono ? ' mono' : '')}>
        {value || <span className="settings-field-empty">—</span>}
      </div>
    </div>
  );
}
