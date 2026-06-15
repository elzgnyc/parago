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
import { parseFinalOrderTotal, isPlaceOrderClick, findPlaceOrderControl, hasPlaceOrderIntent, CONFIRM_SELECTORS } from '../lib/placeOrder.js';
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
  stopProactiveGuard();
  proactiveDone = false;
  proactivePending = false;
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

// ── Proactive block ───────────────────────────────────────────────────────────
// Amazon's checkout DOM and event model both shift over time: the current SPC
// checkout submits the order on `pointerdown` and navigates before any `click`
// fires, so a click interceptor never runs and the order places unreviewed. Rather
// than depend on catching the exact gesture, we block PROACTIVELY — as soon as the
// shopper is on a place-order page that needs approval we raise the approval overlay
// up front and send the request, no click required. This is the durable guard; the
// click interceptor above is a fast-path secondary on pages it doesn't cover.

const CART_SNAPSHOT_KEY = 'parago_cart_snapshot';
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // older carts aren't trusted for the email

function pathname() {
  return (typeof location !== 'undefined' && location.pathname) || '';
}
function isCheckoutLikeUrl() {
  const p = pathname();
  return /\/checkout\//.test(p) || /\/gp\/buy\//.test(p);
}
function isCartUrl() {
  const p = pathname();
  return /\/gp\/cart\//.test(p) || /\/cart\b/.test(p) || /\/checkout\/entry\/cart/.test(p);
}
// The order is already placed: never block (a lingering "Place your order" label on
// the thank-you page must not false-fire and email the guardian about a done deal).
function isConfirmationPage(root = document) {
  if (/thankyou/i.test(pathname())) return true;
  for (const sel of CONFIRM_SELECTORS) if (root.querySelector(sel)) return true;
  return false;
}

// Are we on a page where an order can be placed and that the guard must cover? Uses
// place-order INTENT (a control OR the label text), so it fires even when Amazon's
// button isn't in our clickable selector set — exactly the case that broke the click
// interceptor. Exported for tests.
export function isPlaceOrderPage(root = document) {
  if (!isCheckoutLikeUrl()) return false;
  if (isConfirmationPage(root)) return false;
  return hasPlaceOrderIntent(root);
}

function aParagoOverlayShown() {
  return !!(document.getElementById('parago-guardian-overlay') ||
            document.getElementById('parago-placement-overlay'));
}

function loadCartSnapshot() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [CART_SNAPSHOT_KEY]: null }, (d) => resolve(d[CART_SNAPSHOT_KEY] || null));
    } catch (e) { resolve(null); }
  });
}
// Cart items/total don't parse on the SPC place-order page (different DOM), so the
// guardian email would otherwise be empty. Stash the cart while on the cart page and
// reuse it at block time so the request shows what is actually being bought.
function stashCart(root = document) {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const parsed = parseCart(root);
    if (parsed.items && parsed.items.length) {
      chrome.storage.local.set({ [CART_SNAPSHOT_KEY]: { total: parsed.total, items: parsed.items, at: Date.now() } });
    }
  } catch (e) { /* no-op */ }
}
async function bestKnownPurchase(root = document) {
  const finalTotal = parseFinalOrderTotal(root);
  const parsed = parseCart(root);
  let total = finalTotal != null ? finalTotal : parsed.total;
  let items = (parsed.items && parsed.items.length) ? parsed.items : [];
  if (!items.length || total == null) {
    const snap = await loadCartSnapshot();
    if (snap && (Date.now() - (snap.at || 0) < SNAPSHOT_MAX_AGE_MS)) {
      if (!items.length) items = snap.items || [];
      if (total == null && snap.total != null) total = snap.total;
    }
  }
  return { total, items };
}

let proactiveDone = false;
let proactivePending = false;
let proactiveObs = null;

function stopProactiveGuard() {
  if (proactiveObs) { try { proactiveObs.disconnect(); } catch (e) { /* no-op */ } proactiveObs = null; }
}

// Decide and, if needed, raise the proactive block. Async because it reads the cart
// snapshot and the hold decision can depend on it. Idempotent via the two flags so a
// burst of DOM mutations can't engage twice or submit duplicate approval requests.
async function engageProactive(settings, root = document) {
  if (proactiveDone || proactivePending) return proactiveDone;
  if (aParagoOverlayShown()) return false; // a placement/guardian overlay already owns the screen
  proactivePending = true;
  try {
    const { total, items } = await bestKnownPurchase(root);
    if (!shouldRequireApproval(settings, total)) return false; // known and under the limit: let it through
    proactiveDone = true;
    engage(settings, { total, items });
    return true;
  } finally {
    proactivePending = false;
  }
}

function startProactiveGuard(settings) {
  const check = () => {
    if (proactiveDone) { stopProactiveGuard(); return; }
    if (aParagoOverlayShown()) return;       // an approved-order placement (or our overlay) owns the page
    if (!isPlaceOrderPage(document)) return;
    engageProactive(settings, document).then((done) => { if (done) stopProactiveGuard(); });
  };
  check();
  // Re-check as the SPA renders / route-transitions: the place-order page is reached
  // via pushState and the button can render late. No fixed timeout — a slow checkout
  // must stay guarded. Cheap: a URL regex + one querySelector per mutation burst.
  proactiveObs = new MutationObserver(check);
  proactiveObs.observe(document.documentElement, { childList: true, subtree: true });
  if (typeof window !== 'undefined') window.addEventListener('popstate', check);
}

export async function run() {
  const settings = await getSettings();
  setLang(settings.lang);
  relay = buildRelay(settings);

  if (isCartUrl()) stashCart(document); // capture the cart for the guardian email before checkout

  // Arm the click interceptor BEFORE completion so a throw inside completion can't
  // skip arming. (guardianMode 'off' arms nothing but still finishes prior orders.)
  if (settings.guardianMode !== 'off') armPlaceOrderIntercept(settings);

  // Finish any approved order from a previous visit (may raise the placement overlay).
  // Wrapped: a throw here must not tear down the guards.
  try {
    await runPlacementCompletion({ relay });
  } catch (e) {
    console.error('[parago] runPlacementCompletion failed:', e);
  }

  // Start the proactive guard AFTER completion so it observes any placement overlay an
  // approved-order completion raised, and never races or duplicates it.
  if (settings.guardianMode !== 'off') startProactiveGuard(settings);
}
