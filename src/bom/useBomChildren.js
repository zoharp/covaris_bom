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
// ─────────────────────────────────────────────────────────────────────────
export function useBomChildren({ onAuthExpired }) {
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

  // ─── Reload top-level BOMs ─────────────────────────────────────────────
  const loadTop = useCallback(async () => {
    childCache.current.clear();
    dispatch({ type: 'TOP_LOAD_START' });
    try {
      const { rows } = await fetchBoms({});
      dispatch({ type: 'TOP_LOAD_OK', rows });
    } catch (err) {
      if (err.httpCode === 401) {
        onAuthExpired?.(err.message);
        return;
      }
      dispatch({ type: 'TOP_LOAD_FAIL', error: err.message });
      showToast(err.message || 'Failed to load BOMs.', 'error');
    }
  }, [onAuthExpired, showToast]);

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
        const { rows } = await fetchChildren({ parentObjName: row.objName });
        childCache.current.set(nodeKey, { rows, subtree: null });
        dispatch({ type: 'CHILD_LOAD_OK', parentKey: nodeKey, rows });
        return rows;
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
                  parentObjName: item.row.objName,
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
    loadTop,
    toggle,
    expandAll,
  };
}
