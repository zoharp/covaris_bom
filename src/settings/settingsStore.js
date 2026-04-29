// Settings store — loads `public/settings.xml` once at app start and exposes
// the values synchronously. There is NO in-app editing: to change settings,
// edit `public/settings.xml` and redeploy.

const FALLBACK = {
  baseUrl: 'https://us.orcanos.com/covaris/',
  versionId: 5,
  bomFilterId: 519,
  instanceFilterId: 520,
};

let _settings = null;

function parseXml(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');

  // DOMParser returns a document with a `<parsererror>` element on failure
  // rather than throwing — check for it explicitly.
  if (xml.querySelector('parsererror')) {
    throw new Error('settings.xml is not valid XML');
  }

  const get = (tag) => xml.querySelector(tag)?.textContent?.trim() ?? '';
  const getInt = (tag, fallback) => {
    const raw = get(tag);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  let baseUrl = get('baseUrl') || FALLBACK.baseUrl;
  // Always end the base URL with a slash — downstream URL builders rely on it.
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  return {
    baseUrl,
    versionId: getInt('versionId', FALLBACK.versionId),
    bomFilterId: getInt('bomFilterId', FALLBACK.bomFilterId),
    instanceFilterId: getInt('instanceFilterId', FALLBACK.instanceFilterId),
  };
}

export async function loadSettings() {
  try {
    const resp = await fetch('/settings.xml', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`settings.xml fetch failed (${resp.status})`);
    const text = await resp.text();
    _settings = parseXml(text);
  } catch (err) {
    console.warn(
      'Falling back to compiled-in default settings. Reason:',
      err.message
    );
    _settings = { ...FALLBACK };
  }
  return _settings;
}

export function getSettings() {
  if (!_settings) {
    // Defensive — `loadSettings()` should have run before any caller hits this.
    return { ...FALLBACK };
  }
  return _settings;
}

// Computed display strings — used by the Settings modal viewer.
export function getApiUrl() {
  return `${getSettings().baseUrl}api/v2/Json/`;
}

export function getWebUrlPreview() {
  const { baseUrl, versionId } = getSettings();
  return `${baseUrl}web/${versionId}/items/view?Item=PRT&ItemId=12345`;
}
