import { getSettings } from '../settings/storage.js';
import { setLang } from '../i18n/i18n.js';
import { parseCart } from '../lib/parseCart.js';
import { shouldRequireApproval } from '../lib/guardianTrigger.js';
import { isApprovedForTotal, recordApproval } from '../lib/approval.js';
import { MockRelay } from '../relay/mockRelay.js';
import { SupabaseRelay } from '../relay/supabaseRelay.js';
import { CONFIG } from '../config.js';
import { shouldUseSupabase, resolveFunctionsBaseUrl } from '../relay/selectRelay.js';
import { RELAY_STATUS } from '../relay/relayClient.js';
import { showOverlay, setOverlayStatus, removeOverlay } from './overlay.js';
import { parseFinalOrderTotal, isPlaceOrderClick, findPlaceOrderControl } from '../lib/placeOrder.js';
import { consumeSuppress } from './interceptGuard.js';

const APPROVALS_KEY = 'parago_approvals';
const OUTSTANDING_KEY = 'parago_outstanding';
const TOTAL_EPSILON = 0.005;

// Where the shopper is sent after a purchase is held for approval: back to amazon.com
// to keep shopping. The order is NOT placed and is NOT queued to place automatically —
// guardian approval only UNLOCKS the gate so the shopper's own next click goes through.
const SHOP_URL = 'https://www.amazon.com/';
let navigate = (url) => { try { window.location.assign(url); } catch (e) { /* jsdom: no-op */ } };
export function _setNavigateForTest(fn) { navigate = fn; }

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
      baseUrl: resolveFunctionsBaseUrl(settings, CONFIG),
      guardianEmail: settings.guardianEmail,
      guardianName: settings.guardianName,
      deliveryMethod: settings.deliveryMethod || 'email',
      telegramLinkCode: settings.telegramLinkCode || null,
      approveUrl: settings.approveUrl || null,
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

// Outstanding requests awaiting a guardian decision: [{ id, total, createdAt }]. Stored
// across navigation so that when the shopper returns, reconcileApprovals can look each
// one up and, if approved, unlock that total. This is the notify-only alternative to
// auto-placing: nothing is ever bought without a fresh human click.
function getOutstanding() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [OUTSTANDING_KEY]: [] }, (d) => resolve(d[OUTSTANDING_KEY] || []));
  });
}
function saveOutstanding(list) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [OUTSTANDING_KEY]: list }, () => resolve());
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

// Test-only: reset module state + overlay + listeners between tests.
export function _resetForTest() {
  teardown();
  removeOverlay();
  armedSettings = null;
  armedApprovals = [];
  pressHandled = false;
  letThroughPress = false;
  clearTimeout(letThroughTimer);
  armedSnapshotTotal = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', onPlaceOrderPress, true);
    document.removeEventListener('click', onPlaceOrderPress, true);
  }
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

// The blocking guardian overlay. No longer raised on the checkout pages (a held order
// now redirects the shopper to amazon.com instead); kept for the Developer-mode demo and
// as a fail-closed, tested building block.
export async function engage(settings, parsed) {
  const onCancel = () => { try { history.back(); } catch (e) { /* no-op */ } };

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

// Decide, at place-order time, whether this purchase needs a hold. Uses the FINAL
// order total on the checkout page (includes shipping + tax) and falls back to the
// cart parse. Fail-closed via shouldRequireApproval for unknown totals in over_limit.
export function evaluatePlaceOrder(settings, root = document) {
  const finalTotal = parseFinalOrderTotal(root);
  const parsed = parseCart(root);
  const total = finalTotal != null ? finalTotal : parsed.total;
  return { hold: shouldRequireApproval(settings, total), total, items: parsed.items };
}

function pathname() {
  return (typeof location !== 'undefined' && location.pathname) || '';
}
function isCartUrl() {
  const p = pathname();
  return /\/gp\/cart\//.test(p) || /\/cart\b/.test(p) || /\/checkout\/entry\/cart/.test(p);
}

const CART_SNAPSHOT_KEY = 'parago_cart_snapshot';
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // older carts aren't trusted for the email

function loadCartSnapshot() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [CART_SNAPSHOT_KEY]: null }, (d) => resolve(d[CART_SNAPSHOT_KEY] || null));
    } catch (e) { resolve(null); }
  });
}
// Cart items/total don't parse on the SPC place-order page (different DOM), so the
// guardian email would otherwise be empty. Stash the cart while on the cart page and
// reuse it at request time so the email shows what is actually being bought.
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

