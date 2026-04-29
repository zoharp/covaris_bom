# Covaris BOM Viewer — Instructions for Claude Code

This is the build playbook. Work through it phase by phase. Each phase should
end with a runnable, testable app — don't combine phases.

Before starting, read `CLAUDE.md` (project notes) and skim
`COVARIS_BOM_DESIGN.md` (the full design doc). Both live at the repo root.

---

## Reference files (read once, then build)

In this repo, the reference design is captured in:

| File | What it gives you |
|---|---|
| `COVARIS_BOM_DESIGN.md` | The locked design (what to build) |
| `CLAUDE.md` | Per-project rules (how to build it) |
| `src/styles/design-system.css` | The Orcanos design tokens — all colors, spacing, button styles |
| `public/settings.xml` | The build-time config that the running app reads |

---

## Phase 0 — Scaffolding

**Goal:** A blank Vite + React app starts up locally. No features.

1. The repo already has `package.json`, `vite.config.js`, `index.html`,
   `vercel.json`, `.gitignore`, `.env.example`, `run.bat`, `run.sh`, `deploy.bat`,
   `deploy.sh` checked in. Don't recreate them.
2. Run `run.bat` (Windows) or `./run.sh` (Mac/Linux). It should:
   - `npm install` if `node_modules` is missing.
   - Start the Vite dev server on `http://localhost:5173`.
3. Browser opens, you should see the placeholder `<App>` component with the
   "Covaris BOM Viewer" header.

If anything errors at this stage, fix the scaffolding first. Do not move on
until `run.bat` produces a clean dev server.

---

## Phase 1a — Authentication

**Goal:** A user can sign in with their Orcanos credentials and the app shows
"Hello, <username>" on the main screen.

Files to flesh out:
- `src/auth/Login.jsx` — username + password form, calls `api.login()`
- `src/auth/Login.css` — styled to match `Auth.css` from the QMS reference
  (purple gradient brand bar, `.auth-card` style)
- `src/api/orcanosClient.js` — `login()`, `signOut()`, internal `request()`
- `src/App.jsx` — auth state (logged-in vs. not), routes between Login and a
  placeholder Main screen
- `src/ui/Toast.jsx` + `Toast.css` — global toast for the 3-second error message

What to verify:
- Bad credentials → toast appears, says "Sign in failed", disappears after 3s.
- Good credentials → app navigates to a placeholder main screen.
- Reload the page — you stay logged in (auth in localStorage).
- A "Sign out" button on the placeholder main screen returns you to login and
  clears `localStorage.covaris_auth`.

**Do not** start fetching BOMs in this phase. Just auth.

---

## Phase 1b — Settings loader

**Goal:** The app reads `public/settings.xml` at startup and exposes the four
values (baseUrl, versionId, bomFilterId, instanceFilterId) to the rest of the
code.

Files:
- `src/settings/settingsStore.js` — async `loadSettings()`, sync `getSettings()`.
- `src/main.jsx` — call `loadSettings()` before rendering `<App/>` so the rest of
  the app can use `getSettings()` synchronously.

Implementation hint: use `DOMParser` to parse the fetched XML.

```js
const text = await fetch('/settings.xml').then(r => r.text());
const xml = new DOMParser().parseFromString(text, 'application/xml');
const get = (tag) => xml.querySelector(tag)?.textContent?.trim() ?? '';
```

What to verify:
- `console.log(getSettings())` somewhere in App shows the four values.
- Editing `public/settings.xml` and reloading reflects the change.

---

## Phase 1c — Top-level BOM grid (no expand yet)

**Goal:** After login, the main screen calls `QW_Get_Filter_Results` and renders
a flat grid of top-level BOMs.

Files:
- `src/api/orcanosClient.js` — add `fetchBoms()` + `fetchChildren()`.
- `src/bom/BomTree.jsx` — top-level container, owns the loaded rows.
- `src/bom/BomRow.jsx` — single row component (no expand handler yet).
- `src/bom/BomTree.css` — sticky header, alternating stripes, hover state.
- `src/utils/parseKey.js` — extracts the numeric ID from `Key` field.
- `src/utils/sanitizeHtml.js` — DOMPurify wrapper.
- Install `dompurify`: `npm install dompurify`.

Implementation notes:
- Build the column list dynamically from the first row's `Field` array, ordered
  by `Web_order`.
- The synthetic columns (`Quantity`, `Master Part Source`, `Orcanos Link`)
  always come last and in that order.
- For top-level BOMs: show `1` in Quantity, blank in Master Part Source.
- Each row gets a chevron and a 🏭 BOM icon (no expand logic yet — chevron is a
  no-op).

What to verify:
- After login the grid populates with rows.
- Each row shows the right columns including the "Orcanos Link" hyperlink that
  opens the correct URL in a new tab.
- A row whose `Obj_name` field contains HTML (e.g. `<b>...</b>`) renders the
  formatting, not the literal tags.

---

## Phase 1d — Lazy expand

