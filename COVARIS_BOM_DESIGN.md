# Covaris BOM Viewer — Design Document

**Version:** 3.0 (final, approved direction)
**Date:** April 29, 2026
**Status:** Locked — building Phase 1

---

## Changelog from v2.0

| # | Change |
|---|---|
| 1 | Each user logs in with their **own** Orcanos username + password (no shared `api.user`) |
| 2 | Settings screen is **read-only** — just displays values parsed from `public/settings.xml`. No save, no override, no localStorage for settings. To change settings: edit the XML and redeploy. |
| 3 | Added operational scripts: `run.bat` (Windows local dev), `run.sh` (Mac/Linux), `deploy.bat` (Vercel deploy) |
| 4 | Removed all "open questions" except CORS — everything else is decided |

---

## 1. Executive Summary

The **Covaris BOM Viewer** is a single-page React app that lets authenticated Orcanos users browse Bill of Materials (BOM) hierarchies stored in Orcanos at `https://us.orcanos.com/covaris/`. Authentication and data come from Orcanos's REST API. The app is deployed as a static build on Vercel — no backend.

The visual design reuses the **Orcanos QMS purple theme** (primary `#5C35A8`, accent `#F5A623`, light purple sidebar `#EAE5F5`).

### Goals
1. Authenticate against Orcanos (`QW_Login`) and persist the credential for the session.
2. Display top-level BOMs from a configurable Orcanos filter as a tree-grid.
3. Lazy-load BOM children on expand.
4. Search BOMs by name, jump to source records in Orcanos.
5. "Expand all" on a single BOM (depth ≤ 20).
6. Show current settings to users (read-only viewer).

### Out of scope (Phase 1)
- Editing settings from the UI (XML-only)
- Editing BOM data (read-only viewer)
- Where-Used / reverse tree
- Mobile responsive design
- Bulk export / printing / PDF

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Login   │  │ BOM Tree     │  │ Settings Viewer  │  │
│  │  Screen  │  │ Component    │  │ (read-only)      │  │
│  └────┬─────┘  └──────┬───────┘  └──────────────────┘  │
│       │               │                                 │
│  ┌────▼───────────────▼──────────────────────────────┐ │
│  │            orcanosClient.js  (API layer)          │ │
│  └────┬──────────────────────────────────────────────┘ │
└───────┼────────────────────────────────────────────────┘
        │  HTTPS  (Authorization: Basic <base64>)
        ▼
