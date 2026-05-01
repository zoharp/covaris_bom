import { useCallback, useReducer, useRef } from 'react';
import { fetchBoms, fetchChildren } from '../api/orcanosClient';
import { getSettings } from '../settings/settingsStore';
import { useToast } from '../ui/Toast';

// ─────────────────────────────────────────────────────────────────────────
// Tree state model
//
// We keep the whole tree as a flat list of "nodes". Each node represents
// one row in the rendered grid. Render order = list order. Depth and
// parent are tracked per-node.
//
//   node = {
//     nodeKey:    unique-per-app-session string. INCLUDES THE PARENT KEY
//                 so the same Orcanos id appearing under different parents
//                 produces distinct keys (a part can legitimately be reused
//                 in multiple BOMs).
//     row:        normalized row from the API
//     parentKey:  nodeKey of the parent, or null for root rows
//     depth:      0 for top-level
//     isRoot:     true for top-level rows
//     expanded:   true when children are currently shown
//     loading:    true while a child fetch is in flight
//     loaded:     true after a successful child fetch
//     childCount: number of immediate children loaded (after first expand)
//     errored:    true if last fetch failed
//   }
//
// Children are cached by `nodeKey` (NOT by Orcanos id), so a part appearing
// in two different BOMs is fetched twice. That's correct: the API call is
// the same and would return the same children, but caching by nodeKey keeps
// the data structures simple and avoids edge cases where a "shared" cache
// entry gets attached to two parents simultaneously.
// ─────────────────────────────────────────────────────────────────────────

const EXPAND_ALL_DEPTH_CAP = 20;
const EXPAND_ALL_CONCURRENCY = 6;
const PROBE_CONCURRENCY = 6;

// Run async fn over `items` with at most `limit` in flight at a time.
// Returns results in the same order as `items`.
async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

let _seq = 0;
function nextNodeKey() {
  _seq += 1;
  return `n${_seq}`;
}

function makeNode(row, { parentKey = null, depth = 0, isRoot = false } = {}) {
  return {
    nodeKey: nextNodeKey(),
    row,
    parentKey,
    depth,
    isRoot,
    expanded: false,
    loading: false,
    loaded: false,
    childCount: 0,
    errored: false,
  };
}

// `topPageSize` is filled in by `useReducer`'s lazy initializer below from
// `getSettings().pageSize` so changing `<pageSize>` in settings.xml takes
// effect on next reload — no code change needed.
const initialState = {
  nodes: [],
  topLoading: false,
  topError: null,
  topPage: 1,
  topPageSize: 50,
  // `Total_records` IS truthful when fetchBoms is called with the right
  // IsNewPaging/IsReturnPageCount combo (see orcanosClient.js). We also keep
  // a `topHasMore` heuristic so the Next button still works if a future
  // filter ever stops returning a real total.
  topTotal: 0,
  topHasMore: false,
};

function findIndexByKey(nodes, key) {
  return nodes.findIndex((n) => n.nodeKey === key);
}

