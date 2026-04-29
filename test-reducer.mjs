// Smoke test: exercise the reducer logic in isolation.
// Runs: node test-reducer.mjs

import { readFile } from 'node:fs/promises';

// Load the source and extract the reducer + makeNode + nextNodeKey by eval'ing
// a CommonJS shim. Cleaner approach: re-implement the same logic here.
// Instead, copy-paste the relevant pieces from useBomChildren.js to keep this
// test fast and self-contained.

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

const initialState = { nodes: [], topLoading: false, topError: null };

function findIndexByKey(nodes, key) {
  return nodes.findIndex((n) => n.nodeKey === key);
}

function reducer(state, action) {
  switch (action.type) {
    case 'TOP_LOAD_OK':
      return {
        ...state,
        topLoading: false,
        topError: null,
        nodes: action.rows.map((row) =>
          makeNode(row, { depth: 0, isRoot: true })
        ),
      };

    case 'CHILD_LOAD_OK': {
      const { parentKey, rows, childKeys } = action;
      const parentIdx = findIndexByKey(state.nodes, parentKey);
      if (parentIdx < 0) return state;
      const parent = state.nodes[parentIdx];
      if (parent.expanded && parent.loaded) return state;

      const newChildren = rows.map((row, i) => {
        const node = makeNode(row, {
          parentKey,
          depth: parent.depth + 1,
        });
        if (childKeys && childKeys[i]) node.nodeKey = childKeys[i];
        return node;
      });

      const updatedParent = {
        ...parent,
        loading: false,
        loaded: true,
        expanded: true,
        childCount: rows.length,
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

    case 'COLLAPSE': {
      const parentIdx = findIndexByKey(state.nodes, action.parentKey);
      if (parentIdx < 0) return state;
      const parent = state.nodes[parentIdx];
      let endIdx = parentIdx + 1;
      while (
        endIdx < state.nodes.length &&
        state.nodes[endIdx].depth > parent.depth
      )
        endIdx++;
      return {
        ...state,
        nodes: [
          ...state.nodes.slice(0, parentIdx),
          { ...parent, expanded: false },
          ...state.nodes.slice(endIdx),
        ],
      };
    }

    default:
      return state;
  }
}

// ─── Tests ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

console.log('Test 1: load top-level rows');
{
  const s1 = reducer(initialState, {
    type: 'TOP_LOAD_OK',
    rows: [
      { id: '34888', objName: 'BOM 1' },
      { id: '34999', objName: 'BOM 2' },
    ],
  });
  assert(s1.nodes.length === 2, '2 root nodes');
  assert(s1.nodes[0].depth === 0 && s1.nodes[0].isRoot, 'first is root');
  assert(s1.nodes[0].nodeKey !== s1.nodes[1].nodeKey, 'unique nodeKeys');
}

console.log('Test 2: same Orcanos id can appear under multiple parents');
{
  let s = reducer(initialState, {
    type: 'TOP_LOAD_OK',
    rows: [
      { id: 'A', objName: 'Bom A' },
      { id: 'B', objName: 'Bom B' },
    ],
  });

  const aKey = s.nodes[0].nodeKey;
  const bKey = s.nodes[1].nodeKey;

  // Expand A with shared child SHARED.
  const sharedKey1 = nextNodeKey();
  s = reducer(s, {
    type: 'CHILD_LOAD_OK',
    parentKey: aKey,
    rows: [{ id: 'SHARED', objName: 'Shared Part' }],
    childKeys: [sharedKey1],
  });

  // Expand B with the SAME shared child.
  const sharedKey2 = nextNodeKey();
  s = reducer(s, {
    type: 'CHILD_LOAD_OK',
    parentKey: bKey,
    rows: [{ id: 'SHARED', objName: 'Shared Part' }],
    childKeys: [sharedKey2],
  });

  assert(s.nodes.length === 4, '4 total nodes (A, SHARED, B, SHARED)');
  assert(sharedKey1 !== sharedKey2, 'two distinct keys for the shared part');
  // Both should be findable independently.
  const a = s.nodes.find((n) => n.nodeKey === aKey);
  const b = s.nodes.find((n) => n.nodeKey === bKey);
  assert(a.childCount === 1 && a.expanded, 'A is expanded');
  assert(b.childCount === 1 && b.expanded, 'B is expanded');

  // Collapse only A.
  s = reducer(s, { type: 'COLLAPSE', parentKey: aKey });
  assert(s.nodes.length === 3, 'after collapse A: 3 nodes (A, B, SHARED-under-B)');
  assert(
    s.nodes.find((n) => n.nodeKey === aKey).expanded === false,
    'A collapsed'
  );
  assert(
    s.nodes.find((n) => n.nodeKey === bKey).expanded === true,
    'B still expanded'
  );
  assert(
    s.nodes.find((n) => n.nodeKey === sharedKey2),
    "B's child still in tree"
  );
  assert(
    !s.nodes.find((n) => n.nodeKey === sharedKey1),
    "A's child removed"
  );
}

console.log('Test 3: collapse removes ALL descendants');
{
  let s = reducer(initialState, {
    type: 'TOP_LOAD_OK',
    rows: [{ id: 'R', objName: 'Root' }],
  });
  const rKey = s.nodes[0].nodeKey;

  // Expand R with one child M.
  const mKey = nextNodeKey();
  s = reducer(s, {
    type: 'CHILD_LOAD_OK',
    parentKey: rKey,
    rows: [{ id: 'M', objName: 'Middle' }],
    childKeys: [mKey],
  });

  // Expand M with two grandchildren.
  const gKey1 = nextNodeKey();
  const gKey2 = nextNodeKey();
  s = reducer(s, {
    type: 'CHILD_LOAD_OK',
    parentKey: mKey,
    rows: [
      { id: 'G1', objName: 'Grand 1' },
      { id: 'G2', objName: 'Grand 2' },
    ],
    childKeys: [gKey1, gKey2],
  });

  assert(s.nodes.length === 4, '4 nodes total');

  // Collapse R should remove M, G1, G2.
  s = reducer(s, { type: 'COLLAPSE', parentKey: rKey });
  assert(s.nodes.length === 1, 'after collapsing R, only R remains');
  assert(s.nodes[0].nodeKey === rKey, 'R is the only one left');
}

console.log('Test 4: re-dispatching CHILD_LOAD_OK on already-loaded parent is a no-op');
{
  let s = reducer(initialState, {
    type: 'TOP_LOAD_OK',
    rows: [{ id: 'R', objName: 'Root' }],
  });
  const rKey = s.nodes[0].nodeKey;

  s = reducer(s, {
    type: 'CHILD_LOAD_OK',
    parentKey: rKey,
    rows: [{ id: 'C', objName: 'Child' }],
    childKeys: [nextNodeKey()],
  });
  const lengthAfterFirst = s.nodes.length;

  // Try to dispatch the same load again.
  s = reducer(s, {
    type: 'CHILD_LOAD_OK',
    parentKey: rKey,
    rows: [{ id: 'C', objName: 'Child' }],
    childKeys: [nextNodeKey()],
  });
  assert(
    s.nodes.length === lengthAfterFirst,
    'duplicate CHILD_LOAD_OK does not re-insert children'
  );
}

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
