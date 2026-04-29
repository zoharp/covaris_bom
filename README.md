# Covaris BOM Viewer

Read-only React SPA for browsing Bill-of-Materials (BOM) trees in the Orcanos
QMS at <https://us.orcanos.com/covaris/>. Each user signs in with their own
Orcanos credentials, sees top-level BOMs as a tree-grid, and lazy-expands
children on demand. Hosted on Vercel as a static build — no backend.

---

## Quick start

### Local dev

Windows:
```cmd
run.bat
```

Mac / Linux:
```bash
./run.sh
```

The script installs `node_modules` if missing, then starts the Vite dev server
on <http://localhost:5173>. The browser opens automatically.

In dev, calls to `/api/orcanos/...` are proxied to
`https://us.orcanos.com/covaris/api/v2/Json/...` (configured in
`vite.config.js`) — so CORS is never an issue locally.

### Deploy to Vercel

One-time setup (any machine):
```
npm install -g vercel
vercel login
vercel link        # only needed once per project
```

Then:

Windows:
```cmd
deploy.bat
```

Mac / Linux:
```bash
./deploy.sh
```

The script runs `npm run build` and then `vercel --prod`. The same
`/api/orcanos/...` proxying is handled in production by `vercel.json`
rewrites.

---

## Configuration

There are no environment variables. All runtime config lives in a single XML
file: **`public/settings.xml`**.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<covarisBomSettings>
  <baseUrl>https://us.orcanos.com/covaris/</baseUrl>
  <versionId>5</versionId>
  <bomFilterId>519</bomFilterId>
  <instanceFilterId>520</instanceFilterId>
</covarisBomSettings>
```

To change settings: edit this file, commit, and redeploy. The Settings modal
inside the running app **displays** these values but does not edit them.

---

## What the app does

1. **Login** — user enters Orcanos username + password. The app calls
   `QW_Login`. On success the Basic-auth header is stored in `localStorage`
   and used for all subsequent calls.
2. **Top-level BOMs** — `QW_Get_Filter_Results` with `Item_Type=PRT` and the
   configured BOM Filter ID returns the root rows.
3. **Lazy expand** — clicking the chevron on any row calls
   `QW_Get_Filter_Results` with `Item_Type=PI`, the configured Instance Filter
   ID, and `Filter_By=[Master Part Source] = '<parent name>'`.
4. **Dynamic columns** — column set is derived from the first returned row's
   `Field` array, ordered by `Web_order`. Plus three synthetic columns:
   Quantity, Master Part Source, Orcanos Link.
5. **Search** — client-side filter over loaded rows.
6. **Expand all** — recursively expands one BOM (depth cap 20, concurrency 6).

Errors surface as 3-second auto-dismissing toasts.

---

## Project structure

See [`COVARIS_BOM_DESIGN.md`](./COVARIS_BOM_DESIGN.md) for the full design and
[`CLAUDE.md`](./CLAUDE.md) / [`CLAUDE_CODE_INSTRUCTIONS.md`](./CLAUDE_CODE_INSTRUCTIONS.md)
for development guidance.

```
covaris-bom/
├── public/settings.xml          # ← runtime config, edit here
├── src/
│   ├── api/orcanosClient.js     # All Orcanos API calls
│   ├── auth/Login.jsx
│   ├── bom/                     # Tree-grid + lazy-load
│   ├── settings/                # XML loader + read-only viewer
│   ├── ui/                      # Toast, Sidebar, Spinner
│   ├── styles/design-system.css # Orcanos design tokens
│   └── utils/
├── run.bat / run.sh             # Local dev launcher
├── deploy.bat / deploy.sh       # Vercel production deploy
└── vercel.json
```

---

## What this app is NOT

- Not an editor. Read-only.
- Not a backend. Vercel serves static files; the browser talks directly to
  Orcanos (via a CORS-friendly path proxy).
- Not a multi-screen app. Login + Main + Settings modal — that's it.
- Not mobile-optimized. Desktop only.
- Not a "Where Used" tool. Out of scope for Phase 1.

---

## Browser requirements

- Modern evergreen browser (Chrome / Edge / Firefox / Safari, last 2 versions).
- JavaScript enabled.
- `fetch`, `localStorage`, `DOMParser` all required.

---

## License

Internal use — Covaris.