┌────────────────────────────────────────────────────────┐
│              Orcanos REST API (Covaris)                │
│           https://us.orcanos.com/covaris/              │
│                       api/v2/Json                      │
│                                                         │
│   • QW_Login                                           │
│   • QW_Get_Filter_Results                              │
└────────────────────────────────────────────────────────┘
```

**Stack:** React 18 + Vite, plain CSS (matches `orcanos-design-system.css`), `fetch`, `DOMPurify`, custom tree component, hosted on Vercel.

**CORS:** If browser calls to `us.orcanos.com/covaris/...` are blocked, `vercel.json` includes a rewrite mapping `/api/orcanos/*` → upstream. Verify on first deploy.

---

## 3. Authentication

### 3.1 Login flow

1. App mounts → checks `localStorage.covaris_auth`. If valid → Main. Otherwise → Login.
2. **Login screen:**
   - "Covaris BOM Viewer" brand bar (purple gradient logo + name)
   - Username field
   - Password field (with eye-toggle)
   - "Sign in" button (purple gradient — `.btn-primary`)
   - Error toast (red, auto-clears after 3 s)
3. On submit → `QW_Login` (see §3.2).
4. On success → store credential, go to Main.
5. On failure → error toast, stay on Login.

### 3.2 The `QW_Login` call

Per `https://help.orcanos.com/knowledgebase/qw_login-rest-api/`:

- **Method:** `POST`
- **URL:** `<BASE_URL>api/v2/Json/QW_Login`
- **Headers:**
  - `Authorization: Basic <base64(username:password)>`
  - `Content-Type: application/json`
  - `Accept: application/json`
- **Body:** none (empty `POST`)
- **Success:** HTTP 200 with `{ "IsSuccess": true, "Data": { Projects, User_details, ... }, "HttpCode": 200 }`
- **Failure:** HTTP 401, OR HTTP 200 with `IsSuccess: false`

Each user signs in with their **own** Orcanos username + password. The same credential is then attached as `Authorization: Basic ...` on every subsequent API call.

### 3.3 Credential storage

```
localStorage.covaris_auth = "Basic dXNlcjpwYXNz..."   // base64 header value
localStorage.covaris_user = "<username for display>"
```

There is no token expiry / refresh logic — credential is valid until:
- The user clicks **Sign out** → clear `covaris_auth` + `covaris_user`, return to Login.
- An API call returns 401 → bounce to Login with toast: *"Your session expired — please sign in again."*

### 3.4 Sign out

Button at the bottom of the sidebar:
1. Clears `localStorage.covaris_auth` and `localStorage.covaris_user`.
2. Clears in-memory child cache.
3. Returns to Login.

---

## 4. Main Screen

### 4.1 Layout

```
┌────────────────────────────────────────────────────────────────┐
│ ┌──────────────┐ ┌────────────────────────────────────────────┐│
│ │  SIDEBAR     │ │  MAIN CONTENT                              ││
│ │  (#EAE5F5)   │ │                                            ││
│ │              │ │  [🔍 Search BOMs...     ]   [⟳ Refresh]    ││
│ │  ◐ Covaris   │ │                                            ││
│ │  BOM Viewer  │ │  ┌──────────────────────────────────────┐  ││
│ │              │ │  │ Tree-grid (sticky header)            │  ││
│ │  📋 BOMs     │ │  │  [+] 🏭 BOM-001  Name  Type  Qty  …  │  ││
│ │  ⚙  Settings │ │  │  [+] 🏭 BOM-002  ...                 │  ││
│ │              │ │  │  [−] 🏭 BOM-003  ... [⤓ Expand all]  │  ││
│ │              │ │  │     [+] 🔧 ASM-12  ...               │  ││
│ │              │ │  │        [+] 🧩 PRT-45  ...            │  ││
│ │              │ │  └──────────────────────────────────────┘  ││
│ │  ────────    │ │                                            ││
│ │  👤 user     │ │  Showing 1–24 of 24 root BOMs              ││
│ │  ↩  Sign out │ │                                            ││
│ └──────────────┘ └────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

### 4.2 Top-level BOM load

On main-screen mount:

```
POST  <BASE_URL>api/v2/Json/QW_Get_Filter_Results
Authorization: Basic <auth>
Content-Type: application/json

{
  "Filter_id":         <BOM_FILTER_ID from XML>,
  "Page_no":           1,
  "Page_Size":         200,
  "Item_Type":         "PRT",
  "Version_id":        <VERSION_ID from XML>,
  "IsNewPaging":       1,
  "IsReturnPageCount": 1
}
```

Response is a list of `Object` records, each with a flat `Field` array. Columns are **derived dynamically from the first row's `Field` array** ordered by `Web_order`.

### 4.3 Columns

| Column | Source |
|---|---|
| **▸ / ▾ chevron** | Local UI state |
| **Icon** | BOM / Assembly / Part — see §4.5 |
| `Key` | API field with `Name="User_Prefix"` |
| `Name` | API field with `Name="Obj_name"` |
| ...other returned fields | Rendered in `Web_order` order |
| **Quantity** | Top-level: `1`. Child PIs: `Quantity` field from API |
| **Master Part Source** | Top-level: empty. Child PIs: API field |
| **Orcanos Link** | Synthetic — see §4.4 |

### 4.4 Orcanos Link column

```
<a href="<BASE_URL>web/<VERSION_ID>/items/view?Item=<TYPE>&ItemId=<ID>"
   target="_blank" rel="noopener">Orcanos Link</a>
```

- `<TYPE>` = `PRT` for root-BOM rows, `PI` for child rows
- `<ID>` = numeric ID extracted from the `Key` field. E.g. `PRT-34237-310020 (34237)` → `34237`. Implementation: `String(key).match(/\((\d+)\)/)?.[1]`.

### 4.5 Icons (3 states)

- **🏭 BOM** — top-level (returned by the BOM filter call)
- **🔧 Assembly** — child that has been expanded once and returned ≥ 1 children
- **🧩 Part** — child that has been expanded once and returned 0 children

Until first expand, child rows assume "might have children" and show the chevron + a generic child icon. Inline SVGs in `src/bom/icons.jsx`.

### 4.6 Expanding a row (lazy load)

When user clicks `+` on row R:

```
POST  <BASE_URL>api/v2/Json/QW_Get_Filter_Results
{
  "Filter_id":         <INSTANCE_FILTER_ID from XML>,
  "Page_no":           1,
  "Page_Size":         200,
  "Item_Type":         "PI",
  "Version_id":        <VERSION_ID from XML>,
  "Filter_By":         "[Master Part Source] = '<obj_name of R>'",
  "IsNewPaging":       1,
  "IsReturnPageCount": 1
}
```

`Filter_By` syntax — single quotes around value, escape internal single-quotes by doubling:
```js
const escaped = parentObjName.replace(/'/g, "''");
const filterBy = `[Master Part Source] = '${escaped}'`;
```

Children are cached **in-memory only** (per session). Cache key: parent row's `Id`. The "Refresh" button clears the cache and reloads top-level BOMs.

### 4.7 "Expand All" — single BOM only

Per top-level BOM, `⤓ Expand all` button:
1. Recursively expands every descendant — BFS, depth cap **20**.
2. Concurrency cap = 6 parallel requests.
3. Per-BOM progress: *"Loading 12/47…"*.
4. On any failure: completed branches stay expanded, error toast 3 s, retryable.

### 4.8 Search

Single search box, debounced 200 ms:
- Client-side substring filter on `Obj_name` (case-insensitive).
- Non-matching rows hidden; ancestors of matches stay visible.
- Non-loaded subtrees not auto-expanded.

Placeholder: *Search loaded BOMs by name…*

### 4.9 HTML in field values

Field values may contain HTML. Rendered with `dangerouslySetInnerHTML` after `DOMPurify` with allowlist:
- Tags: `b`, `i`, `u`, `em`, `strong`, `span`, `br`, `a`, `p`, `ul`, `ol`, `li`
- Attrs: `href`, `target`, `rel`, `class`, `style` (sanitized)
- Stripped: `<script>`, `<iframe>`, event handlers, `javascript:` URLs

---

## 5. Errors & Notifications

`<Toast>` at the top of the view shows the latest message for **3000 ms**, then fades. Multiple errors queue with 250 ms gap. Esc and click both dismiss.

| Type | Color |
|---|---|
| Error | Red `#EF4444` |
| Warning | Amber `#F59E0B` |
| Success | Green `#10B981` |

---

## 6. Settings (read-only viewer)

Modal opened from sidebar. Displays the **current values from `public/settings.xml`** — no editing.

### 6.1 Fields shown

| Field | Display |
|---|---|
| Base URL | e.g. `https://us.orcanos.com/covaris/` |
| Version ID | e.g. `5` |
| BOM Filter ID | e.g. `519` |
| Instance Filter ID | e.g. `520` |
| API URL (computed) | `<base>api/v2/Json/` |
| Web URL preview (computed) | `<base>web/<version>/items/view?Item=PRT&ItemId=12345` |

A note at the top: *"Settings are configured by the administrator. To change them, contact your admin to update the deployment."*

### 6.2 `public/settings.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<covarisBomSettings>
  <baseUrl>https://us.orcanos.com/covaris/</baseUrl>
  <versionId>5</versionId>
  <bomFilterId>519</bomFilterId>
  <instanceFilterId>520</instanceFilterId>
</covarisBomSettings>
```

App fetches `/settings.xml` on startup, parses it, and uses those values everywhere. To change settings: edit this file, redeploy.

---

## 7. Visual Design

Adopts the **Orcanos QMS design system** (`orcanos-design-system.css` / `DESIGN_SYSTEM_GUIDE.md`).

### 7.1 Color tokens

```css
:root {
  --accent-primary:  #5C35A8;
  --accent-hover:    #3D2070;
  --accent-light:    #EAE5F5;
  --accent-border:   #D4D0E0;
  --accent-orange:   #F5A623;
  --text-primary:    #1A1631;
  --text-secondary:  #6B6580;
  --text-tertiary:   #A8A1BE;
  --bg-primary:      #FFFFFF;
  --bg-secondary:    #F5F5F5;
  --sidebar-bg:      #EAE5F5;
  --border-color:    #E8E4F0;
  --status-success:  #10B981;
  --status-warning:  #F59E0B;
  --status-error:    #EF4444;
  --status-info:     #3B82F6;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
```

### 7.2 Typography
Inter from Google Fonts. Headings 28/24/18/16/14/12 px (700 weight). Body 13 px.

### 7.3 Tree-grid styling (`BomTree.css`)
- Sticky header, `font-weight: 700`, `border-bottom: 2px solid var(--accent-border)`
- Row hover: `background: rgba(92, 53, 168, 0.04)`
- Row indent: 24 px per depth level
- Chevron: 16 px SVG, rotates 90° when expanded
- Alternating stripe: `nth-child(even) { background: #FAFAFE }`
- "Orcanos Link" cell: orange, underline on hover

---

## 8. File structure

```
covaris-bom/
├── README.md
├── CLAUDE.md
├── CLAUDE_CODE_INSTRUCTIONS.md
├── package.json
├── vite.config.js
├── vercel.json
├── .gitignore
├── .env.example
├── index.html
├── run.bat                     # Windows: install deps + start dev server
├── run.sh                      # Mac/Linux equivalent
├── deploy.bat                  # Windows: build + push to Vercel
├── deploy.sh                   # Mac/Linux equivalent
├── public/
│   ├── favicon.svg
│   └── settings.xml            # READ-ONLY at runtime; admin-edited
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── App.css
    ├── api/
    │   └── orcanosClient.js
    ├── auth/
    │   ├── Login.jsx
    │   └── Login.css
    ├── bom/
    │   ├── BomTree.jsx
    │   ├── BomRow.jsx
    │   ├── BomTree.css
    │   ├── icons.jsx
    │   └── useBomChildren.js
    ├── settings/
    │   ├── SettingsModal.jsx   # READ-ONLY viewer
    │   ├── SettingsModal.css
    │   └── settingsStore.js    # XML loader (no writes)
    ├── ui/
    │   ├── Toast.jsx
    │   ├── Toast.css
    │   ├── Sidebar.jsx
    │   ├── Sidebar.css
    │   └── Spinner.jsx
    ├── styles/
    │   └── design-system.css
    └── utils/
        ├── sanitizeHtml.js
        └── parseKey.js
```

---

## 9. API client contract

`src/api/orcanosClient.js` exports:

```javascript
async function login(username, password)
   → { ok: true, user, projects } | { ok: false, error }

async function fetchBoms({ filterId, versionId, page = 1, pageSize = 200 })
   → { rows, total }

async function fetchChildren({ parentObjName, filterId, versionId, page = 1, pageSize = 200 })
   → { rows, total }

function orcanosItemUrl({ baseUrl, versionId, type, itemId }) → string
function signOut()
```

Internal `request(endpoint, body)`:
- Reads `Authorization` from `localStorage.covaris_auth`.
- Reads base URL from settings store.
- Throws `OrcanosError(httpCode, message)` on `IsSuccess: false` or non-2xx.
- Auto-bounces to Login on 401.

---

## 10. Build & deploy

### Local dev
```
run.bat       # Windows
./run.sh      # Mac/Linux
```
Both: `npm install` (if missing), then `npm run dev`. Opens `http://localhost:5173`.

### Vercel deploy
```
deploy.bat    # Windows
./deploy.sh   # Mac/Linux
```
Both: `npm run build`, then `vercel --prod`. Requires Vercel CLI installed and logged in.

### Phases

| Phase | Scope |
|---|---|
| 0 — Scaffold | Vite project, design-system CSS, base routing |
| 1a — Auth | Login + `QW_Login` + localStorage, Sign out |
| 1b — Top BOMs | `QW_Get_Filter_Results` + flat grid (no expand) |
| 1c — Lazy expand | Chevrons + child fetch + cache |
| 1d — Search & expand-all | Client search + recursive expand-all (depth 20) |
| 1e — Settings viewer | Modal + XML loader (read-only) |
| 1f — Polish | Toast, error handling, empty states |

---

## 11. Acceptance criteria

- [ ] AC-1: User signs in with their own Orcanos credentials via `QW_Login`.
- [ ] AC-2: Invalid credentials show a 3-second error toast.
- [ ] AC-3: Top-level BOMs from the configured BOM Filter ID render in a grid.
- [ ] AC-4: Each row shows the BOM/Assembly/Part icon and an "Orcanos Link" hyperlink that opens correctly.
- [ ] AC-5: `+` on a row fetches children via the Instance Filter ID + `Filter_By: [Master Part Source] = '<name>'`.
- [ ] AC-6: A row that returns zero children loses its chevron after first expand.
- [ ] AC-7: Search filters loaded rows by name in real time.
- [ ] AC-8: "Expand all" walks a single BOM tree (depth ≤ 20).
- [ ] AC-9: Settings modal displays values from `public/settings.xml` (read-only).
- [ ] AC-10: Sign out clears credentials and returns to Login.
- [ ] AC-11: HTML in field values renders correctly (DOMPurify-sanitized).
- [ ] AC-12: Inter font + Orcanos purple/orange palette throughout.

---

*End of v3.0 design document. Approved direction. Proceeding to code generation.*
