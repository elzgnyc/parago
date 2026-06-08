// test/placementStore.test.js
import { describe, it, expect } from 'vitest';
import { createPlacementStore } from '../src/lib/placementStore.js';

function fakeStore() {
  let data = {};
  return { get: async () => ({ ...data }), set: async (v) => { data = { ...v }; } };
}

describe('placementStore', () => {
  it('puts, gets, patches and removes records', async () => {
    const s = createPlacementStore(fakeStore());
    await s.put('id1', { status: 'pending', createdAt: 1 });
    expect(await s.get('id1')).toEqual({ status: 'pending', createdAt: 1 });

    await s.patch('id1', { status: 'placed' });
    expect((await s.get('id1')).status).toBe('placed');

    expect(Object.keys(await s.all())).toEqual(['id1']);

    await s.remove('id1');
    expect(await s.get('id1')).toBeNull();
  });

  it('patch on a missing id returns null and writes nothing', async () => {
    const s = createPlacementStore(fakeStore());
    expect(await s.patch('nope', { status: 'x' })).toBeNull();
    expect(Object.keys(await s.all())).toEqual([]);
  });
});
