import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadSettings } from './settings/settingsStore';
import './styles/design-system.css';
import './App.css';

// Load settings.xml before rendering — the app expects synchronous access
// to settings (baseUrl, filter IDs) on first paint.
async function bootstrap() {
  try {
    await loadSettings();
  } catch (err) {
    // If settings fail to load we still render — the app will surface the
    // error via the toast and the user can retry.
    console.error('Failed to load settings.xml:', err);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
