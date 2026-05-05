/**
 * Format a number as a cost string: 9,999,999.00
 * Deterministic — does not depend on browser locale.
 */
export function fmtCost(n) {
  const fixed = Number(n).toFixed(2);
  const [int, dec] = fixed.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

/** Matches any column whose title or key contains "cost" or "price". */
const COST_RE = /cost|price/i;

export function isCostColumn(c) {
  return (
    COST_RE.test(String(c.title || '')) ||
    COST_RE.test(String(c.key || ''))
  );
}

/**
 * Given a raw cell value (possibly containing HTML or currency symbols),
 * parse it as a number and return a formatted cost string.
 * Returns the original value unchanged if it doesn't parse as a finite number.
 */
export function formatCostValue(raw) {
  const stripped = String(raw).replace(/<[^>]+>/g, '').trim();
  if (!stripped) return raw;
  const num = parseFloat(stripped.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(num)) return raw;
  return fmtCost(num);
}
