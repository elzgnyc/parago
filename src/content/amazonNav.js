// src/content/amazonNav.js
// Page classification (pure, tested) + the one place we trigger a real navigation
// (thin, untested adapter, isolated because it touches window.location).
export function pageKind(loc = (typeof location !== 'undefined' ? location : { pathname: '' })) {
  const p = loc.pathname || '';
  if (/\/gp\/buy\//.test(p) || /\/checkout/.test(p)) return 'checkout';
  if (/\/gp\/cart\//.test(p) || /\/cart/.test(p)) return 'cart';
  return 'other';
}

export const defaultNav = {
  toCheckout() { location.assign('https://www.amazon.com/gp/cart/view.html'); },
};
