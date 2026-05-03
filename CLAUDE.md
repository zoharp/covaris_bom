# Covaris BOM Viewer — Notes for Claude Code

This is the project-specific guidance file (analogous to the `CLAUDE.md` from the
Orcanos QMS reference project). Read this once at the start of any working
session before making changes.

### Current versions (update after every bump)
- **App:** `1.1.6`

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
  "Filter_By": "parent_original_id = <int>",   // omit for top-level BOMs
  "IsNewPaging": 0,
  "IsReturnPageCount": 0
}
```

Success: HTTP 200, `{ "IsSuccess": true, "Data": { Object: [...], Total_records, ... } }`.

**Body-shape gotchas (verified by console matrix tests — don't change without testing):**

- **Top-level fetch (BOMs / Part Catalog)** uses
  `IsNewPaging: 0` + `IsReturnPageCount: "yes"`. This is the only combo
  that returns BOTH rows AND a truthful `Total_records` for filter 609/611.
  Other combinations either return empty `Data: ""` or echo `Page_Size`
  back as `Total_records`.
- **Children fetch** uses `IsNewPaging: 0` + `IsReturnPageCount: 0`.
  `IsReturnPageCount: 1` returned empty data for the `parent_original_id`
  filter; we don't need the count for children anyway.
- **Children filter is `parent_original_id = <int>`** — NOT
  `[Master Part Source] = '<obj_name>'` (that column doesn't exist on
  filter 610). The value is unquoted (numeric).
- **`IsReturnPageCount` accepts `"yes"` or `"true"` (strings) but not `1`
  or `true` (boolean).** Numeric/boolean values trigger an empty response.

**Three filters from XML config:**
- **BOM Filter ID** (`bomFilterId`) — top-level BOMs view. `Item_Type: "PRT"`. No `Filter_By`.
- **Instance Filter ID** (`instanceFilterId`) — children of an Assembly/BOM. `Item_Type: "PI"`. `Filter_By: "parent_original_id = <int>"`.
- **Part Catalog Filter ID** (`partCatalogFilterId`) — same as BOM Filter but a different filter (defaults to 611). Drives the "Part Catalog" sidebar view via the same `BomTree` component, just with a different `topFilterId`.

**Where the parent's original_id comes from** (computed in `_normalizeRow`,
exposed as `row.originalId`):
- For **PRTs (top-level BOMs)** — the parenthetical number in `Id`
  (e.g. `46584 (42195)` → `42195`). Same as `row.itemId`.
- For **PIs** — the digits between the first two hyphens of the row's
  `Master Part Source` value (e.g. `PRT-39382-901631 7 mm Wide ...`
  → `39382`). The PI is an *instance of* PRT 39382, so its children
  are PRT 39382's PIs.

**Field value extraction** (`byName` / `byTitle` in `_normalizeRow`):
- Picklist fields (Status, Severity, etc.) put the human-readable label in
  `Display_text` and the internal id in `Text`. We try in this order:
  `Display_text → Display → Text → Value`. So pickilsts render their label,
  not "12".
- We also expose `byTitle(t)` because PRTs and PIs sometimes use the same
  Title with different `Name`s (e.g. PRT has `Name: "Status"` while PI has
  `Name: "PI_Status"` but both have `Title: "Status"`).

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
  <bomFilterId>609</bomFilterId>
  <instanceFilterId>610</instanceFilterId>
  <partCatalogFilterId>611</partCatalogFilterId>
  <pageSize>50</pageSize>
  <bomNamePrefixes>50,51,52,53</bomNamePrefixes>
</covarisBomSettings>
```

Field reference:
- `pageSize` — top-level `Page_Size` for BOMs / Part Catalog (default 50,
  clamped 1..500). Also drives the pagination math in the status bar.
- `bomNamePrefixes` — comma-separated list of `Obj_name` prefixes that mark
  a row as a BOM in the **Part Catalog** view (renders the BOM icon
  regardless of children state). Empty / whitespace entries are ignored.

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

## Two views, one component

The sidebar has **BOMs** and **Part Catalog**. Both render `BomTree` —
the only differences passed via props are:

- `topFilterId` — `bomFilterId` (609) vs `partCatalogFilterId` (611).
- `topLabel` — `"BOMs"` vs `"Parts"` (used only for human-readable strings).
- `view` — `'boms'` or `'parts'`. Used by `BomRow` for the BOM-by-name
  prefix override (Parts only) and the always-BomIcon-on-root rule
  (BOMs only).

Switching views remounts `BomTree` via `key={`${view}/${authEpoch}`}`,
so the cache and pagination reset cleanly.

---

## Where Used — same screen, different filter

Clicking the **Where Used** icon (magnifier next to the item icon) on any
non-BOM row swaps the same `BomTree` to a where-used result set:

- `topFilterId: bomFilterId` (609) — results are root BOMs regardless of the
  view the user came from, because `dbo.fn_GetRootParentByCS21` returns roots.
- `topFilterByOverride: ID IN (select * from dbo.fn_GetRootParentByCS21('<arg>'))`
  — extra `Filter_By` clause AND-ed onto the search clause when both are present.
  Built by `whereUsedFilterBy(arg)` in `orcanosClient.js`. The `<arg>` differs
  by source row type:
    - **PRT click** → the part's own id (`row.itemId`).
    - **PI  click** → `row.cs21Int` — the numeric ID extracted from the first
      digits of `Master Part Source` (e.g. `PRT-39382-…` → `39382`). We do NOT
      use `cs21Raw` here because when `Text`/`Value` are empty it falls back to
      `Display_text`, which is the long "PRT-39382-600244 Label…" label.
- `targetOriginalId: <id>` — the part's `originalId`, passed through to `BomRow`
  so it knows to render the **Locate** crosshair button on each root.
- `whereUsedLabel` + `onExitWhereUsed` — drive the back banner at the top of
  the BomTree.

**Locate** behavior (`handleLocate` in `BomTree.jsx` → `tree.findAndExpand`
in the hook): true level-order BFS. Each round fully expands the current
frontier (every assembly's children fetched, parallel up to
`EXPAND_ALL_CONCURRENCY = 6`); once the level is fully expanded, the new
rows are scanned for the target — first match wins. If no match, the next
round's frontier is the assemblies among those new rows.

