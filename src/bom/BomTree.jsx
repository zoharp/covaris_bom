import React, { useEffect, useMemo, useState } from 'react';
import { useBomChildren } from './useBomChildren';
import BomRow from './BomRow';
import ExportModal from './ExportModal';
import Spinner from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import './BomTree.css';

// Compute hierarchical level numbers for every node in tree order.
// Parent nodes appear before their children in the flat list, so a single
// pass is enough — the counter per parent is always ready when needed.
function computeLevelNumbers(nodes) {
  const nums = new Map();
  const counters = new Map();
  // Root nodeKeys — children of roots restart numbering at 1 without chaining
  // the root's own number as a prefix. So root children are "1", "2", "3";
  // their children are "1.1", "1.2", etc.
  const rootKeys = new Set(nodes.filter((n) => n.isRoot).map((n) => n.nodeKey));

  for (const n of nodes) {
    const pk = n.parentKey ?? '';
    const idx = (counters.get(pk) ?? 0) + 1;
    counters.set(pk, idx);
    const parentIsRoot = n.parentKey ? rootKeys.has(n.parentKey) : true;
    const parentNum = !parentIsRoot ? nums.get(n.parentKey) : null;
    nums.set(n.nodeKey, parentNum ? `${parentNum}.${idx}` : String(idx));
  }
  return nums;
}

// Keep the search debounced so typing doesn't re-render on every keystroke.
function useDebounced(value, delay = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// Columns we never display. The data is still kept on each row — we just
// don't add them to the rendered column list. Match by either Name or Title,
// case-insensitive, with spaces and underscores treated equivalently.
const HIDDEN_COLUMN_KEYS = new Set([
  'copy as link',
  'in pool',
  'is branch',
  'original id',
  'id',
  'master part source',
  // Hide the dynamic Quantity column from the PRT row — we render Quantity
  // via the synthetic `__quantity` column so it shows for both PRTs ("1")
  // and PIs (their Quantity field).
  'quantity',
  // The PRT filter exposes "Revision" and the PI filter exposes "Part Revision".
  // We hide both and add a single synthetic `__revision` column that pulls from
  // whichever the row has.
  'revision',
  'part revision',
]);

function normalizeColKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();
}


