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
import { findPlaceOrderControl } from '../lib/placeOrder.js';
import { SupabaseRelay } from '../relay/supabaseRelay.js';
import { shouldUseSupabase } from '../relay/selectRelay.js';
import { CONFIG } from '../config.js';
import { SAMPLE_CART } from './devSample.js';
import { parseCart } from '../lib/parseCart.js';

// What the demo + test email show. Prefer the shopper's ACTUAL cart parsed live
// from the page, so dev mode reflects the items literally in their Amazon cart.
// Fall back to the fixed SAMPLE_CART only when there's nothing real to read — an
// empty cart, or a checkout page where the cart selectors don't match. Cart-page
// items carry no rating/reviewCount; the email renders fine without stars.
function currentCart() {
  const parsed = parseCart(document);
  return parsed.items && parsed.items.length ? parsed : SAMPLE_CART;
}

const PANEL_ID = 'parago-dev-panel';
const BAR_ID = 'parago-dev-bar';
const TOAST_ID = 'parago-dev-toast';
const FAKE_CART_ID = 'parago-fake-cart';
const FAKE_CHECKOUT_ID = 'parago-fake-checkout';

// Amazon's real "Proceed to checkout" control, used only to anchor the fake
// button next to it when a real cart is present.
const CART_PTC_SELECTORS = [
  '#sc-buy-box-ptc-button input', '#hlb-ptc-btn-native',
  'input[name="proceedToRetailCheckout"]', '#sc-proceed-to-checkout-action',
  '#sc-buy-box-ptc-button',
];

function isCartPage() { return /(\/gp\/cart\/|\/cart\b)/i.test(location.pathname); }
function isCheckoutPage() { return /(\/gp\/buy\/|\/checkout\b)/i.test(location.pathname); }

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
function demoApproval() {
  setLang(currentSettings.lang);
  const cart = currentCart();
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
    baseUrl: CONFIG.functionsBaseUrl,
    guardianEmail: currentSettings.guardianEmail,
    guardianName: currentSettings.guardianName,
  });
  toast('Sending test email to ' + currentSettings.guardianEmail + '...');
  try {
    const cart = currentCart();
    await relay.submitRequest({ total: cart.total, items: cart.items });
    toast('Sent to ' + currentSettings.guardianEmail + '. Open it; the Approve/Reject link is live (buys nothing).');
  } catch (e) {
    toast('Could not send: ' + ((e && e.message) || e));
  }
}

// The outer button "block" Amazon wraps its control in, so the fake pill can be
// inserted directly under it at the same full width.
function buttonBlock(anchor) {
  return anchor.closest(
    '#sc-buy-box-ptc-button, #hlb-ptc-btn-native, #placeYourOrder, ' +
    '#submitOrderButtonId, #bottomSubmitOrderButtonId, .a-button-stack, span.a-button, .a-button'
  ) || anchor;
}

// A fake, full-width green pill matching the size of Amazon's yellow buy button,
// inserted directly UNDER the real one. Green (not yellow) so it is never mistaken
// for the real control. Falls back to a fixed banner when no real button exists
// (e.g. an empty cart), so it always shows.
function fakeButton(id, label, onClick, anchorEl) {
  const old = document.getElementById(id);
  if (old) old.remove();
  const wrap = el('div', 'parago-fake-wrap'); wrap.id = id;
  const btn = el('button', 'parago-fake-btn', label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);

  const block = anchorEl ? buttonBlock(anchorEl) : null;
  if (block && block.parentElement) {
    wrap.classList.add('inline');
    block.parentElement.insertBefore(wrap, block.nextSibling); // directly under
  } else {
    wrap.classList.add('fixed');
    document.body.appendChild(wrap);
  }
  return wrap;
}

function firstMatch(selectors) {
  for (const sel of selectors) {
    const e = document.querySelector(sel);
    if (e) return e;
  }
  return null;
}

// Cart page: a "Proceed to checkout" that opens the approval-hold overlay (a
// guardian-required cart blocks here). Checkout page: a "Place your order" that
// runs the place-order hold screens. Both use the fake cart; nothing is bought.
function injectContextButtons() {
  if (isCartPage()) {
    fakeButton(FAKE_CART_ID, 'Proceed to checkout', demoApproval, firstMatch(CART_PTC_SELECTORS));
  }
  if (isCheckoutPage()) {
    fakeButton(FAKE_CHECKOUT_ID, 'Place your order', demoPlaceOrder, findPlaceOrderControl(document));
  }
}

function removeContextButtons() {
  for (const id of [FAKE_CART_ID, FAKE_CHECKOUT_ID]) {
    const e = document.getElementById(id);
    if (e) e.remove();
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
  removeContextButtons();
  const p = document.getElementById(PANEL_ID);
  if (p) p.remove();
  const t = document.getElementById(TOAST_ID);
  if (t) t.remove();
}

function apply(settings) {
  currentSettings = settings;
  if (settings.devMode) { injectPanel(); injectContextButtons(); }
  else removePanel();
}

export async function initDevPanel() {
  apply(await getSettings());
  // React to the Developer-mode toggle without a page reload.
  onSettingsChanged(async () => { apply(await getSettings()); });
}

initDevPanel().catch((err) => console.error('[parago] dev panel init failed:', err));