The match value passed to `findAndExpand` is the SAME value we sent to
`dbo.fn_GetRootParentByCS21()` when entering Where Used (`targetOriginalId`).
A descendant matches when `row.cs21Raw === target` OR `row.cs21Int === target`
— covers PRT case (target is the part's id, matches PI `cs21Int`) and PI case
(target is the source PI's stored CS21 string, matches `cs21Raw` exactly).

Scrolls the match into view via `data-node-key` selector and adds
`bom-row--located` — a brief 1s flash settling into a steady amber
background. The highlight is **persistent**: it stays until the next Locate
overwrites it or until Where Used is exited (the WU tree unmounts on Back).
The static rule uses `!important` so it wins against `tr:nth-child(even)`
and `tr:hover`, both of which have higher specificity than a single class.
If the target can't be computed (rare), Locate shows a toast and exits.

**Preserving main-view state across Where Used.** `App.jsx` keeps the main
BomTree mounted continuously and just hides it with `display:none` while
the WU tree is mounted alongside. Pagination, search, expanded subtrees
and the child cache survive a round-trip into Where Used and back — Back
just unmounts the WU tree and the hidden main tree reappears with its
prior state intact. Switching the sidebar view (BOMs ↔ Part Catalog)
exits WU and remounts main on the new filter.

`App.jsx` tracks `whereUsedTarget = { sqlArg, cs21Int, label }`. The WU
BomTree's key includes `wu/<sqlArg>` so changing targets remounts cleanly.
The Where-Used button is hidden inside Where-Used view (no nesting);
Locate shows only on roots.

---

## Export

BOM rows (root nodes in BOMs view, or `isBomByName` rows in Parts view) have a
`⋯` button in the Tree cell. Clicking it opens a one-item dropdown (extensible);
choosing **Export** opens `ExportModal`.

`ExportModal` has two selections — **View** and **Format** — then calls the
matching function from `src/bom/exportUtils.js`.

### View
- **Hierarchic** (default) — full tree with level numbers, all depths.
- **Summary** — groups all non-root nodes by part key (`User_Prefix` / `Key` /
  `objName`), sums quantities across every occurrence, outputs one flat row per
  unique part sorted by key. Files get a `-summary` suffix.

### Format
- **JSON** — hierarchic: recursive tree (`number`, `type`, `fields{}`, `children[]`).
  Summary: flat array with `type`, `fields{}`, `Total Qty`. Downloaded as `.json`.
- **CSV** — hierarchic: `#`, `Type`, all visible columns. Summary: `Type`, all
  visible columns except Quantity, `Total Qty`. Downloaded as `.csv`.
- **HTML** — hierarchic: self-contained file with inline CSS + vanilla JS
  expand/collapse; level 1 expanded by default; Key column links to Orcanos.
  Summary: simple flat table, no JS. Downloaded as `.html`.
- **PDF** — same HTML in print mode (all rows visible, no JS toggle,
  auto-calls `window.print()`) opened in a new tab.

### Full-tree fetch
Every export independently BFS-fetches the **entire** BOM subtree from Orcanos
(`fetchFullSubtree` in `exportUtils.js`) regardless of what is expanded on screen.
Concurrency 6, page size 500. After the BFS the node list is reordered to DFS
so each parent is immediately followed by its descendants in the output.

### Level numbers
`"1"`, `"1.2"`, `"1.2.3"` — same logic as `computeLevelNumbers` in `BomTree.jsx`.
Root rows show no number. Appear in the tree cell and in all hierarchic export
formats.

---

## Tree-grid behavior — non-obvious details

1. **Columns are dynamic.** Read the `Field` array of the first returned row and
   render columns in `Web_order` order. Don't hard-code a column list.
2. **Hidden dynamic columns** (in `BomTree.jsx` → `HIDDEN_COLUMN_KEYS`):
   `Copy As Link`, `In Pool`, `Is Branch`, `Original ID`, `ID`, `Quantity`,
   `Master Part Source`, `Revision`, `Part Revision`. Match is on either
   `Name` or `Title`, normalized (lowercase, spaces/underscores merged).
   The data is still on each row — we just don't render the column.
3. **Synthetic columns** (always at the end, in this order):
   - `__quantity` — `1` for PRTs, `byName('Quantity')` for PIs.
   - `__revision` — merges PRT's `Revision` and PI's `Part Revision`.
   The Orcanos web link lives on the **Key** column itself (Name=`User_Prefix`,
   Title=`Key`) — rendered as a purple hyperlink to
   `<base>web/<version>/items/view?Item=<PRT|PI>&ItemId=<id>` where `<id>` is
   `row.itemId` (parenthetical from `Id`). No separate link column.
4. **Icons** (`src/bom/icons.jsx`):
   - **BOM**: hierarchy tree, `--accent-primary` (purple). Used for roots
     in BOMs view, AND for any Part Catalog row whose `Obj_name` starts with
     a prefix in `bomNamePrefixes` (settings.xml).
   - **Assembly** (has children, not a BOM-by-name): gear, `--accent-orange`.
   - **Part** (no children): hex nut, `--text-secondary`. Chevron is hidden.
   - **Unknown** (children unknown — not yet probed/expanded): dashed square.
5. **Probe-on-expand.** Probing only runs when the user **clicks `>`**, never
   on initial page load or pagination. After fetching the row's children we
   probe each child with a full `fetchChildren` call (concurrency 6) and
   set `row.hasChildren`. That decides chevron vs leaf for those children
   before the user has to click them. Probe rows are cached by
   `parent_original_id` in `probeRowsCache`, so the user's first click on a
   probed child is instant (skip the redundant fetch).
6. **Expand-all** is per-BOM only. Depth cap 20, concurrency cap 6. There is
   **no global "expand everything"** button.
7. **Search is server-side.** Typing in the toolbar search box re-runs the
   top-level fetch with `Filter_By: [Obj_name] LIKE '%query%'` (debounced
   350ms). Resets to page 1 on each query change. Children fetched on
   expand are NOT filtered.
8. **Pagination** uses `Page_Size` from settings.xml (`pageSize`, default 50).
   The "real" total comes from `Total_records` when the API returns it; we
   also track `topHasMore = rows.length >= pageSize` as a fallback.

---

## HTML in field values

The Orcanos filter response can contain HTML in field text (`<b>`, `<a>`, etc.).
Always render through `src/utils/sanitizeHtml.js` (DOMPurify wrapper) before
using `dangerouslySetInnerHTML`. The allowlist in that file is the canonical
source — if you need a new tag, add it there, don't bypass.

---

## Operational scripts

- `run.bat` / `run.sh` — installs deps if missing, then `npm run dev`.
- `deploy.bat` / `deploy.sh` — `npm run build` then `vercel --prod` (CLI path).
  Kept around as a fallback, but **the normal deploy path is GitHub →
  Vercel auto-deploy** (see below). The CLI script only works if the user
  has run `vercel login` on the machine.

Don't add new scripts for things `npm` can do directly. The `.bat`/`.sh` pair
exists because the team uses Windows.

## Deploys — push to GitHub, Vercel takes it from there

The Vercel project is wired to the GitHub repo `zoharp/covaris_bom` with
auto-deploys on `main`. The deploy flow is just:

1. Bump the version (`package.json` + `CLAUDE.md` + `release_notes.json`),
2. `git commit` + `git push origin main`,
3. Vercel picks it up within ~30–60s and rolls out a new production build.

There is **no need to run `vercel --prod` from the CLI** under normal
circumstances. If a build fails, check the Vercel dashboard for the
deployment log — Vercel runs `npm run build` against the pushed commit and
serves `dist/` as a static site. The only project-side config Vercel reads
is `vercel.json` (rewrites — currently routing `/api/orcanos/*` to Orcanos).

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
