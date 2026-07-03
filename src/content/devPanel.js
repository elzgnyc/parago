// Developer mode: a floating panel injected on Amazon pages when settings.devMode
// is on. It lets you SEE the place-order hold screens (pure UI, nothing is bought).
// The "send a real test approval" action lives in the extension Settings page.
import { getSettings, onSettingsChanged } from '../settings/storage.js';
import { setLang } from '../i18n/i18n.js';
import { removeOverlay } from './overlay.js';
import {
  showProcessing, showFinishing, showConfirmed, showCouldNotComplete,
  showManualFallback, showOrderChanged, removePlacementOverlay,
} from './placementOverlay.js';

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
  // Label avoids the literal phrase "place order" so the real checkout intercept's
  // text-based control detector never mistakes this panel button for Amazon's.
  panel.appendChild(mk('Demo place-order screens', demoPlaceOrder));
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