// ── Place-order interception ────────────────────────────────────────────────────
// The order is held only when the shopper actually presses "Place your order" — there
// is no proactive page-load block. We bind on BOTH pointerdown and click (capture)
// because Amazon's SPC checkout submits the order on pointerdown and navigates before a
// click ever fires; catching the press at pointerdown is what lets us preventDefault in
// time. On a held press we request approval and send the shopper back to amazon.com.
let armedSettings = null;
let armedApprovals = [];
let pressHandled = false;
// A real press fires pointerdown THEN click on the same control. When we let an
// approved press through we consume the single-use approval on the FIRST event; this
// one-shot flag lets the paired second event pass too, so the trailing click is not
// re-evaluated (approval now gone) and wrongly blocked + resubmitted. Cleared by the
// paired event, with a timer backstop if the press is cancelled and no click comes.
let letThroughPress = false;
let letThroughTimer = null;
// Best-known cart total, preloaded from the snapshot at arm time, so the SYNC approval
// gate has a stable total to match even on a page where the live total does not parse
// (else a null total can never match an approval and the press re-holds forever).
let armedSnapshotTotal = null;

// One approval authorizes exactly one placement. Remove the first matching approval from
// the in-memory armed list synchronously (so a repeat press in this same visit needs fresh
// approval) and from storage (fire-and-forget: the let-through must proceed without an
// await here). Matching tolerates the same epsilon as isApprovedForTotal.
function consumeApproval(total) {
  const matches = (a) => Math.abs(a.total - total) < TOTAL_EPSILON;
  const i = armedApprovals.findIndex(matches);
  if (i < 0) return;
  armedApprovals = armedApprovals.slice(0, i).concat(armedApprovals.slice(i + 1));
  getApprovals().then((list) => {
    const j = list.findIndex(matches);
    if (j >= 0) { list.splice(j, 1); return saveApprovals(list); }
  }).catch(() => { /* fire-and-forget */ });
}

async function onPlaceOrderPress(ev) {
  if (!armedSettings) return;
  if (!isPlaceOrderClick(ev, document)) return;
  if (consumeSuppress()) return; // a programmatic place click (if any) passes through
  // Once we've taken a press this visit, block every later place-order press too, so a
  // second tap during the request/redirect window can't reach Amazon unreviewed.
  if (pressHandled) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  // Paired event of a press we already approved-through: let it pass without re-deciding.
  if (letThroughPress) { letThroughPress = false; clearTimeout(letThroughTimer); return; }

  const finalTotal = parseFinalOrderTotal(document);
  const parsed = parseCart(document);
  const total = finalTotal != null ? finalTotal : (parsed.total != null ? parsed.total : armedSnapshotTotal);

  if (!shouldRequireApproval(armedSettings, total)) return; // under limit / off → let Amazon place

  // Guardian already approved this exact total (recorded by reconcileApprovals on a
  // prior visit): the gate is unlocked for ONE placement, so consume it and let the
  // shopper's own click through. Single-use is the point — without consuming, an approved
  // total would permanently unlock every future cart of that price (silent spend).
  if (isApprovedForTotal(armedApprovals, total)) {
    consumeApproval(total);
    // A pointerdown is followed by a paired click on the same control; arm a one-shot
    // so that click passes too, instead of being re-evaluated (approval now consumed)
    // and wrongly blocked. A lone click IS the whole gesture, so nothing is armed and
    // single-use still holds for the next separate press. Timer backstop for a
    // cancelled press whose click never arrives.
    if (ev.type === 'pointerdown') {
      letThroughPress = true;
      clearTimeout(letThroughTimer);
      letThroughTimer = setTimeout(() => { letThroughPress = false; }, 1500);
    }
    return;
  }

  // Approval required and not yet granted. Block this submit (synchronously, before any
  // await, so Amazon's own handler can't place it), request approval, then send the
  // shopper back to shopping. The order is NOT placed and NOT auto-queued.
  pressHandled = true;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  try {
    const { items } = await bestKnownPurchase(document);
    const outstanding = await getOutstanding();
    if (!outstanding.some((o) => totalsMatch(o.total, total))) {
      const enriched = await enrichItems(items);
      const id = await relay.submitRequest({ total, items: enriched });
      await saveOutstanding([...outstanding, { id, total, createdAt: Date.now() }]);
    }
  } catch (e) {
    // Fail closed: we preventDefault'd, so the order was NOT placed. The request may not
    // have been sent (offline); the shopper can retry. Nothing buys without approval.
    console.error('[parago] approval request failed:', e);
  }
  navigate(SHOP_URL);
}

