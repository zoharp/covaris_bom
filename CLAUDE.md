# Covaris BOM Viewer — Notes for Claude Code

This is the project-specific guidance file (analogous to the `CLAUDE.md` from the
Orcanos QMS reference project). Read this once at the start of any working
session before making changes.

---

## What this app is

A read-only React SPA that browses Bill of Materials (BOM) trees in the Orcanos
QMS at `https://us.orcanos.com/covaris/`. Users log in with their own Orcanos
credentials, see top-level BOMs in a tree-grid, and lazy-expand children on
demand. Hosted on Vercel as a pure static build — there is **no backend of our
own**.

---

## Architecture in 30 seconds

```
Browser (React)  ─── HTTPS Basic auth ───▶  Orcanos REST API
                                             /api/v2/Json/...
```

- **No backend.** Browser calls Orcanos directly. If CORS blocks this, we use a
  Vercel rewrite (in `vercel.json`) — not a serverless function.
- **No bundler magic.** Plain React + Vite + plain CSS. No Tailwind, no Redux,
  no react-router (the app has only login / main / settings-modal — toggled via
  `useState`).
- **No tree library.** The tree-grid is custom (`src/bom/`) — flat list of rows
  with depth and parent fields. Lazy-load on chevron click.

---

## Two API endpoints — that's it

Both documented at `https://help.orcanos.com/knowledgebase/`.

### `QW_Login`

```
POST <base>api/v2/Json/QW_Login
Authorization: Basic <base64(user:pass)>
Content-Type: application/json
(empty body)
```

Success: HTTP 200, `{ "IsSuccess": true, "Data": {...} }`. We store the auth
header in `localStorage.covaris_auth` and reuse it on every subsequent call.

### `QW_Get_Filter_Results`

```
POST <base>api/v2/Json/QW_Get_Filter_Results
Authorization: Basic <auth>
Content-Type: application/json
{
  "Filter_id": <int>,
  "Page_no": 1,
  "Page_Size": 200,
  "Item_Type": "PRT" | "PI",
  "Version_id": <int>,
  "Filter_By": "[Master Part Source] = 'parent name'",   // optional
  "IsNewPaging": 1,
  "IsReturnPageCount": 1
}
```

Success: HTTP 200, `{ "IsSuccess": true, "Data": { Object: [...], Total_records, ... } }`.

Two filters from XML config:
- **BOM Filter ID** — top-level BOMs. `Item_Type: "PRT"`. No `Filter_By`.
- **Instance Filter ID** — children of an Assembly/BOM. `Item_Type: "PI"`. Includes `Filter_By: "[Master Part Source] = '<parent obj_name>'"`.

---

## Config is read-only XML, served as a static file

`public/settings.xml` ships with the build. The app fetches it on startup, parses
it, and uses those values everywhere. **No UI for editing settings — to change
config, edit the XML and redeploy.** The Settings modal in the app is a
read-only viewer.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<covarisBomSettings>
  <baseUrl>https://us.orcanos.com/covaris/</baseUrl>
  <versionId>5</versionId>
  <bomFilterId>519</bomFilterId>
  <instanceFilterId>520</instanceFilterId>
</covarisBomSettings>
```

The loader is `src/settings/settingsStore.js`. It exposes `loadSettings()` (async,
called once at app start) and `getSettings()` (sync, used everywhere else).

---

## What stays in localStorage

Only the auth header. No settings, no preferences, no caches that survive a reload.

| Key | Purpose | Set by | Cleared by |
|---|---|---|---|
| `covaris_auth` | `Basic <base64>` header for every API call | Login success | Sign out, 401 response |
| `covaris_user` | Username (display only) | Login success | Sign out |

In-memory only:
- Child cache (parent ID → array of child rows). Cleared on Refresh, on Sign out, and on a full reload.

---

## File layout & where to put new code

```
src/
├── api/orcanosClient.js     ◀── ALL Orcanos calls live here. Don't sprinkle fetch() elsewhere.
├── auth/Login.jsx           ◀── Login form. Calls api.login() and onSuccess().
├── bom/                     ◀── Tree-grid + lazy-load logic
├── settings/                ◀── XML loader + read-only modal viewer
├── ui/                      ◀── Reusable: Toast, Sidebar, Spinner
├── styles/design-system.css ◀── Copied verbatim from orcanos-design-system.css
└── utils/                   ◀── sanitizeHtml, parseKey
```

**If you're tempted to create a new top-level folder, ask first.** The structure is
deliberately small; growth pressure should usually go into `bom/` (more tree
features) or `ui/` (more shared components).

---

## UI design rules (inherited from QMS reference)

- **Colors come from CSS variables, not hex literals.** All defined in
  `src/styles/design-system.css`. Primary purple `#5C35A8`, accent orange
  `#F5A623`, sidebar `#EAE5F5`. If you need a new color, add it as a token.
- **Inter font, loaded from Google Fonts in `index.html`.** Don't swap in another
  font.
- **Modal action buttons:** right-aligned, secondary on left, primary on right.
  Cancel · Save (no `margin-left:auto` to push them apart). For this app, the
  Settings modal only has a "Close" button.
- **No bullet lists in regular UI copy.** Use prose. Bullet lists are fine in
  code/docs.
