import React from 'react';
import {
  BomIcon,
  AssemblyIcon,
  PartIcon,
  ChevronIcon,
  UnknownChildIcon,
} from './icons';
import Spinner from '../ui/Spinner';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { orcanosItemUrl } from '../api/orcanosClient';

const INDENT_PX = 24;

export default function BomRow({
  node,
  columns,
  onToggle,
  onExpandAll,
  expandAllProgress,
}) {
  const isRoot = node.isRoot;
  // After first expand, we know whether this is an Assembly or a leaf Part.
  const knownLeaf = node.loaded && node.childCount === 0 && !isRoot;
  const knownAssembly = node.loaded && node.childCount > 0 && !isRoot;
  // Probed-from-parent-expand: we already know whether this row has children
  // even though it hasn't been expanded yet. `hasChildren === undefined` means
  // "unknown" — fall through to the existing logic (show chevron).
  const probedLeaf = !isRoot && node.row.hasChildren === false;
  const probedAssembly = !isRoot && node.row.hasChildren === true;

  const isLeaf = knownLeaf || probedLeaf;
  const isAssembly = knownAssembly || probedAssembly;

  // Icon selection
  let iconNode;
  if (isRoot) iconNode = <BomIcon />;
  else if (isAssembly) iconNode = <AssemblyIcon />;
  else if (isLeaf) iconNode = <PartIcon />;
  else iconNode = <UnknownChildIcon />;

  // Chevron presence: hide it for leaves (rows we know have no children).
  const showChevron = !isLeaf;

  // ─── Synthetic columns ──────────────────────────────────────
  // The normalizer extracts the canonical numeric ID from row.id (which the
  // API returns as e.g. "46584 (42195)"). The parenthetical is what
  // Orcanos's web URL expects.
  const itemId = node.row.itemId;
  const linkType = isRoot ? 'PRT' : 'PI';
  const linkHref = itemId ? orcanosItemUrl({ type: linkType, itemId }) : null;

  // For top-level BOMs, the API doesn't return Quantity / Master Part Source.
  // Per the source design doc:
  //   - quantity     → 1 for root BOMs
  //   - masterPart   → empty for root BOMs
  function valueFor(colKey) {
    if (colKey === '__quantity') {
      if (isRoot) return '1';
      return (
        node.row.byName('Quantity') ||
        node.row.byTitle('Quantity') ||
        ''
      );
    }
    if (colKey === '__masterPartSource') {
      if (isRoot) return '';
      return (
        node.row.byName('Master Part Source') ||
        node.row.byName('Master_Part_Source') ||
        node.row.byTitle('Master Part Source') ||
        ''
      );
    }
    if (colKey === '__revision') {
      // PRTs expose "Revision"; PIs expose "Part Revision". Show whichever
      // is present so both row types render under the same header.
      return (
        node.row.byTitle('Part Revision') ||
        node.row.byName('Part Revision') ||
        node.row.byTitle('Revision') ||
        node.row.byName('Revision') ||
        ''
      );
    }
    if (colKey === '__orcanosLink') {
      return null; // rendered as a <a> below
    }
    return node.row.byName(colKey) || node.row.byTitle(colKey) || '';
  }

  return (
    <tr
      className={
        'bom-row' +
        (node.errored ? ' bom-row--errored' : '') +
        (isRoot ? ' bom-row--root' : '')
      }
    >
      {/* Tree column ─ chevron + icon + indentation */}
      <td className="bom-col-tree">
        <div
          className="bom-cell-tree"
          style={{ paddingLeft: node.depth * INDENT_PX + 'px' }}
        >
          <button
            type="button"
            className="bom-chevron"
            onClick={onToggle}
            aria-label={node.expanded ? 'Collapse' : 'Expand'}
            disabled={!showChevron || node.loading}
            style={{
              visibility: showChevron ? 'visible' : 'hidden',
            }}
          >
            {node.loading ? <Spinner size={12} /> : <ChevronIcon open={node.expanded} />}
          </button>

          <span className="bom-icon">{iconNode}</span>

          {isRoot && (
            <button
              type="button"
              className="bom-expand-all-btn"
              onClick={onExpandAll}
              title="Expand all descendants"
            >
              ⤓
              {expandAllProgress && (
                <span className="bom-expand-all-progress">
                  {expandAllProgress.done}/{expandAllProgress.total}
                </span>
              )}
            </button>
          )}
        </div>
      </td>

      {/* Dynamic + synthetic columns */}
      {columns.map((c) => {
        if (c.key === '__orcanosLink') {
          return (
            <td key={c.key} className="bom-col-link">
              {linkHref && (
                <a
                  href={linkHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Orcanos Link
                </a>
              )}
            </td>
          );
        }

        const value = valueFor(c.key);
        const tooltip = String(value).replace(/<[^>]+>/g, '').trim();
        return (
          <td key={c.key} className="bom-col-text" title={tooltip}>
            {/* Field text may contain HTML — sanitize then render. */}
            <span
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(value),
              }}
            />
          </td>
        );
      })}
    </tr>
  );
}
