import React from 'react';
import {
  BomIcon,
  AssemblyIcon,
  PartIcon,
  ChevronIcon,
  UnknownChildIcon,
  WhereUsedIcon,
  LocateIcon,
} from './icons';
import Spinner from '../ui/Spinner';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { orcanosItemUrl } from '../api/orcanosClient';
import { getSettings } from '../settings/settingsStore';

const INDENT_PX = 24;

export default function BomRow({
  node,
  view = 'boms',
  columns,
  onToggle,
  onExpandAll,
  expandAllProgress,
  // Where-Used wiring. When `targetOriginalId` is set, we're viewing the
  // where-used results — show Locate on roots, hide WhereUsed everywhere.
  // Otherwise, show WhereUsed on non-BOM rows.
  targetOriginalId = null,
  onWhereUsed,
  onLocate,
  locating = false,
  located = false,
}) {
  const isRoot = node.isRoot;

  // Children-state flags. `hasChildren` is set by the probe pass on every
  // row (top-level and child) so leaf detection works before any click.
  const knownLeaf = node.loaded && node.childCount === 0;
  const knownAssembly = node.loaded && node.childCount > 0;
  const probedLeaf = node.row.hasChildren === false;
  const probedAssembly = node.row.hasChildren === true;

  const isLeaf = knownLeaf || probedLeaf;
  const isAssembly = knownAssembly || probedAssembly;

  // Part Catalog: items whose Obj_name starts with one of the configured
  // BOM prefixes (`bomNamePrefixes` in settings.xml — defaults to
  // 50,51,52,53) render the BOM icon regardless of children state.
  const objName = String(node.row.objName || '').trimStart();
  const bomPrefixes =
    view === 'parts' ? getSettings().bomNamePrefixes || [] : [];
  const isBomByName = bomPrefixes.some(
    (p) => p && objName.startsWith(p)
  );

  // Icon selection. BOMs view: roots always render as BOM icons (they ARE
  // the BOM filter). Parts view: name-prefix rule wins, then assembly/leaf,
  // then unknown if we don't yet know.
  let iconNode;
  if (view === 'boms' && isRoot) iconNode = <BomIcon />;
  else if (isBomByName) iconNode = <BomIcon />;
  else if (isAssembly) iconNode = <AssemblyIcon />;
  else if (isLeaf) iconNode = <PartIcon />;
  else iconNode = <UnknownChildIcon />;

  // Chevron presence: hide it for leaves (rows we know have no children).
  const showChevron = !isLeaf;

  // ─── Where-Used / Locate button visibility ──────────────────────────────
  // Where-Used view (targetOriginalId set): show Locate on every root,
  //   never show WhereUsed (we'd be entering where-used while in where-used).
  // Normal view: show WhereUsed on any non-BOM row that has an originalId.
  const inWhereUsed = !!targetOriginalId;
  const isBom = (view === 'boms' && isRoot) || isBomByName;
  const showWhereUsed =
    !inWhereUsed && !isBom && !!node.row.originalId && !!onWhereUsed;
  const showLocate = inWhereUsed && isRoot && !!onLocate;

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
    return node.row.byName(colKey) || node.row.byTitle(colKey) || '';
  }

  // The "Key" column (Name = User_Prefix, Title = "Key") is rendered as a
  // hyperlink to the matching Orcanos record. Detect it here so the column
  // logic stays generic.
  function isKeyColumn(c) {
    return (
      c.key === 'User_Prefix' ||
      String(c.title || '').trim().toLowerCase() === 'key'
    );
  }

  return (
    <tr
      data-node-key={node.nodeKey}
      className={
        'bom-row' +
        (node.errored ? ' bom-row--errored' : '') +
        (isRoot ? ' bom-row--root' : '') +
        (located ? ' bom-row--located' : '')
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

          {showWhereUsed && (
            <button
              type="button"
              className="bom-row-action-btn"
              onClick={() => onWhereUsed(node)}
              title={`Where used — find BOMs that contain "${objName}"`}
              aria-label="Where used"
            >
              <WhereUsedIcon />
            </button>
          )}

          {showLocate && (
            <button
              type="button"
              className="bom-row-action-btn bom-row-action-btn--locate"
              onClick={() => onLocate(node)}
              disabled={locating}
              title="Locate the part inside this BOM"
              aria-label="Locate"
            >
              {locating ? <Spinner size={12} /> : <LocateIcon />}
            </button>
          )}

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
        const value = valueFor(c.key);
        const tooltip = String(value).replace(/<[^>]+>/g, '').trim();

        if (isKeyColumn(c) && linkHref) {
          return (
            <td key={c.key} className="bom-col-key" title={tooltip}>
              <a
                href={linkHref}
                target="_blank"
                rel="noopener noreferrer"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(value),
                }}
              />
            </td>
          );
        }

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
