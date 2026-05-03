import React, { useState } from 'react';
import { login as apiLogin } from '../api/orcanosClient';
import { useToast } from '../ui/Toast';
import './Login.css';

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const res = await apiLogin(username.trim(), password);
    setSubmitting(false);

    if (res.ok) {
      onSuccess(username.trim());
    } else {
      showToast(res.error, 'error');
    }
  }

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="login-brand-icon">
            <img src="/orcanos-icon.png" alt="Orcanos" />
          </span>
          <span className="login-brand-name">BOM Viewer</span>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">
          Use your Orcanos username and password to continue.
        </p>

        <div className="login-field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="login-input"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            autoFocus
            required
          />
        </div>

        <div className="login-field">
          <label htmlFor="password">Password</label>
          <div className="login-input-wrap">
            <input
              id="password"
              className="login-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
            <button
              type="button"
              className="login-input-eye"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="login-submit-btn"
          disabled={submitting || !username || !password}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-footer">
          Authenticated against Orcanos at <code>us.orcanos.com/covaris/</code>.
        </p>
        <p className="login-version">v{__APP_VERSION__}</p>
      </form>
    </div>
  );
}
