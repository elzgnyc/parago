// src/lib/placementStore.js
// Local source of truth for orders held in purgatory. Mirrors SupabaseRelay's
// injectable {get,set} store so tests pass a fake.
const STORE_KEY = 'parago_placements';

function chromeLocalStore() {
  return {
    get: () => new Promise((r) => chrome.storage.local.get({ [STORE_KEY]: {} }, (d) => r(d[STORE_KEY] || {}))),
    set: (v) => new Promise((r) => chrome.storage.local.set({ [STORE_KEY]: v }, () => r())),
  };
}

export function createPlacementStore(store = chromeLocalStore()) {
  return {
    async all() { return store.get(); },
    async get(id) { return (await store.get())[id] || null; },
    async put(id, rec) { const m = await store.get(); m[id] = rec; await store.set(m); return rec; },
    async patch(id, patch) {
      const m = await store.get();
      if (!m[id]) return null;
      m[id] = { ...m[id], ...patch };
      await store.set(m);
      return m[id];
    },
    async remove(id) { const m = await store.get(); delete m[id]; await store.set(m); },
  };
}