**Goal:** Clicking the chevron loads child Part Instances and indents them under
the parent.

Files:
- `src/bom/useBomChildren.js` — custom hook: cache (Map keyed by parent ID),
  `loadChildren(parentRow)` that calls `fetchChildren()` and updates state.
- `src/bom/BomRow.jsx` — chevron click triggers expand/collapse.
- `src/bom/icons.jsx` — three SVG icons: BOM, Assembly, Part.

Implementation notes:
- Cache children in-memory (not localStorage). Map: `parentId → Row[]`.
- Re-collapse + re-expand should NOT re-fetch.
- Loading state: small spinner inline next to the chevron.
- After first expand, switch the row's icon based on whether children came back:
  >0 children → Assembly + keep chevron; 0 children → Part + remove chevron.
- For the `Filter_By` value, use the helper:
  ```js
  const escaped = parentObjName.replace(/'/g, "''");
  const filterBy = `[Master Part Source] = '${escaped}'`;
  ```

What to verify:
- Click `+` on a top-level BOM → child PIs appear indented.
- Click `+` on a child → grandchildren appear, indented further.
- Collapse and re-expand the same row → no second network call.
- Click "Refresh" in the toolbar → cache clears, top-level reloads.

---

## Phase 1e — Search + Expand all

**Goal:** Toolbar gets a search box and each top-level BOM gets an "Expand all" button.

Files:
- `src/bom/BomTree.jsx` — add the search input (debounced 200ms).
- `src/bom/BomRow.jsx` — add the "⤓ Expand all" button on top-level rows.
- `src/bom/useBomChildren.js` — add `expandAll(rootRow)` that BFS-walks and
  loads children with depth cap 20 and concurrency cap 6.

Implementation notes:
- **Search:** filter the visible row list (don't unload anything). A row is
  visible if its `Obj_name` matches OR any of its descendants match.
- **Expand all:** show a progress label like "Loading 12/47..." next to the
  button. On any 4xx/5xx the toast fires (3s). Completed branches stay
  expanded.
- Implement the concurrency cap with a simple `p-limit`-style helper or a small
  worker-pool function — don't pull in another dependency.

What to verify:
- Type "screw" in search → rows whose name contains "screw" stay visible, plus
  their parent chain.
- Clear search → everything reappears.
- Click "Expand all" on a BOM → tree fully expands without ordering glitches.
- Collapse the BOM, expand all again → still works.

---

## Phase 1f — Settings modal (read-only)

**Goal:** Sidebar gets a "Settings" entry that opens a modal showing the four
values from `public/settings.xml`. No editing.

Files:
- `src/settings/SettingsModal.jsx`
- `src/settings/SettingsModal.css`
- `src/ui/Sidebar.jsx` — wire up the Settings entry to open the modal.

What to verify:
- Click "Settings" in the sidebar → modal opens, shows all four values plus the
  computed API URL and Web URL preview.
- A note at the top reads: *"Settings are configured by the administrator. To
  change them, contact your admin to update the deployment."*
- Footer has only a Close button (right-aligned).

---

## Phase 1g — Polish

- Empty state on main screen ("No BOMs found") if the filter returns 0 rows.
- 401 anywhere → bounce to Login with the toast "Your session expired — please
  sign in again."
- Every error path goes through the toast — never inline `<div className="error">`.
- Verify the page works at 1280×800 (target desktop). No mobile work.
- Spot-check the colors against `DESIGN_SYSTEM_GUIDE.md`.

---

## Definition of Done

All AC items in `COVARIS_BOM_DESIGN.md` §11 pass. The flow:
1. `run.bat` → app comes up locally
2. Sign in with real Orcanos credentials
3. See top-level BOMs
4. Expand, search, expand-all all work
5. Settings modal shows the right XML values
6. Sign out works
7. `deploy.bat` → app appears on Vercel and works the same way

---

## When something goes wrong

- **CORS errors in browser console** during `QW_Login` or filter calls →
  add the rewrite to `vercel.json` (see `CLAUDE.md` "CORS — the one operational
  unknown") and switch the API path constant in `orcanosClient.js`.
- **`IsSuccess: false` from filter call** → log `data.Message` to console and
  fire the toast with that message verbatim. The most common cause is a wrong
  filter ID for the new `/covaris/` URL.
- **Filter returns rows but UI is empty** → check that `Web_order` is being read
  from each Field, and that the column list is being built from the first row.
  Some rows may have fewer fields than others (rare); render blanks for missing.
- **`Filter_By` returns nothing** → check that single-quote escaping is
  happening. Test with a known parent name from the Orcanos UI.

---

## What NOT to do (recap from CLAUDE.md)

- No backend. No serverless functions.
- No `react-router`, no Redux, no UI library (Tailwind / MUI / AntD / shadcn).
- No editing of settings from the UI.
- No fetching Orcanos URLs outside `src/api/orcanosClient.js`.
- No mobile work.
- No Where-Used / reverse-tree feature.

If a feature feels like it needs one of these, stop and check with the human first.
