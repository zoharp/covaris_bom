import { fetchChildren, orcanosItemUrl } from '../api/orcanosClient';
import { getSettings } from '../settings/settingsStore';

const EXPORT_CONCURRENCY = 6;
const EXPORT_PAGE_SIZE = 500; // large page to minimize pagination in deep BOMs

// ─── Concurrency-limited map ───────────────────────────────────────────────
// Same pattern as useBomChildren.js — duplicated here so exportUtils has no
// dependency on the hook.
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ─── Full-subtree fetch ────────────────────────────────────────────────────
// BFS from rootRow, fetching children independently of the UI tree state.
// Returns a flat array in BFS order — parents always precede their children,
// which is the requirement for computeLevelNums below.
async function fetchFullSubtree(rootRow) {
  let seq = 0;
  const makeId = () => `x${++seq}`;
  const rootId = makeId();

  const nodes = [{ nodeKey: rootId, parentKey: null, depth: 0, isRoot: true, row: rootRow }];
  let frontier = [{ nodeKey: rootId, row: rootRow, depth: 0 }];

  while (frontier.length > 0) {
    const levelResults = await mapWithLimit(frontier, EXPORT_CONCURRENCY, async (item) => {
      if (!item.row.originalId) return { parentKey: item.nodeKey, children: [], depth: item.depth + 1 };
      try {
        const res = await fetchChildren({
          parentOriginalId: item.row.originalId,
          pageSize: EXPORT_PAGE_SIZE,
        });
        return { parentKey: item.nodeKey, children: res.rows, depth: item.depth + 1 };
      } catch {
        return { parentKey: item.nodeKey, children: [], depth: item.depth + 1 };
      }
    });

    const nextFrontier = [];
    for (const { parentKey, children, depth } of levelResults) {
      for (const row of children) {
        const id = makeId();
        nodes.push({ nodeKey: id, parentKey, depth, isRoot: false, row });
        nextFrontier.push({ nodeKey: id, row, depth });
      }
    }
    frontier = nextFrontier;
  }

  // BFS gives breadth-first order; reorder to DFS so each parent is immediately
  // followed by its descendants (required for visual tree and level numbering).
  const childrenOf = new Map();
  for (const n of nodes) {
    const pk = n.parentKey ?? '';
    if (!childrenOf.has(pk)) childrenOf.set(pk, []);
    childrenOf.get(pk).push(n);
  }
  const dfs = [];
  function visit(nodeKey) {
    for (const child of (childrenOf.get(nodeKey) || [])) {
      dfs.push(child);
      visit(child.nodeKey);
    }
  }
  for (const root of (childrenOf.get('') || [])) {
    dfs.push(root);
    visit(root.nodeKey);
  }
  return dfs;
}

// ─── Level numbers ─────────────────────────────────────────────────────────
// Same logic as BomTree.jsx computeLevelNumbers — roots' direct children
// restart at 1, grandchildren use 1.1, 1.2, etc.
function computeLevelNums(nodes) {
  const nums = new Map();
  const counters = new Map();
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

// ─── Shared helpers ────────────────────────────────────────────────────────

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return String(name || 'bom').replace(/[^a-z0-9\-_.]/gi, '_').slice(0, 60);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '');
}

