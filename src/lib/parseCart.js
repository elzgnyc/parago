// Defensive parsing of an Amazon cart / checkout page: order total + line items.
// Prefer Amazon's accessible price node (.a-offscreen, e.g. "$1,234.56") and known total
// containers; fall back to a label-anchored search. Return null total when unsure (fail closed).

export function parseCurrency(text) {
  if (!text) return null;
  const m = String(text).match(/(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const TOTAL_CONTAINERS = [
  '#sc-subtotal-amount-activecart',
  '#sc-subtotal-amount-buybox',
  '.grand-total-price',
];

const TOTAL_LABEL_RE = /^\s*(order total|grand total|subtotal)\b/i;

// Amazon's total labels read "Subtotal (3 items): $59.97". Strip the "(N items)"
// count so parseCurrency (which grabs the first digit-run) returns the price, not the
// item count, when reading a whole label row that has no .a-offscreen price node.
function stripItemCount(text) {
  return String(text || '').replace(/\(\s*\d[\d,]*\s*items?\s*\)/ig, ' ');
}

export function parseCartTotal(root = document) {
  // 1) Known total containers; read the accessible price inside if present.
  for (const sel of TOTAL_CONTAINERS) {
    const el = root.querySelector(sel);
    if (el) {
      const off = el.querySelector('.a-offscreen');
      const val = parseCurrency(off ? off.textContent : el.textContent);
      if (val != null) return val;
    }
  }
  // 2) Label-anchored fallback: an element whose text starts with a total label;
  //    read the price from its row.
  for (const el of root.querySelectorAll('span, div, td, th, h2, h4')) {
    if (el.closest(NON_PURCHASE_CONTAINERS)) continue; // ignore "Saved for later" subtotals
    if (TOTAL_LABEL_RE.test(el.textContent || '')) {
      const row = el.closest('tr, li, div') || el.parentElement;
      if (row) {
        const off = row.querySelector('.a-offscreen');
        const val = parseCurrency(off ? off.textContent : stripItemCount(row.textContent));
        if (val != null) return val;
      }
    }
  }
  return null; // fail closed: unknown total
}

const ITEM_SELECTORS = '.sc-list-item[data-asin], [data-asin].sc-list-item, [data-name][data-asin]';
const TITLE_SELECTORS = '.sc-product-title, .a-truncate-full, a.sc-product-link, .sc-product-link';
const ITEM_PRICE_SELECTORS = '.sc-product-price, .a-price .a-offscreen';
const ITEM_IMAGE_SELECTORS = 'img.sc-product-image, img[data-old-hires], img';

// Deterministic per-item quantity (feeds snapshot matching; flaky qty causes
// spurious re-approvals). Read explicit markup first, displayed text last; any
// non-positive-integer result falls back to 1.
function parseItemQty(node) {
  const raw =
    node.getAttribute('data-quantity') ||
    node.querySelector('input.sc-quantity-textfield, select[name="quantity"], [name="quantity"]')?.value ||
    node.querySelector('.a-dropdown-prompt')?.textContent ||
    '';
  const m = String(raw).match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// The active cart (what's actually being purchased). Amazon's "Saved for later"
// list uses the SAME .sc-list-item[data-asin] markup, so without scoping it would
// count as being in the cart. Prefer parsing inside one of these; fall back to the
// whole doc but still drop anything inside a non-purchase section.
const ACTIVE_CART_CONTAINERS = ['#sc-active-cart', '#activeCartViewForm', '#sc-active-cart-content'];
const NON_PURCHASE_CONTAINERS = '#sc-saved-cart, #saved-for-later';

// Amazon's per-line selection checkbox: aria-label "Select <product> for checkout".
// A DEselected line stays in the cart and out of the subtotal but is NOT being
// purchased, so only checked lines should reach the guardian. Identify the control
// by its aria-label so other checkboxes (e.g. gift options) never trigger exclusion.
// (aria-label is Amazon-locale text; this matches the amazon.com English wording.)
const SELECTION_CHECKBOX = 'input[type="checkbox"][aria-label*="for checkout" i]';

// The active-cart subtree to parse within (falls back to the whole root).
function activeScope(root) {
  for (const sel of ACTIVE_CART_CONTAINERS) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return root;
}

export function parseCartItems(root = document) {
  const searchRoot = activeScope(root);

  const items = [];
  const seen = new Set();
  for (const node of searchRoot.querySelectorAll(ITEM_SELECTORS)) {
    // Drop "Saved for later" (and similar) even when scoped: defensive if a future
    // layout nests them, and the only guard on the whole-doc fallback path.
    if (node.closest(NON_PURCHASE_CONTAINERS)) continue;
    // Send only what's actually checked out: skip a line ONLY when its selection
    // checkbox is positively unchecked. No checkbox / unknown markup → keep it, so we
    // never hide a real purchase from the guardian.
    const sel = node.querySelector(SELECTION_CHECKBOX);
    if (sel && !sel.checked) continue;
    const asin = node.getAttribute('data-asin') || null;
    if (asin && seen.has(asin)) continue;
    if (asin) seen.add(asin);
    const titleEl = node.querySelector(TITLE_SELECTORS);
    let title = titleEl ? titleEl.textContent : (node.getAttribute('data-name') || '');
    title = (title || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    // Per-item unit price (NOT the cart grand total); null when absent.
    const priceEl = node.querySelector(ITEM_PRICE_SELECTORS);
    const price = priceEl ? parseCurrency(priceEl.textContent) : null;
    const qty = parseItemQty(node);
    const imgEl = node.querySelector(ITEM_IMAGE_SELECTORS);
    const image = (imgEl && imgEl.getAttribute('src')) || node.getAttribute('data-image') || null;
    const url = asin ? ('https://www.amazon.com/dp/' + asin) : null;
    items.push({ asin, title, price, qty, image, url });
  }
  return items;
}

// Is any active-cart line explicitly DEselected for checkout? (Its selection
// checkbox is present and unchecked.)
function hasDeselectedLine(root) {
  const scope = activeScope(root);
  for (const node of scope.querySelectorAll(ITEM_SELECTORS)) {
    if (node.closest(NON_PURCHASE_CONTAINERS)) continue;
    const sel = node.querySelector(SELECTION_CHECKBOX);
    if (sel && !sel.checked) return true;
  }
  return false;
}

// Sum of unit price × qty over items; null if ANY item lacks a finite price, so the
// caller can keep the page subtotal rather than send a partial (wrong) number.
function sumItemPrices(items) {
  let sum = 0;
  for (const it of items) {
    if (typeof it.price !== 'number' || !Number.isFinite(it.price)) return null;
    const qty = Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 1;
    sum += it.price * qty;
  }
  return Math.round(sum * 100) / 100; // guard against float drift (7.26, not 7.2600001)
}

export function parseCart(root = document) {
  const items = parseCartItems(root);
  let total = parseCartTotal(root);
  // Amazon's active-cart subtotal reflects the WHOLE cart, not the checkbox
  // selection. When lines are deselected, send the SELECTED subtotal so the total
  // matches the items the guardian sees — but only when every selected item has a
  // parseable price (else keep the page subtotal, the best available number).
  if (hasDeselectedLine(root)) {
    const selectedSum = sumItemPrices(items);
    if (selectedSum != null) total = selectedSum;
  }
  return { total, items };
}
