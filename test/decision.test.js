import { describe, it, expect } from 'vitest';
import { isActionable } from '../supabase/functions/_shared/decision.js';

const NOW = 1_000_000;
const base = { status: 'pending', token_used: false, expires_at: new Date(NOW + 60_000).toISOString() };

describe('isActionable', () => {
  it('allows a pending, unused, unexpired row', () => {
    expect(isActionable(base, NOW)).toEqual({ ok: true, reason: null });
  });
  it('rejects a missing row', () => {
    expect(isActionable(null, NOW)).toEqual({ ok: false, reason: 'not_found' });
  });
  it('rejects an already-used token', () => {
    expect(isActionable({ ...base, token_used: true }, NOW)).toEqual({ ok: false, reason: 'used' });
  });
  it('rejects an already-decided row', () => {
    expect(isActionable({ ...base, status: 'approved' }, NOW)).toEqual({ ok: false, reason: 'decided' });
  });
  it('rejects an expired row', () => {
    expect(isActionable({ ...base, expires_at: new Date(NOW - 1).toISOString() }, NOW)).toEqual({ ok: false, reason: 'expired' });
  });
});
