// Developer mode: a floating panel injected on Amazon pages when settings.devMode
// is on. It lets you SEE the guardian-approval experience (the blocking overlays
// and a real test email) using a fixed fake cart, without buying anything. The
// overlay demos are pure UI; the test email creates a normal single-use approval
// row that is wired to NO real Amazon order, so approving it purchases nothing.
import { getSettings, onSettingsChanged } from '../settings/storage.js';
import { setLang } from '../i18n/i18n.js';
import { showOverlay, setOverlayStatus, removeOverlay } from './overlay.js';
import {
  showProcessing, showFinishing, showConfirmed, showCouldNotComplete,
  showManualFallback, showOrderChanged, removePlacementOverlay,
} from './placementOverlay.js';
import { SupabaseRelay } from '../relay/supabaseRelay.js';
import { shouldUseSupabase, resolveFunctionsBaseUrl } from '../relay/selectRelay.js';
import { CONFIG } from '../config.js';
import { SAMPLE_CART } from './devSample.js';
import { parseCart } from '../lib/parseCart.js';

const CART_SNAPSHOT_KEY = 'parago_cart_snapshot';
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // older carts aren't trusted for the demo

function loadCartSnapshot() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [CART_SNAPSHOT_KEY]: null }, (d) => resolve(d[CART_SNAPSHOT_KEY] || null));
    } catch (e) { resolve(null); }
  });
}

// What the demo + test email show. Prefer the shopper's ACTUAL cart parsed live
// from the page, so dev mode reflects the items literally in their Amazon cart.
// If this page has no parseable cart (a product or checkout page, whose DOM the
// cart selectors don't match), fall back to the cart snapshot the checkout script
// stashes while on the cart page. Only when there is no real cart data anywhere do
// we use the fixed SAMPLE_CART. Cart-page items carry no rating/reviewCount; the
// email renders fine without stars.
async function currentCart() {
  const parsed = parseCart(document);
  if (parsed.items && parsed.items.length) return parsed;
  const snap = await loadCartSnapshot();
  if (snap && Array.isArray(snap.items) && snap.items.length && (Date.now() - (snap.at || 0) < SNAPSHOT_MAX_AGE_MS)) {
    return { total: snap.total != null ? snap.total : null, items: snap.items };
  }
  return SAMPLE_CART;
}

const PANEL_ID = 'parago-dev-panel';
const BAR_ID = 'parago-dev-bar';
const TOAST_ID = 'parago-dev-toast';

let currentSettings = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function toast(msg) {
  let t = document.getElementById(TOAST_ID);
  if (!t) { t = el('div'); t.id = TOAST_ID; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 4000);
}

// A control strip pinned above the blocking overlay (the overlay covers the
// launcher panel, so demo steps are driven from here instead). Appended last so
// it stacks above the overlay at the same z-index.
function showDemoBar(buttons) {
  removeDemoBar();
  const bar = el('div'); bar.id = BAR_ID;
  bar.appendChild(el('span', 'parago-dev-bar-label', 'Parago demo'));
  for (const b of buttons) {
    const btn = el('button', 'parago-dev-bar-btn', b.label);
    btn.type = 'button';
    btn.addEventListener('click', b.onClick);
    bar.appendChild(btn);
  }
  const close = el('button', 'parago-dev-bar-btn close', 'Close');
  close.type = 'button';
  close.addEventListener('click', endDemo);
  bar.appendChild(close);
  document.body.appendChild(bar);
}

function removeDemoBar() {
  const b = document.getElementById(BAR_ID);
  if (b) b.remove();
}

function endDemo() {
  removeOverlay();
  removePlacementOverlay();
  removeDemoBar();
}