- **Errors auto-dismiss after 3 seconds.** Single `<Toast>` at the top of the
  view. Don't write inline `<div className="error">…</div>` — use the toast hook.

---

## Tree-grid behavior — non-obvious details

1. **Columns are dynamic.** Read the `Field` array of the first returned row and
   render columns in `Web_order` order. Don't hard-code a column list.
2. **`Quantity` column:** for top-level BOMs the API doesn't return it — render
   `1`. For child PIs render the API's `Quantity` field.
3. **`Master Part Source` column:** for top-level BOMs, render empty. For child
   PIs, render the API field.
4. **"Orcanos Link" column** (synthetic): always present. Builds
   `<base>web/<version>/items/view?Item=<PRT|PI>&ItemId=<id>` where `<id>` is
   parsed from the row's `Key` field — the parenthetical number, e.g.
   `PRT-34237-310020 (34237)` → `34237`.
5. **Icons depend on expand state.** A row that has never been expanded shows a
   chevron and a generic icon. After first expand:
   - children > 0 → keep chevron, switch icon to Assembly (`🔧`).
   - children = 0 → remove chevron, switch icon to Part (`🧩`).
   - top-level rows always show BOM (`🏭`) regardless.
6. **`Filter_By` quoting:** single-quote the value, escape any internal
   single-quote by doubling. `O'Brien` → `'O''Brien'`. The helper is in
   `orcanosClient.js`.
7. **Expand-all** is per-BOM only. Depth cap 20, concurrency cap 6. There is
   **no global "expand everything"** button.
8. **Search is client-side** over loaded rows only. We don't query Orcanos for
   search.

---

## HTML in field values

The Orcanos filter response can contain HTML in field text (`<b>`, `<a>`, etc.).
Always render through `src/utils/sanitizeHtml.js` (DOMPurify wrapper) before
using `dangerouslySetInnerHTML`. The allowlist in that file is the canonical
source — if you need a new tag, add it there, don't bypass.

---

## Operational scripts

- `run.bat` / `run.sh` — installs deps if missing, then `npm run dev`.
- `deploy.bat` / `deploy.sh` — `npm run build` then `vercel --prod`. Requires
  the Vercel CLI installed and `vercel login` already done once on the machine.

Don't add new scripts for things `npm` can do directly. The `.bat`/`.sh` pair
exists because the team uses Windows.

---

## CORS — the one operational unknown

If browser-direct calls to `us.orcanos.com/covaris/...` fail in production with
a CORS error, edit `vercel.json` to add a rewrite:

```json
{
  "rewrites": [
    { "source": "/api/orcanos/:path*",
      "destination": "https://us.orcanos.com/covaris/api/v2/Json/:path*" }
  ]
}
```

Then in `src/api/orcanosClient.js`, set `BASE_API_PATH = '/api/orcanos/'`
instead of `<baseUrl>api/v2/Json/`. That's the only change needed.

---

## What NOT to do

- Don't add a backend. Vercel is configured for static hosting only.
- Don't read settings from `localStorage`. They live only in `public/settings.xml`.
- Don't add a UI for editing settings. The Settings modal is read-only.
- Don't import any UI library (MUI, AntD, shadcn). Plain CSS only — design system tokens.
- Don't add `react-router`. The app has 2 views; toggle via state.
- Don't fetch Orcanos URLs from anywhere except `src/api/orcanosClient.js`.
- Don't store passwords in plaintext. Only the base64 `Authorization` header is stored.
- Don't change the tree's `nodeKey` model. Each node gets a fresh per-session key (`n1`, `n2`, ...) and that key is what every reducer action and child-cache entry references. The same Orcanos `id` can legitimately appear at multiple positions in the tree (a part reused in multiple BOMs); using `nodeKey` instead of `id` is what keeps those distinct.

---

## Testing this thing manually

1. `run.bat` (or `./run.sh`) → opens `http://localhost:5173`.
2. Log in with a real Orcanos username + password against `https://us.orcanos.com/covaris/`.
3. Top-level BOMs should appear within a few seconds.
4. Click `+` on any row — child Part Instances should load.
5. Click a row's "Orcanos Link" — should open the matching record in Orcanos in a new tab.
6. Click ⤓ on a top-level BOM — full subtree should walk out (watch the progress counter).
7. Type in the search box — visible rows should filter immediately.
8. Open Settings — values should match `public/settings.xml` exactly.
9. Sign out — should land back on Login, `localStorage.covaris_auth` cleared.

## Smoke tests (Node, no browser)

Two standalone scripts exercise the trickiest non-UI logic without needing
a browser or a real Orcanos endpoint:

```
node test-reducer.mjs       # tree reducer: collapse/expand, shared parts, dedup
node test-normalizer.mjs    # itemId extraction from Key/Id strings
```

They re-implement the relevant logic locally to keep the runner simple. If
you change the reducer or the row normalizer, run these and add cases for
whatever you touched.

---

## Phase plan (what to do, in order)

1. Scaffold (`package.json`, Vite config, `index.html`, design system CSS).
2. Login screen + `QW_Login` + auth state in App.
3. Settings XML loader (so the Main screen can use the values).
4. Top-level BOM grid (no expand yet).
5. Lazy expand + child caching.
6. Search + Expand-all.
7. Settings modal (read-only viewer).
8. Toast + polish + empty states.

Don't combine phases — each one should be runnable on its own before moving on.
