// Tracks which cart totals the guardian has already approved, so the cart step and the
// place-order step do not double-block the same approved cart. Keyed by total amount.
const TOTAL_EPSILON = 0.005;

export function isApprovedForTotal(approvals, total) {
  // Unknown total is never treated as already-approved (stay fail-closed).
  if (total == null || Number.isNaN(total)) return false;
  return (Array.isArray(approvals) ? approvals : []).some(
    (a) => Math.abs(a.total - total) < TOTAL_EPSILON
  );
}

export function recordApproval(approvals, total, ts) {
  const list = Array.isArray(approvals) ? approvals.slice() : [];
  list.push({ total, ts });
  return list;
}
