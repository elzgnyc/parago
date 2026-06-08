import { getSettings } from '../settings/storage.js';
import { setLang } from '../i18n/i18n.js';
import { parseCart } from '../lib/parseCart.js';
import { shouldRequireApproval } from '../lib/guardianTrigger.js';
import { isApprovedForTotal, recordApproval } from '../lib/approval.js';
import { MockRelay } from '../relay/mockRelay.js';
import { SupabaseRelay } from '../relay/supabaseRelay.js';
import { CONFIG } from '../config.js';
import { shouldUseSupabase } from '../relay/selectRelay.js';
import { RELAY_STATUS } from '../relay/relayClient.js';
import { showOverlay, setOverlayStatus, removeOverlay } from './overlay.js';
import { parseFinalOrderTotal, isPlaceOrderClick, findPlaceOrderControl } from '../lib/placeOrder.js';
import { buildSnapshot } from '../lib/orderSnapshot.js';
import { createPlacementStore } from '../lib/placementStore.js';
import { runPlacementCompletion } from './placementManager.js';
import { showProcessing, showCouldNotComplete } from './placementOverlay.js';
import { consumeSuppress } from './interceptGuard.js';

const APPROVALS_KEY = 'parago_approvals';
const TOTAL_EPSILON = 0.005;

// Relay is swappable. Built from settings in run() (see buildRelay). Tests may
// override via the exported setter.
export let relay = new MockRelay();
export function _setRelayForTest(r) { relay = r; }

// Ask the background worker for an asin's rating/review count. Resolves to a
// {rating, reviewCount} object even on failure; null fields mean "unknown".
function bgProductMeta(asin) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'parago_product_meta', asin }, (resp) => {
        if (chrome.runtime && chrome.runtime.lastError) return resolve({ rating: null, reviewCount: null });
        resolve(resp || { rating: null, reviewCount: null });
      });
    } catch (e) { resolve({ rating: null, reviewCount: null }); }
  });
}

// Enrich cart items with rating/reviews just before a relay submit. Fail soft and
// time-bounded: a slow Amazon response must never hang checkout, so each lookup
// races a timer; on timeout/error/no-asin the item passes through unchanged. In
// vitest (no chrome mock) this is a pure pass-through so existing tests still pass.
export async function enrichItems(items, { timeoutMs = 2000 } = {}) {
  if (!Array.isArray(items) || !items.length) return items || [];
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return items;
  return Promise.all(items.map(async (item) => {
    if (!item || !item.asin) return item;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const meta = await Promise.race([bgProductMeta(item.asin), timeout]);
    if (!meta) return item; // timed out: leave unchanged
    return { ...item, rating: meta.rating ?? null, reviewCount: meta.reviewCount ?? null };
  }));
}

function buildRelay(settings) {
  if (shouldUseSupabase(settings, CONFIG)) {
    return new SupabaseRelay({
      baseUrl: CONFIG.functionsBaseUrl,
      guardianEmail: settings.guardianEmail,
      guardianName: settings.guardianName,
    });
  }
  return new MockRelay();
}

function getApprovals() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [APPROVALS_KEY]: [] }, (d) => resolve(d[APPROVALS_KEY] || []));
  });
}
function saveApprovals(list) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [APPROVALS_KEY]: list }, () => resolve());
  });
}

function totalsMatch(a, b) {
  return a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) < TOTAL_EPSILON;
}

// Which already-pending request (if any) should this page reuse instead of creating a new one?
// Matching by total dedupes across the cart and checkout pages and on reload. With an unknown
// total, reuse the most recent pending request rather than spawning duplicates.
export function pickPendingRequest(pendingList, total) {
  const list = Array.isArray(pendingList) ? pendingList : [];
  const byTotal = list.find((r) => totalsMatch(r.total, total));
  if (byTotal) return byTotal;
  if (total == null && list.length) {
    return list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  }
  return null;
}

let activeRequestId = null;
let unsubscribe = null;

function teardown() {
  if (unsubscribe) { try { unsubscribe(); } catch (e) { /* no-op */ } unsubscribe = null; }
  activeRequestId = null;
}

// Test-only: reset module state + overlay between tests.
export function _resetForTest() {
  teardown();
  removeOverlay();
}

async function onApproved(total) {
  if (total != null) {
    const approvals = await getApprovals();
    if (!isApprovedForTotal(approvals, total)) {
      await saveApprovals(recordApproval(approvals, total, Date.now()));
    }
  }
  setOverlayStatus(RELAY_STATUS.APPROVED);
  teardown();
  setTimeout(removeOverlay, 1200);
}

