// Orcanos REST API client.
//
// All Orcanos API calls live here. Other modules import these functions
// rather than calling fetch() directly — this keeps auth/error handling
// in one place.
//
// Endpoints documented at: https://help.orcanos.com/knowledgebase/

import { getSettings } from '../settings/settingsStore';

// ─── Local-storage keys ───────────────────────────────────────────────────
const LS_AUTH = 'covaris_auth';     // "Basic <base64(user:pass)>"
const LS_USER = 'covaris_user';     // username for display

// In dev (Vite proxy) and prod (Vercel rewrite), `/api/orcanos/...` maps to
// the upstream Orcanos REST endpoint at us.orcanos.com/covaris/api/v2/Json/.
// Set USE_PROXY=false to call Orcanos directly — but Orcanos must allow CORS
// from the app origin for that to work, which it usually doesn't.
//
// Important: when USE_PROXY=true, the API target is hard-coded in
//   - vite.config.js (dev)
//   - vercel.json    (prod)
// and the `baseUrl` from settings.xml is NOT used for API calls. It is still
// used for `orcanosItemUrl()` (the "Orcanos Link" column), since those are
// direct browser navigations to Orcanos's web UI, not API calls.
//
// To change the API target: update vite.config.js and vercel.json. The XML
// `baseUrl` should be kept in sync for the link-column to point at the same
// environment. The Settings modal note tells admins to do this.
const USE_PROXY = true;

function apiBase() {
  if (USE_PROXY) return '/api/orcanos/';
  return `${getSettings().baseUrl}api/v2/Json/`;
}

// Encode a string as UTF-8 bytes, then base64. btoa() alone fails on any
// non-ASCII character — usernames and passwords in production environments
// can contain accented or extended characters.
function utf8ToBase64(s) {
  // TextEncoder always produces UTF-8 bytes regardless of the input string.
  const bytes = new TextEncoder().encode(s);
  // String.fromCharCode in chunks to avoid stack overflow on very long inputs.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK)
    );
  }
  return btoa(bin);
}

// ─── Public API ───────────────────────────────────────────────────────────

export class OrcanosError extends Error {
  constructor(httpCode, message) {
    super(message || `Orcanos error ${httpCode}`);
    this.httpCode = httpCode;
  }
}

/**
 * Authenticate with Orcanos. The user's username and password are encoded
 * as Basic auth and stored in localStorage on success.
 *
 * Returns:
 *   { ok: true,  user, projects }     on success
 *   { ok: false, error }              on failure
 */
