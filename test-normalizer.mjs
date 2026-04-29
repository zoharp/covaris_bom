// Smoke test for the row normalizer.
//
// Re-implements extractNumericId locally so we can run it under Node without
// importing ESM modules with browser-only APIs (TextEncoder is fine; localStorage
// is not, but we don't touch the parts that use it).
//
// Runs: node test-normalizer.mjs

function extractNumericId(s) {
  if (!s) return '';
  const m = String(s).match(/\((\d+)\)\s*$/);
  if (m) return m[1];
  return '';
}

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

console.log('extractNumericId — design doc examples');
// From the source doc:
//   PRT-34237-310020 ... (34237)  → 34237
//   190817 CP02 CryoPrep Final; Assy 220V (33392)  → 33392
//   500000 CP02 CRYOPREP INSTRUMENT - V220 (34888) → 34888
// And the API doc:
//   "T_CASE-46584 (42195)" → 42195

eq(extractNumericId('PRT-34237-310020 Screw,sckt hd cap,M4 x 12 SS (34237)'), '34237', 'screw key');
eq(extractNumericId('190817 CP02 CryoPrep Final; Assy 220V (33392)'), '33392', 'sub-assy key');
eq(extractNumericId('500000 CP02 CRYOPREP INSTRUMENT - V220 (34888)'), '34888', 'top BOM key');
eq(extractNumericId('T_CASE-46584 (42195)'), '42195', 'API doc example');

console.log('extractNumericId — edge cases');
eq(extractNumericId(''), '', 'empty');
eq(extractNumericId(null), '', 'null');
eq(extractNumericId(undefined), '', 'undefined');
eq(extractNumericId(12345), '', 'number with no parenthetical');
eq(extractNumericId('Item without parens'), '', 'no parenthetical');
eq(extractNumericId('Trailing whitespace (123) '), '123', 'trailing whitespace');
eq(extractNumericId('Multiple (456) (789)'), '789', 'multiple — last wins');

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
