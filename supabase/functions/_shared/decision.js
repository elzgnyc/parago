// Pure guard shared by the decision Edge Function and unit tests.
// Decides whether a guardian's decision link may still act on a request.
// Order matters: not_found > used > decided > expired.
export function isActionable(row, nowMs) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.token_used) return { ok: false, reason: 'used' };
  if (row.status !== 'pending') return { ok: false, reason: 'decided' };
  if (new Date(row.expires_at).getTime() <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, reason: null };
}