export async function engage(settings, parsed) {
  const onCancel = () => { try { history.back(); } catch (e) { /* no-op */ } };

  // Paint the blocking overlay BEFORE any relay round-trip. With a remote relay,
  // listPending/submitRequest/getRequest are network calls; gating the overlay
  // behind them left the cart usable (and looked like a pause) during that
  // latency. Show 'pending' immediately, then resolve the request and update.
  showOverlay({ items: parsed.items, total: parsed.total, guardianName: settings.guardianName, status: 'pending', onCancel });

  let req = null;
  try {
    const pending = await relay.listPending();
    req = pickPendingRequest(pending, parsed.total);
    if (!req) {
      const enrichedItems = await enrichItems(parsed.items);
      const id = await relay.submitRequest({ total: parsed.total, items: enrichedItems });
      req = await relay.getRequest(id);
    }
  } catch (e) {
    // Fail closed: keep the page blocked, just surface the error.
    setOverlayStatus('error');
    return;
  }
  if (!req) {
    setOverlayStatus('error');
    return;
  }
  activeRequestId = req.id;

  const effTotal = parsed.total != null ? parsed.total : req.total;
  const items = parsed.items && parsed.items.length ? parsed.items : (req.items || []);

  // Repaint only if the relay filled in a total/items the page couldn't parse;
  // otherwise just flip the status, to avoid a flicker.
  if (parsed.total == null || !(parsed.items && parsed.items.length)) {
    showOverlay({ items, total: effTotal, guardianName: settings.guardianName, status: req.status, onCancel });
  } else {
    setOverlayStatus(req.status);
  }

  if (req.status === RELAY_STATUS.APPROVED) { await onApproved(effTotal); return; }
  if (req.status === RELAY_STATUS.REJECTED) { setOverlayStatus(RELAY_STATUS.REJECTED); return; }

  unsubscribe = relay.onChange((map) => {
    const rec = map && map[activeRequestId];
    if (!rec) return;
    if (rec.status === RELAY_STATUS.APPROVED) onApproved(effTotal);
    else if (rec.status === RELAY_STATUS.REJECTED) setOverlayStatus(RELAY_STATUS.REJECTED);
  });
}

async function waitForTotal(maxMs = 3000, stepMs = 300) {
  let parsed = parseCart(document);
  let waited = 0;
  while (parsed.total == null && waited < maxMs) {
    await new Promise((r) => setTimeout(r, stepMs));
    waited += stepMs;
    parsed = parseCart(document);
  }
  return parsed;
}

const placements = createPlacementStore();

// Decide, at place-order time, whether this purchase needs a hold. Uses the FINAL
// order total on the checkout page (includes shipping + tax) and falls back to the
// cart parse. Fail-closed via shouldRequireApproval for unknown totals in over_limit.
export function evaluatePlaceOrder(settings, root = document) {
  const finalTotal = parseFinalOrderTotal(root);
  const parsed = parseCart(root);
  const total = finalTotal != null ? finalTotal : parsed.total;
  return { hold: shouldRequireApproval(settings, total), total, items: parsed.items };
}

let armedSettings = null;
async function onPlaceOrderClickCapture(ev) {
  if (!armedSettings) return;
  if (consumeSuppress()) return; // our own programmatic placement click: let it through
  if (!isPlaceOrderClick(ev, document)) return;
  const { hold, total, items } = evaluatePlaceOrder(armedSettings, document);
  if (!hold) return; // under limit / off: let Amazon place it normally
  ev.preventDefault();
  ev.stopImmediatePropagation();
  showProcessing(); // blocking success screen prevents a second submit
  try {
    const enriched = await enrichItems(items);
    const id = await relay.submitRequest({ total, items: enriched });
    await placements.put(id, {
      snapshot: buildSnapshot({ items, total }, Date.now()),
      status: 'pending', createdAt: Date.now(), placedAt: null, lastError: null,
    });
  } catch (e) {
    // Fail closed: the order was NOT placed (we preventDefault'd). Tell the shopper.
    showCouldNotComplete();
  }
}

export function armPlaceOrderIntercept(settings) {
  armedSettings = settings;
  // Capture phase so we run before Amazon's own submit handler.
  document.addEventListener('click', onPlaceOrderClickCapture, true);
}

// Fail closed: are we on a final place-order page that needs approval but whose
// place-order control we cannot recognize? The click interceptor can only catch a
// button it can find, so if the button is unrecognized an un-intercepted click would
// place the order with no approval. In that case the caller must hard-block instead.
export function needsHardBlockFallback(settings, root = document) {
  if (parseFinalOrderTotal(root) == null) return false;   // not the final order page
  const { hold } = evaluatePlaceOrder(settings, root);
  if (!hold) return false;                                 // no approval needed
  return findPlaceOrderControl(root) == null;              // recognized -> interceptor handles it
}

// Watch the checkout page; if it is a final place-order page we cannot intercept,
// fall back to the old full-screen blocking overlay (engage) so nothing places
// unreviewed. Re-checks on DOM mutations because the total/button can render late.
function guardUnrecognizedCheckout(settings, pageIsCheckout) {
  if (!pageIsCheckout) return;
  const tryGuard = () => {
    if (!needsHardBlockFallback(settings, document)) return false;
    const { total, items } = evaluatePlaceOrder(settings, document);
    engage(settings, { total, items });
    return true;
  };
  if (tryGuard()) return;
  const obs = new MutationObserver(() => { if (tryGuard()) obs.disconnect(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 15000);
}

function isCheckoutPage() {
  const p = (typeof location !== 'undefined' && location.pathname) || '';
  return /\/gp\/buy\//.test(p) || /\/checkout/.test(p);
}

export async function run() {
  const settings = await getSettings();
  setLang(settings.lang);
  relay = buildRelay(settings);

  // Stage 3: finish any approved order from a previous visit (runs on every page).
  await runPlacementCompletion({ relay });

  if (settings.guardianMode === 'off') return;

  // Stage 1: arm the place-order interception (the cart page no longer blocks; the
  // gate is the place-order click), plus a fail-closed hard-block for any checkout
  // page whose place-order button we cannot recognize.
  armPlaceOrderIntercept(settings);
  guardUnrecognizedCheckout(settings, isCheckoutPage());
}