// Demo 1: the approval-pending overlay, with controls to flip it through the
// real approved / rejected states a guardian decision would trigger.
async function demoApproval() {
  setLang(currentSettings.lang);
  const cart = await currentCart();
  showOverlay({
    items: cart.items,
    total: cart.total,
    guardianName: currentSettings.guardianName || 'Mom',
    status: 'pending',
  });
  showDemoBar([
    { label: 'Approve', onClick: () => setOverlayStatus('approved') },
    { label: 'Reject', onClick: () => setOverlayStatus('rejected') },
    { label: 'Pending', onClick: () => setOverlayStatus('pending') },
  ]);
}

// Demo 2: the place-order hold screens a shopper sees after we intercept the
// real "Place your order" click. Each button paints one real overlay state.
function demoPlaceOrder() {
  setLang(currentSettings.lang);
  showProcessing();
  showDemoBar([
    { label: 'Processing', onClick: () => showProcessing() },
    { label: 'Finishing', onClick: () => showFinishing() },
    { label: 'Confirmed', onClick: () => showConfirmed() },
    { label: 'Manual', onClick: () => showManualFallback(() => toast('(demo) would place the approved order')) },
    { label: 'Changed', onClick: () => showOrderChanged(() => toast('(demo) would re-open the cart')) },
    { label: 'Failed', onClick: () => showCouldNotComplete() },
  ]);
}

// Demo 3: a REAL approval email through the configured backend, using the fake
// cart. Needs a guardian email + a configured functions base URL; otherwise we
// say so rather than silently doing nothing.
async function sendTestEmail() {
  if (!shouldUseSupabase(currentSettings, CONFIG)) {
    toast('Set an approver email in Settings (and configure the backend) to send a real test email.');
    return;
  }
  const relay = new SupabaseRelay({
    baseUrl: resolveFunctionsBaseUrl(currentSettings, CONFIG),
    guardianEmail: currentSettings.guardianEmail,
    guardianName: currentSettings.guardianName,
  });
  toast('Sending test email to ' + currentSettings.guardianEmail + '...');
  try {
    const cart = await currentCart();
    await relay.submitRequest({ total: cart.total, items: cart.items });
    toast('Sent to ' + currentSettings.guardianEmail + '. Open it; the Approve/Reject link is live (buys nothing).');
  } catch (e) {
    toast('Could not send: ' + ((e && e.message) || e));
  }
}

function buildPanel() {
  const panel = el('div'); panel.id = PANEL_ID;
  const head = el('div', 'parago-dev-head');
  head.appendChild(el('span', 'parago-dev-dot'));
  head.appendChild(el('strong', null, 'Parago Dev'));
  const hide = el('button', 'parago-dev-x', '×');
  hide.type = 'button';
  hide.title = 'Hide (turn off Developer mode in Settings to remove)';
  hide.addEventListener('click', () => panel.remove());
  head.appendChild(hide);
  panel.appendChild(head);

  panel.appendChild(el('p', 'parago-dev-note', 'Test the approval flow. Nothing is ever bought.'));

  const mk = (label, onClick) => {
    const b = el('button', 'parago-dev-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  panel.appendChild(mk('Demo approval hold', demoApproval));
  // Label avoids the literal phrase "place order" so the real checkout intercept's
  // text-based control detector never mistakes this panel button for Amazon's.
  panel.appendChild(mk('Demo place-order screens', demoPlaceOrder));
  panel.appendChild(mk('Send real test email', sendTestEmail));
  return panel;
}

function injectPanel() {
  if (document.getElementById(PANEL_ID)) return;
  if (!document.body) return;
  document.body.appendChild(buildPanel());
}

function removePanel() {
  endDemo();
  const p = document.getElementById(PANEL_ID);
  if (p) p.remove();
  const t = document.getElementById(TOAST_ID);
  if (t) t.remove();
}

function apply(settings) {
  currentSettings = settings;
  if (settings.devMode) injectPanel();
  else removePanel();
}

export async function initDevPanel() {
  apply(await getSettings());
  // React to the Developer-mode toggle without a page reload.
  onSettingsChanged(async () => { apply(await getSettings()); });
}

initDevPanel().catch((err) => console.error('[parago] dev panel init failed:', err));
