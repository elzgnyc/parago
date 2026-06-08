// test/orderSnapshot.test.js
import { describe, it, expect } from 'vitest';
import { buildSnapshot, snapshotsMatch } from '../src/lib/orderSnapshot.js';

describe('orderSnapshot', () => {
  it('normalizes items and total', () => {
    const s = buildSnapshot({ items: [{ asin: 'A1', title: ' Widget ' }], total: 12.5 }, 1000);
    expect(s).toEqual({
      items: [{ asin: 'A1', qty: 1, title: 'Widget' }],
      total: 12.5, addressHint: null, createdAt: 1000,
    });
  });

  it('matches identical snapshots', () => {
    const a = buildSnapshot({ items: [{ asin: 'A1' }], total: 10 }, 1);
    const b = buildSnapshot({ items: [{ asin: 'A1' }], total: 10 }, 2);
    expect(snapshotsMatch(a, b)).toBe(true);
  });

  it('fails when total drifts beyond epsilon', () => {
    const a = buildSnapshot({ items: [{ asin: 'A1' }], total: 10 }, 1);
    const b = buildSnapshot({ items: [{ asin: 'A1' }], total: 10.5 }, 2);
    expect(snapshotsMatch(a, b)).toBe(false);
  });

  it('fails when an item is added or removed', () => {
    const a = buildSnapshot({ items: [{ asin: 'A1' }], total: 10 }, 1);
    const b = buildSnapshot({ items: [{ asin: 'A1' }, { asin: 'A2' }], total: 10 }, 2);
    expect(snapshotsMatch(a, b)).toBe(false);
  });

  it('fails when either side is null', () => {
    expect(snapshotsMatch(null, buildSnapshot({ total: 1 }))).toBe(false);
  });

  it('fails when totals are unknown (null)', () => {
    const a = buildSnapshot({ items: [{ asin: 'A1' }], total: null }, 1);
    const b = buildSnapshot({ items: [{ asin: 'A1' }], total: null }, 2);
    expect(snapshotsMatch(a, b)).toBe(false);
  });
});
