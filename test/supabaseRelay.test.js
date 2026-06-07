import { describe, it, expect, vi } from 'vitest';
import { SupabaseRelay } from '../src/relay/supabaseRelay.js';

// Fake transport: records calls, returns queued responses.
function fakeSend(responses) {
  const calls = [];
  const send = async (url, options) => { calls.push({ url, options }); return responses.shift(); };
  return { send, calls };
}
// In-memory store (mirrors MockRelay's injectable deps).
function memStore() {
  let data = {};
  return { get: async () => data, set: async (v) => { data = v; } };
}

const cfg = { baseUrl: 'https://x.functions.supabase.co', guardianEmail: 'h@e.com', guardianName: 'Al' };

describe('SupabaseRelay.submitRequest', () => {
  it('POSTs total/items/guardian to create-request and returns the id', async () => {
    const t = fakeSend([{ id: 'req_1' }]);
    const relay = new SupabaseRelay({ ...cfg, send: t.send, store: memStore() });
    const id = await relay.submitRequest({ total: 42.5, items: [{ title: 'X' }] });
    expect(id).toBe('req_1');
    expect(t.calls[0].url).toBe('https://x.functions.supabase.co/create-request');
    const body = JSON.parse(t.calls[0].options.body);
    expect(body).toMatchObject({ total: 42.5, items: [{ title: 'X' }], guardianEmail: 'h@e.com', guardianName: 'Al' });
  });
});

describe('SupabaseRelay.getRequest', () => {
  it('GETs get-status and shapes a record', async () => {
    const t = fakeSend([{ id: 'req_1', status: 'approved', total: 42.5, decidedAt: 't' }]);
    const relay = new SupabaseRelay({ ...cfg, send: t.send, store: memStore() });
    const rec = await relay.getRequest('req_1');
    expect(t.calls[0].url).toBe('https://x.functions.supabase.co/get-status?id=req_1');
    expect(rec).toMatchObject({ id: 'req_1', status: 'approved', total: 42.5 });
  });
});

describe('SupabaseRelay.onChange', () => {
  it('polls all cached pending ids and delivers the active id\'s transition', async () => {
    vi.useFakeTimers();
    const store = memStore();
    // Two pending requests in the cache (the 1-day expiry makes this common).
    await store.set({
      req_a: { id: 'req_a', total: 1, createdAt: 1, status: 'pending' },
      req_b: { id: 'req_b', total: 2, createdAt: 2, status: 'pending' },
    });
    // get-status responses in call order. Tick 1: a,b pending. Tick 2: a approved, b pending.
    const t = fakeSend([
      { id: 'req_a', status: 'pending', total: 1 },
      { id: 'req_b', status: 'pending', total: 2 },
      { id: 'req_a', status: 'approved', total: 1 },
      { id: 'req_b', status: 'pending', total: 2 },
    ]);
    const relay = new SupabaseRelay({ ...cfg, send: t.send, store, pollMs: 1000 });
    const seen = [];
    const unsub = relay.onChange((map) => seen.push(map));

    await vi.advanceTimersByTimeAsync(1000); // tick 1: first sight of both → cb once
    await vi.advanceTimersByTimeAsync(1000); // tick 2: req_a pending→approved → cb again
    unsub();
    vi.useRealTimers();

    expect(seen.length).toBe(2);
    expect(seen[0].req_a.status).toBe('pending');
    expect(seen[1].req_a.status).toBe('approved'); // active id's verdict delivered even with 2 pending
    expect(seen[1].req_b.status).toBe('pending');
  });
});

describe('SupabaseRelay.listPending', () => {
  it('returns locally-remembered pending requests, refreshed via get-status', async () => {
    const store = memStore();
    await store.set({ req_1: { id: 'req_1', total: 5, createdAt: 1, status: 'pending' } });
    const t = fakeSend([{ id: 'req_1', status: 'pending', total: 5 }]);
    const relay = new SupabaseRelay({ ...cfg, send: t.send, store });
    const pending = await relay.listPending();
    expect(pending).toEqual([{ id: 'req_1', total: 5, createdAt: 1, status: 'pending' }]);
  });
  it('drops requests that are no longer pending', async () => {
    const store = memStore();
    await store.set({ req_1: { id: 'req_1', total: 5, createdAt: 1, status: 'pending' } });
    const t = fakeSend([{ id: 'req_1', status: 'approved', total: 5 }]);
    const relay = new SupabaseRelay({ ...cfg, send: t.send, store });
    expect(await relay.listPending()).toEqual([]);
  });
  it('keeps a cached request when the status poll fails transiently (no duplicate email)', async () => {
    const store = memStore();
    await store.set({ req_1: { id: 'req_1', total: 5, createdAt: 1, status: 'pending' } });
    const relay = new SupabaseRelay({ ...cfg, store, send: async () => { throw new Error('offline'); } });
    expect(await relay.listPending()).toEqual([{ id: 'req_1', total: 5, createdAt: 1, status: 'pending' }]);
    expect(await store.get()).toHaveProperty('req_1'); // not evicted on a transient failure
  });
});
