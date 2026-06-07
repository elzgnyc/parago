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

export function parseCartItems(root = document) {
  const items = [];
  const seen = new Set();
  for (const node of root.querySelectorAll(ITEM_SELECTORS)) {
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
