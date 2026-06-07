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
        const val = parseCurrency(off ? off.textContent : row.textContent);
        if (val != null) return val;
      }
    }
  }
  return null; // fail closed: unknown total
}

const ITEM_SELECTORS = '.sc-list-item[data-asin], [data-asin].sc-list-item, [data-name][data-asin]';
const TITLE_SELECTORS = '.sc-product-title, .a-truncate-full, a.sc-product-link, .sc-product-link';

// The active cart (what's actually being purchased). Amazon's "Saved for later"
// list uses the SAME .sc-list-item[data-asin] markup, so without scoping it would
// count as being in the cart. Prefer parsing inside one of these; fall back to the
// whole doc but still drop anything inside a non-purchase section.
const ACTIVE_CART_CONTAINERS = ['#sc-active-cart', '#activeCartViewForm', '#sc-active-cart-content'];
const NON_PURCHASE_CONTAINERS = '#sc-saved-cart, #saved-for-later';

export function parseCartItems(root = document) {
  let scope = null;
  for (const sel of ACTIVE_CART_CONTAINERS) {
    const el = root.querySelector(sel);
    if (el) { scope = el; break; }
  }
  const searchRoot = scope || root;

  const items = [];
  const seen = new Set();
  for (const node of searchRoot.querySelectorAll(ITEM_SELECTORS)) {
    // Drop "Saved for later" (and similar) even when scoped: defensive if a future
    // layout nests them, and the only guard on the whole-doc fallback path.
    if (node.closest(NON_PURCHASE_CONTAINERS)) continue;
    const asin = node.getAttribute('data-asin') || null;
    if (asin && seen.has(asin)) continue;
    if (asin) seen.add(asin);
    const titleEl = node.querySelector(TITLE_SELECTORS);
    let title = titleEl ? titleEl.textContent : (node.getAttribute('data-name') || '');
    title = (title || '').replace(/\s+/g, ' ').trim();
    if (title) items.push({ title, asin });
  }
  return items;
}

export function parseCart(root = document) {
  return { total: parseCartTotal(root), items: parseCartItems(root) };
}
