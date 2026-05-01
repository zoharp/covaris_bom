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
  pageSize = 100,
  searchQuery = null,
  filterByOverride = null,
} = {}) {
  const { bomFilterId, versionId: defaultVersion } = getSettings();
  const body = {
    Filter_id: filterId ?? bomFilterId,
    Page_no: page,
    Page_Size: pageSize,
    Item_Type: 'PRT',
    Version_id: versionId ?? defaultVersion,
    // ⚠️ This combination is load-bearing. Don't "fix" it.
    //   IsNewPaging: 0  +  IsReturnPageCount: "yes"
    // is the only combo that returns BOTH the rows AND a truthful
    // `Total_records` for filter 609 (verified via console matrix test).
    // With IsNewPaging: 1, Total_records just echoes Page_Size.
    // With IsReturnPageCount: 1 (numeric), Data comes back empty.
    IsNewPaging: 0,
    IsReturnPageCount: 'yes',
  };
  // Server-side name search — used by the Part Catalog search box so it
  // can find items beyond the current page. Single-quote-escaped, SQL LIKE.
  const q = searchQuery == null ? '' : String(searchQuery).trim();
  const searchClause = q
    ? `[Obj_name] LIKE '%${q.replace(/'/g, "''")}%'`
    : '';
  // filterByOverride is the where-used SQL clause. When both override and
  // search are present, AND them so the user can search within where-used results.
  const override = filterByOverride ? String(filterByOverride).trim() : '';
  const parts = [override, searchClause].filter(Boolean);
  if (parts.length === 1) body.Filter_By = parts[0];
  else if (parts.length > 1) body.Filter_By = `(${parts.join(') AND (')})`;
  return await _fetchFilter(body);
}

/**
 * Build the `Filter_By` clause for a Where-Used query.
 *
 * `dbo.fn_GetRootParentByCS21(<id>)` is an Orcanos table-valued function that
 * returns the root parent IDs (top-level BOMs) that contain the given part
 * or part-instance. We wrap it in `ID IN (...)` so it composes with filter 609.
 *
 * The id is the row's `originalId`:
 *   - PRT row → the parenthetical numeric from `Id` (same as itemId)
 *   - PI row  → the digits from `Master Part Source` (e.g. `PRT-39382-...` → 39382)
 * Both are already exposed by `_normalizeRow` as `row.originalId`.
 */
export function whereUsedFilterBy(id) {
  const safe = String(id ?? '').replace(/'/g, "''");
  return `ID IN (select * from dbo.fn_GetRootParentByCS21('${safe}'))`;
}

/**
 * Fetch the ECOs (Change Requests) that reference a given part or part instance.
 *
 * Filter_By differs by row type:
 *   PRT → ID in (select item_id from eco_items where item_id=<row.itemId>)
 *   PI  → ID in (select item_id from eco_items where item_id=<row.cs21Int>)
 *
 * The Key column URL uses type 'CR'.
 */
export async function fetchRelatedEcos({ row }) {
  const { relatedEcoFilterId, versionId } = getSettings();
  const id = row.type === 'PI' ? row.cs21Int : row.itemId;
  const body = {
    Filter_id: relatedEcoFilterId,
    Page_no: 1,
    Page_Size: 200,
    Item_Type: 'CR',
    Version_id: versionId,
    Filter_By: `ID in (select item_id from eco_items where item_id=${id})`,
    IsNewPaging: 0,
    IsReturnPageCount: 0,
  };
  return await _fetchFilter(body);
}

/**
 * Fetch the children of a BOM/Assembly given the parent's original ID.
 *
 *   { rows, total }   on success
 *
 * Throws `OrcanosError` on failure.
 */
export async function fetchChildren({
  parentOriginalId,
  filterId,
  versionId,
  page = 1,
  pageSize = 100,
} = {}) {
  if (parentOriginalId === undefined || parentOriginalId === null || parentOriginalId === '') {
    throw new OrcanosError(0, 'parentOriginalId is required');
  }
  const { instanceFilterId, versionId: defaultVersion } = getSettings();

  const body = {
    Filter_id: filterId ?? instanceFilterId,
    Page_no: page,
    Page_Size: pageSize,
    Item_Type: 'PI',
    Version_id: versionId ?? defaultVersion,
    Filter_By: `parent_original_id = ${parentOriginalId}`,
    IsNewPaging: 0,
    IsReturnPageCount: 0,
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

async function _fetchFilter(body, { silent = false } = {}) {
  const auth = getAuth();
  if (!auth) {
    // Treat as 401 so callers can react uniformly.
    throw new OrcanosError(401, 'Not authenticated');
  }

  let resp;
  try {
    if (!silent) console.log('[orcanos] → request body:', body);
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
    if (!silent) console.log('[orcanos] ← response:', data);
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
  // For picklist / lookup fields (Status, Severity, etc.), Orcanos puts the
  // human-readable label in `Display_text` and the internal id in `Text`.
  // For plain text fields only `Text` is populated. Prefer the display value
  // so picklists render their label rather than a numeric id.
  const fieldText = (f) =>
    (f && (f.Display_text || f.Display || f.Text || f.Value || '')) || '';
  const byName = (n) => fieldText(sorted.find((f) => f.Name === n));
  const byTitle = (t) => fieldText(sorted.find((f) => f.Title === t));

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

  // `originalId` is the value to send as `parent_original_id` when expanding
  // this row's children:
  //   - For PRTs (top-level BOMs): same as itemId.
  //   - For PIs:  the PRT-side number embedded in `Master Part Source`,
  //               e.g. "PRT-39382-901631 description..." → "39382".
  const type = obj.Type ?? '';
  let originalId = '';
  if (type === 'PI') {
    const mps =
      byName('Master Part Source') ||
      byName('Master_Part_Source') ||
      byTitle('Master Part Source');
    const m = String(mps || '').match(/^[A-Z]+-(\d+)-/);
    if (m) originalId = m[1];
  }
  if (!originalId) originalId = itemId;

  // CS21 integer — for the Where-Used "Locate" feature. Two PIs that
  // instance the same source PRT will have the same CS21 integer. The CS21
  // column may be returned as a raw integer ("39382") or wrapped in a
  // "PRT-39382-901631 description..." display string, so we pull the first
  // run of digits either way. Empty for PRT rows (no CS21 field).
  const cs21Field = sorted.find(
    (f) =>
      f.Name === 'CS21' ||
      f.Title === 'CS21' ||
      f.Name === 'Master Part Source' ||
      f.Title === 'Master Part Source' ||
      f.Name === 'Master_Part_Source'
  );
  // Prefer the raw stored value (Text/Value) over the Display label so the
  // string we pass to dbo.fn_GetRootParentByCS21(...) matches whatever
  // Orcanos stores in CS21 — not the descriptive "PRT-… description" label.
  const cs21Raw = cs21Field
    ? cs21Field.Text ||
      cs21Field.Value ||
      cs21Field.Display_text ||
      cs21Field.Display ||
      ''
    : '';
  const cs21IntMatch = String(cs21Raw).match(/\d+/);
  const cs21Int = cs21IntMatch ? cs21IntMatch[0] : '';

  return {
    id,           // raw Id string from Orcanos (may include parenthetical)
    itemId,       // canonical numeric ID for URL building
    originalId,   // value to use as parent_original_id when expanding children
    cs21Raw,      // raw CS21 column value (empty on PRT rows)
    cs21Int,      // first integer extracted from CS21 (empty on PRT rows)
    type,
    fields: sorted,
    byName,
    byTitle,
    objName: byName('Obj_name') || byTitle('Obj_name'),
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
