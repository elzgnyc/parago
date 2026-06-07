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

const APPROVALS_KEY = 'parago_approvals';
const TOTAL_EPSILON = 0.005;

// Relay is swappable. Built from settings in run() (see buildRelay). Tests may
// override via the exported setter.
export let relay = new MockRelay();
export function _setRelayForTest(r) { relay = r; }

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
  let req = null;
  try {
    const pending = await relay.listPending();
    req = pickPendingRequest(pending, parsed.total);
    if (!req) {
      const id = await relay.submitRequest({ total: parsed.total, items: parsed.items });
      req = await relay.getRequest(id);
    }
  } catch (e) {
    // Fail closed: never let a relay error leave the page usable.
    showOverlay({ items: parsed.items, total: parsed.total, guardianName: settings.guardianName, status: 'error', onCancel });
    return;
  }
  if (!req) {
    showOverlay({ items: parsed.items, total: parsed.total, guardianName: settings.guardianName, status: 'error', onCancel });
    return;
  }
  activeRequestId = req.id;

  const effTotal = parsed.total != null ? parsed.total : req.total;
  const items = parsed.items && parsed.items.length ? parsed.items : (req.items || []);

  showOverlay({ items, total: effTotal, guardianName: settings.guardianName, status: req.status, onCancel });

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

export async function run() {
  const settings = await getSettings();
  setLang(settings.lang);
  relay = buildRelay(settings);

  if (settings.guardianMode === 'off') { teardown(); removeOverlay(); return; }

  let parsed = parseCart(document);
  if (settings.guardianMode === 'over_limit' && parsed.total == null) {
    parsed = await waitForTotal();
  }

  if (!shouldRequireApproval(settings, parsed.total)) { teardown(); removeOverlay(); return; }

  const approvals = await getApprovals();
  if (isApprovedForTotal(approvals, parsed.total)) { teardown(); removeOverlay(); return; }

  await engage(settings, parsed);
}