export default function BomTree({
  onAuthExpired,
  view = 'boms',
  topFilterId,
  topLabel = 'BOMs',
  // Where-Used wiring. When set, the tree renders the where-used result set.
  topFilterByOverride = null,
  targetOriginalId = null,
  // Integer used by "Locate" to find the matching PI inside an expanded BOM.
  //   PRT click → the part's own id.
  //   PI  click → the PI's CS21 integer (source PRT's id).
  // Match: descendant.row.cs21Int === targetCs21Int.
  targetCs21Int = '',
  whereUsedLabel = '',
  onExitWhereUsed,
  onWhereUsed,
}) {
  const [search, setSearch] = useState('');
  // 350ms debounce — slightly longer than client-only filtering since each
  // change now triggers a server roundtrip.
  const debounced = useDebounced(search, 350);
  const tree = useBomChildren({
    onAuthExpired,
    topFilterId,
    topSearchQuery: debounced,
    topFilterByOverride,
  });

  // Per-root progress for "Expand all" — { rootUid: "12 / 47" or null }.
  const [progress, setProgress] = useState({});

  // Where-Used "Locate" state. `locatingKey` is the rootKey currently being
  // expanded; `locatedKey` is the descendant that should briefly highlight.
  const [locatingKey, setLocatingKey] = useState(null);
  const [locatedKey, setLocatedKey] = useState(null);

  // Export modal — set to the BOM root node when open, null otherwise.
  const [exportNode, setExportNode] = useState(null);

  const { showToast } = useToast();

  // Level numbers: "1", "1.2", "1.2.3", … computed from the full loaded list
  // (not visibleNodes) so numbers are stable regardless of expand state.
  const levelNumbers = useMemo(() => computeLevelNumbers(tree.nodes), [tree.nodes]);

  // Re-runs on mount AND whenever `loadTop`'s identity changes — which
  // happens when topFilterId or topSearchQuery changes (see hook's useCallback
  // deps). So changing the search box re-fetches page 1 with the new query.
  useEffect(() => {
    tree.loadTop(1);
  }, [tree.loadTop]);

  // ─── Column derivation ────────────────────────────────────────
  // Read column definitions from the first top-level row's Field array,
  // ordered by Web_order. Add the synthetic columns at the end.
  const columns = useMemo(() => {
    const firstRoot = tree.nodes.find((n) => n.depth === 0);
    if (!firstRoot) return null;
    const dynamic = firstRoot.row.fields
      .filter((f) => {
        const n = normalizeColKey(f.Name);
        const t = normalizeColKey(f.Title);
        return !HIDDEN_COLUMN_KEYS.has(n) && !HIDDEN_COLUMN_KEYS.has(t);
      })
      .map((f) => ({
        key: f.Name,
        title: f.Title || f.Name,
      }));
    return [
      ...dynamic,
      { key: '__quantity', title: 'Quantity' },
      { key: '__revision', title: 'Revision' },
    ];
  }, [tree.nodes]);

  // ─── Search filter ────────────────────────────────────────────
  // A node is visible if:
  //   - debounced is empty, OR
  //   - the node's Obj_name matches, OR
  //   - any descendant's Obj_name matches (so the chain stays visible), OR
  //   - any ancestor matches (so children of a matched parent stay visible).
  //
  // We compute this once by tagging each node with its match state and then
  // walking the flat list once more with parent context.
  const visibleSet = useMemo(() => {
    if (!debounced.trim()) return null;
    const q = debounced.trim().toLowerCase();
    const nodes = tree.nodes;

    const directMatch = new Set();
    nodes.forEach((n) => {
      if ((n.row.objName || '').toLowerCase().includes(q)) {
        directMatch.add(n.nodeKey);
      }
    });

    // Mark descendants of any match (search-includes-children) AND mark every
    // ancestor of any match (so the tree path is preserved).
    const visible = new Set(directMatch);

    // Descendants: scan top-down, maintain a stack of "currently inside a match".
    const insideMatchStack = [];
    nodes.forEach((n) => {
      while (
        insideMatchStack.length &&
        insideMatchStack[insideMatchStack.length - 1].depth >= n.depth
      ) {
        insideMatchStack.pop();
      }
      if (directMatch.has(n.nodeKey)) {
        insideMatchStack.push(n);
      }
      if (insideMatchStack.length > 0) {
        visible.add(n.nodeKey);
      }
    });

    // Ancestors: scan bottom-up, when we see a visible node, add its ancestors.
    const needsAncestorAtDepth = new Set();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (visible.has(n.nodeKey)) {
        if (n.depth > 0) needsAncestorAtDepth.add(n.depth - 1);
      }
      if (needsAncestorAtDepth.has(n.depth)) {
        visible.add(n.nodeKey);
        needsAncestorAtDepth.delete(n.depth);
        if (n.depth > 0) needsAncestorAtDepth.add(n.depth - 1);
      }
    }
    return visible;
  }, [debounced, tree.nodes]);

  const visibleNodes = useMemo(() => {
    if (!visibleSet) return tree.nodes;
    return tree.nodes.filter((n) => visibleSet.has(n.nodeKey));
  }, [tree.nodes, visibleSet]);

  // ─── Handlers ─────────────────────────────────────────────────
  // Click "Locate" on a where-used root: level-order BFS — fully expand the
  // current level, scan it for the target, stop on first match, otherwise
  // descend. The match value is the same one we passed to
  // dbo.fn_GetRootParentByCS21() when entering Where Used (`targetOriginalId`).
  // The descendant matches when its `cs21Raw` or `cs21Int` equals that value.
  async function handleLocate(rootNode) {
    const target = String(targetOriginalId || '').trim();
    if (!target) {
      showToast('Cannot locate: no source ID for this item.', 'error');
      return;
    }
    setLocatingKey(rootNode.nodeKey);
    try {
      const foundKey = await tree.findAndExpand(rootNode, { target });
      if (!foundKey) {
        showToast('Item not found inside this BOM.', 'error');
        return;
      }
      // Persistent highlight — overwrite if a previous Locate had set one.
      setLocatedKey(foundKey);
      // Defer to the next paint so React has rendered the row before we scroll.
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `tr[data-node-key="${foundKey}"]`
        );
        if (el && el.scrollIntoView) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
    } finally {
      setLocatingKey(null);
    }
  }

  function handleExpandAll(node) {
    setProgress((p) => ({ ...p, [node.nodeKey]: { done: 0, total: 1 } }));
    tree
      .expandAll(node, (done, total) =>
        setProgress((p) => ({ ...p, [node.nodeKey]: { done, total } }))
      )
      .finally(() => {
        // Keep the final number visible briefly, then clear.
        setTimeout(() => {
          setProgress((p) => {
            const next = { ...p };
            delete next[node.nodeKey];
            return next;
          });
        }, 1200);
      });
  }

  // ─── Render ───────────────────────────────────────────────────
  const inWhereUsed = !!targetOriginalId;

  return (
    <div className="bom-tree">
      {inWhereUsed && (
        <div className="bom-where-used-banner">
          <button
            type="button"
            className="bom-where-used-back"
            onClick={onExitWhereUsed}
            aria-label="Back"
          >
            ← Back
          </button>
          <span className="bom-where-used-label">
            Where used:&nbsp;
            <strong>{whereUsedLabel || `#${targetOriginalId}`}</strong>
          </span>
        </div>
      )}
      <div className="bom-toolbar">
        <div className="bom-search">
          <span className="bom-search-icon">🔍</span>
          <input
            className="bom-search-input"
            type="text"
            placeholder={`Search loaded ${topLabel} by name…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="bom-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="button"
          className="bom-refresh-btn"
          onClick={() => tree.loadTop(1)}
          disabled={tree.topLoading}
        >
          {tree.topLoading ? <Spinner size={14} /> : '⟳'}
          <span>Refresh</span>
        </button>
      </div>

      {tree.topLoading && tree.nodes.length === 0 && (
        <div className="bom-empty">
          <Spinner size={20} />
          <p>Loading {topLabel}…</p>
        </div>
      )}

      {!tree.topLoading && tree.nodes.length === 0 && tree.topError && (
        <div className="bom-empty">
          <p className="bom-empty-error">Failed to load {topLabel}.</p>
          <p className="bom-empty-detail">{tree.topError}</p>
          <button className="btn-secondary" onClick={() => tree.loadTop(1)}>
            Retry
          </button>
        </div>
      )}

      {!tree.topLoading && tree.nodes.length === 0 && !tree.topError && (
        <div className="bom-empty">
          <p>
            {inWhereUsed
              ? 'This item is not used in any BOM.'
              : `No ${topLabel} found.`}
          </p>
        </div>
      )}

      {tree.nodes.length > 0 && columns && (
        <>
          <div className="bom-grid-wrap">
            <table className="bom-grid">
              <thead>
                <tr>
                  <th className="bom-col-tree">Tree</th>
                  {columns.map((c) => (
                    <th key={c.key}>{c.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map((node) => (
                  <BomRow
                    key={node.nodeKey}
                    node={node}
                    view={view}
                    columns={columns}
                    onToggle={() => tree.toggle(node)}
                    onExpandAll={() => handleExpandAll(node)}
                    expandAllProgress={progress[node.nodeKey]}
                    targetOriginalId={targetOriginalId}
                    onWhereUsed={onWhereUsed}
                    onLocate={inWhereUsed ? handleLocate : undefined}
                    locating={locatingKey === node.nodeKey}
                    located={locatedKey === node.nodeKey}
                    levelNum={levelNumbers.get(node.nodeKey) || ''}
                    onExport={setExportNode}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="bom-status-bar">
            <div className="bom-status-info">
              {(() => {
                const rootsOnPage = tree.nodes.filter((n) => n.depth === 0).length;
                const startIdx = (tree.topPage - 1) * tree.topPageSize + 1;
                const endIdx = startIdx + rootsOnPage - 1;
                const knownTotal = tree.topTotal > tree.topPageSize ? tree.topTotal : null;
                if (visibleSet) {
                  return `Showing ${visibleNodes.length} of ${tree.nodes.length} loaded rows · page ${tree.topPage}`;
                }
                if (knownTotal) {
                  const totalPages = Math.max(1, Math.ceil(knownTotal / tree.topPageSize));
                  return `${topLabel} ${startIdx}–${endIdx} of ${knownTotal} · page ${tree.topPage}/${totalPages} · ${tree.nodes.length} total loaded rows`;
                }
                if (tree.topPage > 1 || tree.topHasMore) {
                  return `${topLabel} ${startIdx}–${endIdx} · page ${tree.topPage} · ${tree.nodes.length} total loaded rows`;
                }
                return `${rootsOnPage} ${topLabel} · ${tree.nodes.length} total loaded rows`;
              })()}
            </div>
            {(() => {
              const knownTotal = tree.topTotal > tree.topPageSize ? tree.topTotal : null;
              const totalPages = knownTotal ? Math.max(1, Math.ceil(knownTotal / tree.topPageSize)) : null;
              const hasNext = totalPages
                ? tree.topPage < totalPages
                : tree.topHasMore;
              if (!totalPages && !tree.topHasMore && tree.topPage <= 1) return null;
              return (
                <div className="bom-pagination">
                  {totalPages && (
                    <button
                      type="button"
                      onClick={() => tree.loadTop(1)}
                      disabled={tree.topPage <= 1 || tree.topLoading}
                      aria-label="First page"
                    >‹‹</button>
                  )}
                  <button
                    type="button"
                    onClick={() => tree.loadTop(tree.topPage - 1)}
                    disabled={tree.topPage <= 1 || tree.topLoading}
                    aria-label="Previous page"
                  >‹ Prev</button>
                  <span className="bom-pagination-info">
                    {totalPages
                      ? `${tree.topPage} / ${totalPages}`
                      : `Page ${tree.topPage}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => tree.loadTop(tree.topPage + 1)}
                    disabled={!hasNext || tree.topLoading}
                    aria-label="Next page"
                  >Next ›</button>
                  {totalPages && (
                    <button
                      type="button"
                      onClick={() => tree.loadTop(totalPages)}
                      disabled={tree.topPage >= totalPages || tree.topLoading}
                      aria-label="Last page"
                    >››</button>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}
      {exportNode && (
        <ExportModal
          rootNode={exportNode}
          columns={columns || []}
          onClose={() => setExportNode(null)}
        />
      )}
    </div>
  );
}