function csvEscape(s) {
  const str = String(s ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function getFieldValue(node, col) {
  if (col.key === '__quantity') {
    return node.isRoot ? '1' : node.row.byName('Quantity') || node.row.byTitle('Quantity') || '';
  }
  if (col.key === '__revision') {
    return (
      node.row.byTitle('Part Revision') ||
      node.row.byName('Part Revision') ||
      node.row.byTitle('Revision') ||
      node.row.byName('Revision') ||
      ''
    );
  }
  return node.row.byName(col.key) || node.row.byTitle(col.title) || '';
}

function isKeyCol(col) {
  return col.key === 'User_Prefix' || String(col.title || '').trim().toLowerCase() === 'key';
}

function buildItemUrl(node) {
  const s = getSettings();
  if (!node.row.itemId) return '';
  return orcanosItemUrl({
    baseUrl: s.baseUrl,
    versionId: s.versionId,
    type: node.isRoot ? 'PRT' : 'PI',
    itemId: node.row.itemId,
  });
}

function levelNum(node, levelNumbers) {
  return node.isRoot ? '' : (levelNumbers.get(node.nodeKey) || '');
}

// ─── Summary builder ───────────────────────────────────────────────────────
// Groups all non-root nodes by part key (User_Prefix / Key / objName), sums
// quantities, and returns one entry per unique part sorted by key.
function buildSummary(nodes) {
  const map = new Map();
  for (const n of nodes) {
    if (n.isRoot) continue;
    const partKey =
      n.row.byName('User_Prefix') || n.row.byTitle('Key') || n.row.objName || n.nodeKey;
    const qtyRaw = n.row.byName('Quantity') || n.row.byTitle('Quantity') || '';
    const qty = parseFloat(qtyRaw) || 1;
    if (map.has(partKey)) {
      map.get(partKey).totalQty += qty;
      map.get(partKey).count += 1;
    } else {
      map.set(partKey, { node: n, totalQty: qty, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => {
    const ka = a.node.row.byName('User_Prefix') || a.node.row.objName || '';
    const kb = b.node.row.byName('User_Prefix') || b.node.row.objName || '';
    return ka.localeCompare(kb);
  });
}

function fmtQty(q) {
  return q % 1 === 0 ? String(q) : q.toFixed(4).replace(/\.?0+$/, '');
}

// ─── JSON export ───────────────────────────────────────────────────────────

export async function exportJson(rootRow, columns, { bomName, summary = false }) {
  const nodes = await fetchFullSubtree(rootRow);

  if (summary) {
    const entries = buildSummary(nodes);
    const nonQtyCols = columns.filter((c) => c.key !== '__quantity');
    const data = {
      bom: bomName,
      exportedAt: new Date().toISOString().split('T')[0],
      view: 'summary',
      items: entries.map((e) => {
        const fields = {};
        for (const col of nonQtyCols) fields[col.title] = stripHtml(getFieldValue(e.node, col));
        fields['Total Qty'] = e.totalQty;
        fields['Occurrences'] = e.count;
        return { type: e.node.row.type, fields };
      }),
    };
    downloadFile(JSON.stringify(data, null, 2), `${sanitizeFilename(bomName)}-summary.json`, 'application/json');
    return;
  }

  const levelNumbers = computeLevelNums(nodes);

  const childrenOf = new Map();
  for (const n of nodes) {
    const pk = n.parentKey ?? '';
    if (!childrenOf.has(pk)) childrenOf.set(pk, []);
    childrenOf.get(pk).push(n);
  }

  function buildNode(n) {
    const fields = {};
    for (const col of columns) fields[col.title] = stripHtml(getFieldValue(n, col));
    const item = { number: levelNum(n, levelNumbers), type: n.row.type, fields };
    const kids = childrenOf.get(n.nodeKey);
    if (kids?.length) item.children = kids.map(buildNode);
    return item;
  }

  const data = {
    bom: bomName,
    exportedAt: new Date().toISOString().split('T')[0],
    items: [buildNode(nodes[0])],
  };

  downloadFile(JSON.stringify(data, null, 2), `${sanitizeFilename(bomName)}.json`, 'application/json');
}

// ─── CSV export ────────────────────────────────────────────────────────────

export async function exportCsv(rootRow, columns, { bomName, summary = false }) {
  const nodes = await fetchFullSubtree(rootRow);

  if (summary) {
    const entries = buildSummary(nodes);
    const nonQtyCols = columns.filter((c) => c.key !== '__quantity');
    const headers = ['Type', ...nonQtyCols.map((c) => c.title), 'Total Qty', 'Occurrences'];
    const lines = [
      headers.map(csvEscape).join(','),
      ...entries.map((e) => {
        const cells = [
          e.node.row.type,
          ...nonQtyCols.map((c) => stripHtml(getFieldValue(e.node, c))),
          fmtQty(e.totalQty),
          String(e.count),
        ];
        return cells.map(csvEscape).join(',');
      }),
    ];
    downloadFile(lines.join('\r\n'), `${sanitizeFilename(bomName)}-summary.csv`, 'text/csv;charset=utf-8');
    return;
  }

  const levelNumbers = computeLevelNums(nodes);

  const headers = ['#', 'Type', ...columns.map((c) => c.title)];
  const lines = [
    headers.map(csvEscape).join(','),
    ...nodes.map((n) => {
      const cells = [
        levelNum(n, levelNumbers),
        n.row.type,
        ...columns.map((c) => stripHtml(getFieldValue(n, c))),
      ];
      return cells.map(csvEscape).join(',');
    }),
  ];

  downloadFile(lines.join('\r\n'), `${sanitizeFilename(bomName)}.csv`, 'text/csv;charset=utf-8');
}

// ─── HTML export (interactive) ─────────────────────────────────────────────

export async function exportHtml(rootRow, columns, { bomName, summary = false }) {
  const nodes = await fetchFullSubtree(rootRow);
  const html = summary
    ? _generateSummaryHtml(buildSummary(nodes), columns, { bomName, printMode: false })
    : _generateHtml(nodes, columns, computeLevelNums(nodes), { bomName, printMode: false });
  downloadFile(html, `${sanitizeFilename(bomName)}${summary ? '-summary' : ''}.html`, 'text/html;charset=utf-8');
}

// ─── PDF export (HTML → browser print dialog) ──────────────────────────────

export async function exportPdf(rootRow, columns, { bomName, summary = false }) {
  const nodes = await fetchFullSubtree(rootRow);
  const html = summary
    ? _generateSummaryHtml(buildSummary(nodes), columns, { bomName, printMode: true })
    : _generateHtml(nodes, columns, computeLevelNums(nodes), { bomName, printMode: true });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url);
  if (win) {
    win.addEventListener('load', () => {
      setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 300);
    });
  } else {
    downloadFile(html, `${sanitizeFilename(bomName)}.html`, 'text/html;charset=utf-8');
  }
}

// ─── Summary HTML generator ────────────────────────────────────────────────

function _generateSummaryHtml(entries, columns, { bomName, printMode }) {
  const date = new Date().toLocaleDateString();
  const nonQtyCols = columns.filter((c) => c.key !== '__quantity');

  const thCells =
    nonQtyCols.map((c) => `<th>${escHtml(c.title)}</th>`).join('') +
    `<th>Total Qty</th><th>Occurrences</th>`;

  const bodyRows = entries
    .map((e) => {
      const cells = nonQtyCols
        .map((c) => {
          const val = stripHtml(getFieldValue(e.node, c));
          if (isKeyCol(c)) {
            const url = buildItemUrl(e.node);
            const inner = url
              ? `<a class="key-link" href="${escHtml(url)}" target="_blank">${escHtml(val)}</a>`
              : escHtml(val);
            return `<td>${inner}</td>`;
          }
          return `<td>${escHtml(val)}</td>`;
        })
        .join('');
      return `<tr>${cells}<td>${escHtml(fmtQty(e.totalQty))}</td><td>${e.count}</td></tr>`;
    })
    .join('\n');

  const printScript = printMode
    ? `<script>window.addEventListener('load',function(){setTimeout(window.print,400);})<\/script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOM Summary: ${escHtml(bomName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,Arial,sans-serif;padding:16px;color:#1a1a2e;font-size:13px}
h1{font-size:18px;color:#5C35A8;margin:0 0 2px}
.meta{font-size:12px;color:#888;margin-bottom:16px}
table{border-collapse:collapse;width:100%;table-layout:auto}
thead{position:sticky;top:0;z-index:1}
th{background:#5C35A8;color:#fff;padding:7px 10px;text-align:left;font-size:12px;font-weight:600;white-space:nowrap}
td{padding:5px 10px;border-bottom:1px solid #e8e0f5;vertical-align:middle}
tr:nth-child(even) td{background:#fafafe}
tr:hover td{background:#eae5f5}
.key-link{color:#5C35A8;text-decoration:none;font-weight:600}
.key-link:hover{color:#3D2070;text-decoration:underline}
@media print{
  thead{position:static}
  th{background:#5C35A8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<h1>${escHtml(bomName)}</h1>
<p class="meta">Summary · Exported ${escHtml(date)} · ${entries.length} unique parts</p>
<table>
<thead><tr>${thCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
${printScript}
</body>
</html>`;
}

// ─── Shared HTML generator ─────────────────────────────────────────────────

function _generateHtml(nodes, columns, levelNumbers, { bomName, printMode }) {
  const date = new Date().toLocaleDateString();

  // Sequential integers as stable HTML IDs.
  const htmlId = new Map();
  nodes.forEach((n, i) => htmlId.set(n.nodeKey, String(i + 1)));

  const hasKidsSet = new Set(nodes.filter((n) => n.parentKey).map((n) => n.parentKey));

  const thCells =
    `<th>Tree</th>` + columns.map((c) => `<th>${escHtml(c.title)}</th>`).join('');

  const bodyRows = nodes
    .map((n) => {
      const id = htmlId.get(n.nodeKey);
      const pid = n.parentKey ? htmlId.get(n.parentKey) : '';
      const lNum = levelNum(n, levelNumbers);
      const hasKids = hasKidsSet.has(n.nodeKey);
      const indent = n.depth * 20;
      const hidden = !printMode && n.depth >= 2;

      const iconHtml = n.isRoot
        ? `<span style="color:#5C35A8;font-size:12px">▤</span>`
        : hasKids
          ? `<span style="color:#F5A623;font-size:12px">⚙</span>`
          : `<span style="color:#999;font-size:12px">⬡</span>`;

      const chevronClass = `chevron${hasKids ? (n.depth === 0 ? ' open' : '') : ' leaf'}`;
      const chevronHtml = printMode
        ? ''
        : `<span class="${chevronClass}" data-id="${id}"${hasKids ? ` onclick="toggle('${id}')"` : ''}>&#9658;</span>`;

      const treeCell =
        `<td><div class="cell-tree" style="padding-left:${indent}px">` +
        `${chevronHtml}<span class="num">${escHtml(lNum)}</span>${iconHtml}</div></td>`;

      const dataCells = columns
        .map((c) => {
          const val = stripHtml(getFieldValue(n, c));
          if (isKeyCol(c)) {
            const url = buildItemUrl(n);
            const inner = url
              ? `<a class="key-link" href="${escHtml(url)}" target="_blank">${escHtml(val)}</a>`
              : escHtml(val);
            return `<td>${inner}</td>`;
          }
          return `<td>${escHtml(val)}</td>`;
        })
        .join('');

      return `<tr data-id="${id}" data-parent="${pid}"${hidden ? ' style="display:none"' : ''}>${treeCell}${dataCells}</tr>`;
    })
    .join('\n');

  const initExpanded = nodes
    .filter((n) => n.depth === 0 && hasKidsSet.has(n.nodeKey))
    .map((n) => `'${htmlId.get(n.nodeKey)}'`)
    .join(',');

  const interactiveScript = printMode ? '' : `<script>
const expanded=new Set([${initExpanded}]);
function toggle(id){
  expanded.has(id)?expanded.delete(id):expanded.add(id);
  const btn=document.querySelector('.chevron[data-id="'+id+'"]');
  if(btn)btn.classList.toggle('open',expanded.has(id));
  applyVis();
}
function applyVis(){
  for(const tr of document.querySelectorAll('tbody tr[data-id]')){
    const pid=tr.dataset.parent;
    if(!pid){tr.style.display='';continue;}
    const p=document.querySelector('tr[data-id="'+pid+'"]');
    tr.style.display=(p&&p.style.display!=='none'&&expanded.has(pid))?'':'none';
  }
}
<\/script>`;

  const printScript = printMode
    ? `<script>window.addEventListener('load',function(){setTimeout(window.print,400);})<\/script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOM: ${escHtml(bomName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,Arial,sans-serif;padding:16px;color:#1a1a2e;font-size:13px}
h1{font-size:18px;color:#5C35A8;margin:0 0 4px}
.meta{font-size:12px;color:#888;margin-bottom:16px}
table{border-collapse:collapse;width:100%;table-layout:auto}
thead{position:sticky;top:0;z-index:1}
th{background:#5C35A8;color:#fff;padding:7px 10px;text-align:left;font-size:12px;font-weight:600;white-space:nowrap}
td{padding:5px 10px;border-bottom:1px solid #e8e0f5;vertical-align:middle}
tr:nth-child(even) td{background:#fafafe}
tr:hover td{background:#eae5f5}
.cell-tree{display:flex;align-items:center;gap:4px;white-space:nowrap}
.chevron{cursor:pointer;display:inline-block;width:14px;text-align:center;color:#5C35A8;font-size:10px;transition:transform .15s;user-select:none;flex-shrink:0}
.chevron.open{transform:rotate(90deg)}
.chevron.leaf{visibility:hidden}
.num{color:#aaa;font-size:11px;min-width:28px;text-align:right;flex-shrink:0}
.key-link{color:#5C35A8;text-decoration:none;font-weight:600}
.key-link:hover{color:#3D2070;text-decoration:underline}
@media print{
  thead{position:static}
  th{background:#5C35A8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .chevron{display:none}
  tr[style*="display:none"]{display:none!important}
}
</style>
</head>
<body>
<h1>${escHtml(bomName)}</h1>
<p class="meta">Exported ${escHtml(date)}</p>
<table>
<thead><tr>${thCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
${interactiveScript}
${printScript}
</body>
</html>`;
}