export function armPlaceOrderIntercept(settings, approvals = []) {
  armedSettings = settings;
  armedApprovals = Array.isArray(approvals) ? approvals : [];
  pressHandled = false;
  letThroughPress = false;
  clearTimeout(letThroughTimer);
  // Capture phase so we run before Amazon's own submit handler.
  document.addEventListener('pointerdown', onPlaceOrderPress, true);
  document.addEventListener('click', onPlaceOrderPress, true);
}

// Fail closed: are we on a final place-order page that needs approval but whose
// place-order control we cannot recognize? If the button is unrecognized, an
// un-intercepted press would place the order with no approval.
export function needsHardBlockFallback(settings, root = document) {
  if (parseFinalOrderTotal(root) == null) return false;   // not the final order page
  const { hold } = evaluatePlaceOrder(settings, root);
  if (!hold) return false;                                 // no approval needed
  return findPlaceOrderControl(root) == null;              // recognized -> interceptor handles it
}

// On return to a checkout/cart page, learn the outcome of any outstanding request and,
// for approved ones, record the approval locally so the shopper's next "Place your order"
// click goes through. Never places an order itself.
export async function reconcileApprovals() {
  const outstanding = await getOutstanding();
  if (!outstanding.length) return;
  let approvals = await getApprovals();
  const stillPending = [];
  let approvalsChanged = false;
  for (const o of outstanding) {
    let rec;
    try {
      rec = await relay.getRequest(o.id);
    } catch (e) {
      stillPending.push(o); // transient failure (offline/5xx): keep for next visit
      continue;
    }
    if (!rec) continue; // not_found → drop
    if (rec.status === RELAY_STATUS.APPROVED) {
      // Record the approval, but only for a real total (a null total can never be
      // matched by isApprovedForTotal, so recording it just accumulates junk).
      if (o.total != null && !isApprovedForTotal(approvals, o.total)) {
        approvals = recordApproval(approvals, o.total, Date.now());
        approvalsChanged = true;
      }
      // drop from outstanding: approval is now recorded locally
    } else if (rec.status === RELAY_STATUS.PENDING) {
      stillPending.push(o); // genuinely still waiting → keep watching
    }
    // else (rejected, EXPIRED, or any other terminal/unknown status) → drop. Keeping
    // an expired hold would make onPlaceOrderPress dedupe against it forever and never
    // send a fresh request for that total (permanent silent deadlock). A retry starts
    // a new request.
  }
  if (approvalsChanged) await saveApprovals(approvals);
  await saveOutstanding(stillPending);
}

export async function run() {
  const settings = await getSettings();
  setLang(settings.lang);
  relay = buildRelay(settings);

  if (isCartUrl()) stashCart(document); // capture the cart for the guardian email before checkout

  if (settings.guardianMode !== 'off') {
    // Arm the interceptor FIRST, with the approvals already on disk, so there is never a
    // live-but-unarmed window where a place-order press could slip through unreviewed
    // (reconcileApprovals is a network round-trip). Worst case before reconcile finishes:
    // an already-approved total is briefly re-held (fail-closed), never auto-placed.
    armPlaceOrderIntercept(settings, await getApprovals());
    // Preload the best-known total from the cart snapshot, so the sync approval gate has
    // a stable total to match on a page where the live total does not parse.
    try {
      const snap = await loadCartSnapshot();
      if (snap && snap.total != null && (Date.now() - (snap.at || 0) < SNAPSHOT_MAX_AGE_MS)) {
        armedSnapshotTotal = snap.total;
      }
    } catch (e) { /* no-op: fall back to a null total (fail closed) */ }
    // Then learn the outcome of any prior request and refresh the armed approvals, so an
    // approved total is recognized and the shopper's next click is let straight through.
    try {
      await reconcileApprovals();
    } catch (e) {
      console.error('[parago] reconcileApprovals failed:', e);
    }
    armedApprovals = await getApprovals();
  }
}
