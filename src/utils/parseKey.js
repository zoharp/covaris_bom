// Extracts the numeric ID from an Orcanos Key field.
//
// Orcanos returns Key fields like:
//   "PRT-34237-310020 Screw,sckt hd cap,M4 x 12 SS (34237)"
//   "T_CASE-46584 (42195)"
//
// The number in parentheses at the end is the Orcanos internal ID, which is
// what the Orcanos web URL expects (`?ItemId=<id>`).
//
// Note: the API client's row normalizer does this extraction internally and
// exposes the result as `row.itemId`, so most callers should use that.
// This standalone helper is kept for one-off utility use.

export function parseKey(key) {
  if (!key) return '';
  const m = String(key).match(/\((\d+)\)\s*$/);
  return m ? m[1] : '';
}