function reducer(state, action) {
  switch (action.type) {
    case 'TOP_LOAD_START':
      return { ...state, topLoading: true, topError: null };

    case 'TOP_LOAD_OK': {
      const { rows } = action;
      return {
        ...state,
        topLoading: false,
        topError: null,
        topPage: action.page,
        topPageSize: action.pageSize,
        topTotal: action.total,
        topHasMore: rows.length >= action.pageSize,
        nodes: rows.map((row) => makeNode(row, { depth: 0, isRoot: true })),
      };
    }

    case 'TOP_LOAD_FAIL':
      return {
        ...state,
        topLoading: false,
        topError: action.error,
        nodes: [],
      };

    case 'CHILD_LOAD_START': {
      const nodes = state.nodes.map((n) =>
        n.nodeKey === action.parentKey
          ? { ...n, loading: true, errored: false }
          : n
      );
      return { ...state, nodes };
    }

    case 'CHILD_LOAD_OK': {
      // Insert children right after the parent. If the parent is already
      // expanded (e.g. expand-all racing with a manual click), we no-op
      // rather than duplicate the children.
      //
      // The caller may supply pre-generated `childKeys` (one per row) so
      // expand-all can refer to children by key without re-reading state.
      // If omitted, we generate fresh keys here.
      const { parentKey, rows, childKeys } = action;
      const parentIdx = findIndexByKey(state.nodes, parentKey);
      if (parentIdx < 0) return state;
      const parent = state.nodes[parentIdx];
      if (parent.expanded && parent.loaded) return state;

      const newChildren = rows.map((row, i) => {
        const node = makeNode(row, {
          parentKey,
          depth: parent.depth + 1,
          isRoot: false,
        });
        if (childKeys && childKeys[i]) {
          node.nodeKey = childKeys[i];
        }
        return node;
      });

      const updatedParent = {
        ...parent,
        loading: false,
        loaded: true,
        expanded: true,
        childCount: rows.length,
        errored: false,
      };

      return {
        ...state,
        nodes: [
          ...state.nodes.slice(0, parentIdx),
          updatedParent,
          ...newChildren,
          ...state.nodes.slice(parentIdx + 1),
        ],
      };
    }

    case 'CHILD_LOAD_FAIL': {
      const nodes = state.nodes.map((n) =>
        n.nodeKey === action.parentKey
          ? { ...n, loading: false, errored: true }
          : n
      );
      return { ...state, nodes };
    }

    case 'EXPAND_FROM_CACHE': {
      // Re-show previously-loaded subtree.
      const { parentKey, cachedSubtree } = action;
      const parentIdx = findIndexByKey(state.nodes, parentKey);
      if (parentIdx < 0) return state;
      const parent = state.nodes[parentIdx];
      if (parent.expanded) return state; // already expanded; no-op

      const updatedParent = { ...parent, expanded: true };
      return {
        ...state,
        nodes: [
          ...state.nodes.slice(0, parentIdx),
          updatedParent,
          ...cachedSubtree,
          ...state.nodes.slice(parentIdx + 1),
        ],
      };
    }

    case 'COLLAPSE': {
      // Remove every descendant of `parentKey` from the flat list. Nodes
      // are stored contiguously: descendants follow the parent until we
      // hit a node with depth ≤ parent.depth.
      const { parentKey } = action;
      const parentIdx = findIndexByKey(state.nodes, parentKey);
      if (parentIdx < 0) return state;
      const parent = state.nodes[parentIdx];

      let endIdx = parentIdx + 1;
      while (
        endIdx < state.nodes.length &&
        state.nodes[endIdx].depth > parent.depth
      ) {
        endIdx++;
      }

      const updatedParent = { ...parent, expanded: false };
      return {
        ...state,
        nodes: [
          ...state.nodes.slice(0, parentIdx),
          updatedParent,
          ...state.nodes.slice(endIdx),
        ],
      };
    }

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Hook
//
// `topFilterId` overrides the filter used for the top-level fetch. Defaults
// to settings.bomFilterId (BOMs view). Pass `settings.partCatalogFilterId`
// to drive the same UI off the Part Catalog filter.
//
// `topSearchQuery` is forwarded to the server (`Filter_By: [Obj_name] LIKE
// '%query%'`). Changing it re-runs `loadTop(1)` automatically.
//
// `topFilterByOverride` is an extra SQL `Filter_By` clause that's combined
// (AND-ed) with the search clause. Used by the Where-Used flow to swap the
// top-level result set to only the BOMs containing a target part. Changing
// it also re-runs `loadTop(1)` automatically.
// ─────────────────────────────────────────────────────────────────────────
export function useBomChildren({
  onAuthExpired,
  topFilterId,
  topSearchQuery = '',
  topFilterByOverride = null,
}) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({
    ...init,
    topPageSize: getSettings().pageSize ?? init.topPageSize,
  }));
  const { showToast } = useToast();

  // We need to read the latest nodes list inside async callbacks (especially
  // expandAll's pump) without retriggering the callback identity. A ref that
  // mirrors `state.nodes` does that.
  const nodesRef = useRef(state.nodes);
  nodesRef.current = state.nodes;

  // childCache: nodeKey -> { rows, subtree }
  //   rows    — the API rows from the last successful fetch (used for fresh expand)
  //   subtree — a snapshot of the descendants at collapse time (used for re-expand
  //             without re-fetching grand-children)
  const childCache = useRef(new Map());

  // probeRowsCache: parentOriginalId -> rows[]
  //
  // When the user expands a row, we probe each of its children for THEIR
  // children so we know whether to render the chevron. The probe is a
  // full fetchChildren call — its rows are stashed here keyed by the
  // probed row's `originalId`, so when the user later clicks `>` on one
  // of those children we have the data ready (no extra fetch).
  //
  // Top-level fetches (loadTop) do NOT probe. Probing only kicks in when
  // the user has expressed intent by clicking expand.
  const probeRowsCache = useRef(new Map());

  // ─── Reload top-level BOMs ─────────────────────────────────────────────
  const loadTop = useCallback(
    async (page = 1) => {
      // Guard against a stray React event being passed when an onClick is
      // wired as `onClick={loadTop}` instead of `onClick={() => loadTop(1)}`.
      // Passing an event into the request body triggers a circular-JSON
      // crash deep inside fetch.
      const pageNum =
        Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
      childCache.current.clear();
      probeRowsCache.current.clear();
      dispatch({ type: 'TOP_LOAD_START' });
      try {
        const pageSize = getSettings().pageSize ?? 50;
        const { rows, total } = await fetchBoms({
          page: pageNum,
          pageSize,
          filterId: topFilterId,
          searchQuery: topSearchQuery,
          filterByOverride: topFilterByOverride,
        });
        dispatch({ type: 'TOP_LOAD_OK', rows, total, page: pageNum, pageSize });
      } catch (err) {
        if (err.httpCode === 401) {
          onAuthExpired?.(err.message);
          return;
        }
        dispatch({ type: 'TOP_LOAD_FAIL', error: err.message });
        showToast(err.message || 'Failed to load BOMs.', 'error');
      }
    },
    [onAuthExpired, showToast, topFilterId, topSearchQuery, topFilterByOverride]
  );

  // ─── Internal: load children of a node and dispatch CHILD_LOAD_OK ──────
  // Returns the rows that were attached, or null on failure / 401.
  // Uses the cached `rows` if available (any prior expand of this same node).
  const loadChildren = useCallback(
    async (nodeKey, row) => {
      const cached = childCache.current.get(nodeKey);
      if (cached?.rows) {
        dispatch({ type: 'CHILD_LOAD_OK', parentKey: nodeKey, rows: cached.rows });
        return cached.rows;
      }

      dispatch({ type: 'CHILD_LOAD_START', parentKey: nodeKey });
      try {
        // Step 1: fetch this row's children (the rows we'll display).
        // If a sibling-probe already fetched them, hit the cache.
        let rows;
        if (row.originalId && probeRowsCache.current.has(row.originalId)) {
          rows = probeRowsCache.current.get(row.originalId);
        } else {
          const result = await fetchChildren({ parentOriginalId: row.originalId });
          rows = result.rows;
          if (row.originalId) {
            probeRowsCache.current.set(row.originalId, rows);
          }
        }

        // Step 2: for each child, probe ONE level deeper so we can render
        // leaves without a chevron. The probe is a full fetchChildren —
        // its rows are cached so the user's next click on this child is
        // instant. Probes whose target is already cached (sibling already
        // probed it) just read the cache; no network call.
        const enrichedRows = await mapWithLimit(rows, PROBE_CONCURRENCY, async (r) => {
          if (!r.originalId) return { ...r, hasChildren: false };
          if (probeRowsCache.current.has(r.originalId)) {
            const cached = probeRowsCache.current.get(r.originalId);
            return { ...r, hasChildren: cached.length > 0 };
          }
          try {
            const probe = await fetchChildren({ parentOriginalId: r.originalId });
            probeRowsCache.current.set(r.originalId, probe.rows);
            return { ...r, hasChildren: probe.rows.length > 0 };
          } catch {
            return { ...r, hasChildren: undefined };
          }
        });

        childCache.current.set(nodeKey, { rows: enrichedRows, subtree: null });
        dispatch({ type: 'CHILD_LOAD_OK', parentKey: nodeKey, rows: enrichedRows });
        return enrichedRows;
      } catch (err) {
        if (err.httpCode === 401) {
          onAuthExpired?.(err.message);
          return null;
        }
        dispatch({ type: 'CHILD_LOAD_FAIL', parentKey: nodeKey });
        showToast(err.message || 'Failed to load children.', 'error');
        return null;
      }
    },
    [onAuthExpired, showToast]
  );

  // ─── Toggle a row's expand/collapse ────────────────────────────────────
  // Stable identity: depends only on stable refs/callbacks.
  const toggle = useCallback(
    async (node) => {
      // The `node` argument may be stale (from an old render). Resolve the
      // current node from state via nodeKey.
      const current =
        nodesRef.current.find((n) => n.nodeKey === node.nodeKey) || node;

      if (current.expanded) {
        // Capture subtree for fast re-expand.
        const startIdx = findIndexByKey(nodesRef.current, current.nodeKey);
        let endIdx = startIdx + 1;
        while (
          endIdx < nodesRef.current.length &&
          nodesRef.current[endIdx].depth > current.depth
        ) {
          endIdx++;
        }
        const subtree = nodesRef.current.slice(startIdx + 1, endIdx);
        const cached = childCache.current.get(current.nodeKey) || {};
        childCache.current.set(current.nodeKey, { ...cached, subtree });
        dispatch({ type: 'COLLAPSE', parentKey: current.nodeKey });
        return;
      }

      // Expand from cached subtree if we have one.
      const cached = childCache.current.get(current.nodeKey);
      if (cached?.subtree) {
        dispatch({
          type: 'EXPAND_FROM_CACHE',
          parentKey: current.nodeKey,
          cachedSubtree: cached.subtree,
        });
        return;
      }

      // Otherwise fetch fresh.
      await loadChildren(current.nodeKey, current.row);
    },
    [loadChildren]
  );

  // ─── Expand all descendants of a single root BOM ───────────────────────
  // BFS pump with concurrency cap. We pre-generate nodeKeys for each child
  // before dispatching, so the BFS frontier knows the keys without reading
  // post-dispatch state (which `useReducer` can't expose synchronously).
  const expandAll = useCallback(
    async (rootNode, onProgress) => {
      let done = 0;
      let stopped = false;

      const startCurrent =
        nodesRef.current.find((n) => n.nodeKey === rootNode.nodeKey) ||
        rootNode;

      // Frontier of nodes whose children we still need to load.
      let frontier = [
        {
          nodeKey: startCurrent.nodeKey,
          row: startCurrent.row,
          depth: startCurrent.depth,
        },
      ];

      const report = () =>
        onProgress?.(done, done + frontier.length);
      report();

      while (frontier.length > 0 && !stopped) {
        // Process up to CONCURRENCY items in parallel.
        const batchSize = Math.min(EXPAND_ALL_CONCURRENCY, frontier.length);
        const batch = frontier.splice(0, batchSize);
        const nextFrontier = [];

        await Promise.all(
          batch.map(async (item) => {
            if (stopped) return;

            // Depth cap: stop descending here.
            if (item.depth >= EXPAND_ALL_DEPTH_CAP) {
              done++;
              return;
            }

            let rows;
            try {
              const cached = childCache.current.get(item.nodeKey);
              if (cached?.rows) {
                rows = cached.rows;
              } else {
                const res = await fetchChildren({
                  parentOriginalId: item.row.originalId,
                });
                rows = res.rows;
                childCache.current.set(item.nodeKey, {
                  rows,
                  subtree: null,
                });
              }
            } catch (err) {
              if (err.httpCode === 401) {
                stopped = true;
                onAuthExpired?.(err.message);
                return;
              }
              showToast(
                err.message ||
                  `Failed to load children of "${item.row.objName}".`,
                'error'
              );
              done++;
              return;
            }

            // Pre-generate keys for the new children, dispatch with them,
            // and queue them for the next BFS round using those same keys.
            const childKeys = rows.map(() => nextNodeKey());
            dispatch({
              type: 'CHILD_LOAD_OK',
              parentKey: item.nodeKey,
              rows,
              childKeys,
            });

            for (let i = 0; i < rows.length; i++) {
              nextFrontier.push({
                nodeKey: childKeys[i],
                row: rows[i],
                depth: item.depth + 1,
              });
            }
            done++;
          })
        );

        frontier = frontier.concat(nextFrontier);
        report();
      }

      // Final progress.
      onProgress?.(done, done);
    },
    [onAuthExpired, showToast]
  );

  // ─── Where-Used "Locate" — true level-order BFS ────────────────────────
  // At each round we fully expand the current frontier (every assembly's
  // children fetched, in parallel up to EXPAND_ALL_CONCURRENCY). Once the
  // whole level is expanded we scan the newly-added rows for the target;
  // first match wins. If nothing matches, the next round's frontier is the
  // assemblies among those new rows. Stops as soon as the target is found.
  //
  // Match predicate: descendant.cs21Raw === target  OR  descendant.cs21Int
  // === target. The same `target` value is what was sent into
  // dbo.fn_GetRootParentByCS21() when entering Where Used:
  //   - PRT click → target = the part's own id (matches PI cs21Int).
  //   - PI  click → target = the source PI's raw CS21 (matches cs21Raw).
  const findAndExpand = useCallback(
    async (rootNode, { target }) => {
      const t = String(target ?? '').trim();
      if (!t) return null;

      let foundKey = null;
      let stopped = false;

      const startCurrent =
        nodesRef.current.find((n) => n.nodeKey === rootNode.nodeKey) ||
        rootNode;

      let frontier = [
        {
          nodeKey: startCurrent.nodeKey,
          row: startCurrent.row,
          depth: startCurrent.depth,
        },
      ];

      while (frontier.length > 0 && !stopped) {
        // Fetch children for every assembly in the frontier, in parallel.
        // If a node is already expanded in the tree we skip the fetch and
        // read its children directly from nodesRef — their nodeKeys are the
        // real ones already rendered in the DOM, so the highlight works even
        // when the user had expanded the tree before clicking Locate.
        const newChildren = [];

        await mapWithLimit(
          frontier,
          EXPAND_ALL_CONCURRENCY,
          async (item) => {
            if (stopped) return;
            if (item.depth >= EXPAND_ALL_DEPTH_CAP) return;

            const live = nodesRef.current.find((n) => n.nodeKey === item.nodeKey);
            if (live?.expanded && live?.loaded) {
              // Already in the DOM — collect direct children from nodesRef.
              const idx = nodesRef.current.findIndex((n) => n.nodeKey === item.nodeKey);
              for (let i = idx + 1; i < nodesRef.current.length; i++) {
                const n = nodesRef.current[i];
                if (n.depth <= live.depth) break;
                if (n.depth === live.depth + 1) {
                  newChildren.push({ nodeKey: n.nodeKey, row: n.row, depth: n.depth });
                }
              }
              return;
            }

            let rows;
            try {
              const cached = childCache.current.get(item.nodeKey);
              if (cached?.rows) {
                rows = cached.rows;
              } else {
                const res = await fetchChildren({
                  parentOriginalId: item.row.originalId,
                });
                rows = res.rows;
                childCache.current.set(item.nodeKey, {
                  rows,
                  subtree: null,
                });
              }
            } catch (err) {
              if (err.httpCode === 401) {
                stopped = true;
                onAuthExpired?.(err.message);
                return;
              }
              showToast(
                err.message ||
                  `Failed to load children of "${item.row.objName}".`,
                'error'
              );
              return;
            }

            const childKeys = rows.map(() => nextNodeKey());
            dispatch({
              type: 'CHILD_LOAD_OK',
              parentKey: item.nodeKey,
              rows,
              childKeys,
            });

            for (let i = 0; i < rows.length; i++) {
              newChildren.push({
                nodeKey: childKeys[i],
                row: rows[i],
                depth: item.depth + 1,
              });
            }
          }
        );

        if (stopped) break;

        // Scan the level we just expanded — first match wins.
        for (const c of newChildren) {
          const cs21Raw = String(c.row.cs21Raw || '').trim();
          const cs21Int = String(c.row.cs21Int || '').trim();
          if (cs21Raw === t || (cs21Int && cs21Int === t)) {
            foundKey = c.nodeKey;
            stopped = true;
            break;
          }
        }
        if (stopped) break;

        // Next round: only nodes that aren't known leaves. Unprobed rows
        // (hasChildren undefined) are kept since we can't yet rule them out.
        frontier = newChildren.filter((c) => c.row.hasChildren !== false);
      }

      return foundKey;
    },
    [onAuthExpired, showToast]
  );

  return {
    nodes: state.nodes,
    topLoading: state.topLoading,
    topError: state.topError,
    topPage: state.topPage,
    topPageSize: state.topPageSize,
    topTotal: state.topTotal,
    topHasMore: state.topHasMore,
    loadTop,
    toggle,
    expandAll,
    findAndExpand,
  };
}
