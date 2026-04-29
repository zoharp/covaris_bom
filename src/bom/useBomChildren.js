import { useCallback, useReducer, useRef } from 'react';
import { fetchBoms, fetchChildren } from '../api/orcanosClient';
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
const TOP_PAGE_SIZE = 100;

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

const initialState = {
  nodes: [],
  topLoading: false,
  topError: null,
  topPage: 1,
  topPageSize: TOP_PAGE_SIZE,
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

    case 'TOP_LOAD_OK':
      return {
        ...state,
        topLoading: false,
        topError: null,
        topPage: action.page,
        topTotal: action.total,
        topHasMore: action.rows.length >= action.pageSize,
        nodes: action.rows.map((row) =>
          makeNode(row, { depth: 0, isRoot: true })
        ),
      };

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
// ─────────────────────────────────────────────────────────────────────────
export function useBomChildren({ onAuthExpired, topFilterId }) {
  const [state, dispatch] = useReducer(reducer, initialState);
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
  // When we expand a row, we probe each child for grandchildren (so we can
  // render leaves without a chevron). The "probe" is a full fetchChildren
  // call (Page_Size: 200) — we keep the rows here keyed by the parent's
  // original_id. When the user later clicks `>` on one of those probed rows,
  // we have the data already and skip the redundant fetch.
  //
  // This means: the probe cost is paid ONCE per level. Each subsequent
  // expand is instant (cache hit), and only triggers probes for the NEXT
  // level down.
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
        const { rows, total } = await fetchBoms({
          page: pageNum,
          pageSize: TOP_PAGE_SIZE,
          filterId: topFilterId,
        });
        dispatch({
          type: 'TOP_LOAD_OK',
          rows,
          total,
          page: pageNum,
          pageSize: TOP_PAGE_SIZE,
        });
      } catch (err) {
        if (err.httpCode === 401) {
          onAuthExpired?.(err.message);
          return;
        }
        dispatch({ type: 'TOP_LOAD_FAIL', error: err.message });
        showToast(err.message || 'Failed to load BOMs.', 'error');
      }
    },
    [onAuthExpired, showToast, topFilterId]
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
        // Step 1: get the children of this row.
        // If a parent expand already probed this `originalId`, we have the
        // rows cached — skip the API call.
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

        // Step 2: probe each child for ITS children (one level deeper) so
        // we can render leaves without a chevron. Cache the probe result by
        // originalId — the next time the user expands one of these rows we
        // skip the fetch in step 1.
        //
        // For probes whose target is already cached (e.g. a sibling already
        // probed it), we just read the cache without firing a network call.
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
  };
}