export async function login(username, password) {
  if (!username || !password) {
    return { ok: false, error: 'Please enter both username and password.' };
  }

  // Build the auth header from the credentials the user just typed.
  // btoa() throws on non-ASCII characters (e.g. accented passwords), so
  // we encode through UTF-8 first and then base64.
  const authHeader = 'Basic ' + utf8ToBase64(`${username}:${password}`);

  try {
    const resp = await fetch(apiBase() + 'QW_Login', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // 401: bad credentials.
    if (resp.status === 401) {
      return { ok: false, error: 'Invalid username or password.' };
    }
    if (!resp.ok) {
      return { ok: false, error: `Login failed (HTTP ${resp.status})` };
    }

    const data = await resp.json();
    if (!data.IsSuccess) {
      return {
        ok: false,
        error: data.Message || data.Data || 'Login failed.',
      };
    }

    // Store ONLY the encoded header — never the plaintext password.
    localStorage.setItem(LS_AUTH, authHeader);
    localStorage.setItem(LS_USER, username);

    return {
      ok: true,
      user: data.Data?.User_details ?? { User_name: username },
      projects: data.Data?.Projects ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Orcanos (${err.message}).`,
    };
  }
}

/** Returns the stored credential header, or null. */
export function getAuth() {
  return localStorage.getItem(LS_AUTH);
}

/** Returns the stored username, or null. */
export function getUser() {
  return localStorage.getItem(LS_USER);
}

/** Clears stored credentials. The caller should also reset app state. */
export function signOut() {
  localStorage.removeItem(LS_AUTH);
  localStorage.removeItem(LS_USER);
}

/**
 * Fetch top-level BOMs.
 *
 *   { rows, total }   on success
 *
 * Throws `OrcanosError` on failure.
 */
export async function fetchBoms({
  filterId,
  versionId,
  page = 1,
  pageSize = 200,
} = {}) {
  const { bomFilterId, versionId: defaultVersion } = getSettings();
  const body = {
    Filter_id: filterId ?? bomFilterId,
    Page_no: page,
    Page_Size: pageSize,
    Item_Type: 'PRT',
    Version_id: versionId ?? defaultVersion,
    IsNewPaging: 1,
    IsReturnPageCount: 1,
  };
  return await _fetchFilter(body);
}

/**
 * Fetch the children of a BOM/Assembly given the parent's `Obj_name`.
 *
 *   { rows, total }   on success
 *
 * Throws `OrcanosError` on failure.
 */
export async function fetchChildren({
  parentObjName,
  filterId,
  versionId,
  page = 1,
  pageSize = 200,
} = {}) {
  if (!parentObjName) {
    throw new OrcanosError(0, 'parentObjName is required');
  }
  const { instanceFilterId, versionId: defaultVersion } = getSettings();

  // Filter_By is a free-form string. Single-quote the value, and escape any
  // internal single-quotes by doubling them (SQL string-literal style).
  const escaped = String(parentObjName).replace(/'/g, "''");
  const body = {
    Filter_id: filterId ?? instanceFilterId,
    Page_no: page,
    Page_Size: pageSize,
    Item_Type: 'PI',
    Version_id: versionId ?? defaultVersion,
    Filter_By: `[Master Part Source] = '${escaped}'`,
    IsNewPaging: 1,
    IsReturnPageCount: 1,
  };
  return await _fetchFilter(body);
}

/**
 * Build the Orcanos web URL for an item — used for the "Orcanos Link" column.
 */
export function orcanosItemUrl({ baseUrl, versionId, type, itemId }) {
  const s = getSettings();
  const base = baseUrl ?? s.baseUrl;
  const ver = versionId ?? s.versionId;
  return `${base}web/${ver}/items/view?Item=${encodeURIComponent(
    type
  )}&ItemId=${encodeURIComponent(itemId)}`;
}

// ─── Internal ─────────────────────────────────────────────────────────────

async function _fetchFilter(body) {
  const auth = getAuth();
  if (!auth) {
    // Treat as 401 so callers can react uniformly.
    throw new OrcanosError(401, 'Not authenticated');
  }

  let resp;
  try {
    resp = await fetch(apiBase() + 'QW_Get_Filter_Results', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new OrcanosError(0, `Could not reach Orcanos (${err.message}).`);
  }

  if (resp.status === 401) {
    // The credential is no longer valid. Surface 401 so App can bounce to login.
    throw new OrcanosError(401, 'Your session expired — please sign in again.');
  }

  if (!resp.ok) {
    throw new OrcanosError(
      resp.status,
      `Server error (HTTP ${resp.status}).`
    );
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new OrcanosError(0, 'Server returned invalid JSON.');
  }

  if (!data.IsSuccess) {
    throw new OrcanosError(
      data.HttpCode || 500,
      typeof data.Data === 'string'
        ? data.Data
        : data.Message || 'Filter call failed.'
    );
  }

  const objects = Array.isArray(data.Data?.Object) ? data.Data.Object : [];
  const total = parseInt(data.Data?.Total_records ?? objects.length, 10);

  return {
    rows: objects.map(_normalizeRow),
    total: Number.isFinite(total) ? total : objects.length,
  };
}

/**
 * Convert a raw Orcanos `Object` record into a friendlier row.
 *
 * The API returns each row as:
 *   { Field: [{ Name, Title, Text, Web_order, ... }, ...], Id, Type, ... }
 *
 * We keep `Field` as the source of truth for column rendering (so the UI can
 * iterate fields in `Web_order`), but also surface a few canonical accessors:
 *
 *   row.id          — Orcanos internal ID
 *   row.type        — "PRT" / "PI" / etc.
 *   row.fields      — original Field array, sorted by Web_order
 *   row.byName(n)   — text of a field by Name
 *   row.objName     — value of the Obj_name field
 *   row.userPrefix  — value of the User_Prefix (Key) field
 */
function _normalizeRow(obj) {
  const fields = Array.isArray(obj.Field) ? obj.Field : [];
  const sorted = [...fields].sort((a, b) => {
    const ao = parseInt(a.Web_order ?? a.Order ?? 0, 10);
    const bo = parseInt(b.Web_order ?? b.Order ?? 0, 10);
    return ao - bo;
  });
  const byName = (n) =>
    sorted.find((f) => f.Name === n)?.Text ?? '';

  // Orcanos's top-level Id field arrives as a string like "46584 (42195)"
  // where the parenthetical is the canonical numeric ID used for URLs.
  // Extract that. If we can't find a parenthetical (older filters / odd data),
  // fall back to whatever digits we can find in Id, then User_Prefix.
  const id = obj.Id ?? '';
  const userPrefix = byName('User_Prefix');
  const itemId =
    extractNumericId(id) ||
    extractNumericId(userPrefix) ||
    String(id).replace(/[^\d]/g, '');

  return {
    id,           // raw Id string from Orcanos (may include parenthetical)
    itemId,       // canonical numeric ID for URL building
    type: obj.Type ?? '',
    fields: sorted,
    byName,
    objName: byName('Obj_name'),
    userPrefix,
    raw: obj,
  };
}

function extractNumericId(s) {
  if (!s) return '';
  // Prefer the parenthetical at the end if present.
  const m = String(s).match(/\((\d+)\)\s*$/);
  if (m) return m[1];
  return '';
}
