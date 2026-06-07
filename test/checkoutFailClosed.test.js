import { describe, it, expect, afterEach } from 'vitest';
import { engage, _setRelayForTest, _resetForTest } from '../src/content/checkout.js';
import { isOverlayShown } from '../src/content/overlay.js';

afterEach(() => _resetForTest());

describe('engage fail-closed', () => {
  it('still blocks the page when the relay throws', async () => {
    _setRelayForTest({ listPending: async () => { throw new Error('offline'); } });
    await engage({ guardianName: 'Al' }, { total: 10, items: [{ title: 'X' }] });
    expect(isOverlayShown()).toBe(true);
    expect(document.getElementById('parago-guardian-overlay').dataset.status).toBe('error');
  });

  it('blocks when submitRequest yields no usable request', async () => {
    _setRelayForTest({ listPending: async () => [], submitRequest: async () => 'id1', getRequest: async () => null });
    await engage({ guardianName: 'Al' }, { total: 10, items: [{ title: 'X' }] });
    expect(isOverlayShown()).toBe(true);
    expect(document.getElementById('parago-guardian-overlay').dataset.status).toBe('error');
  });
});
