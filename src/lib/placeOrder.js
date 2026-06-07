// src/lib/placeOrder.js
// All DOM coupling to Amazon's checkout lives here. Selectors are defensive and
// expected to need updates when Amazon changes pages. Everything fails closed:
// "not found" returns null/false, never a guess.
import { parseCurrency } from './parseCart.js';

const PLACE_ORDER_SELECTORS = [
  '#placeYourOrder input',
  'input[name="placeYourOrder1"]',
  '#submitOrderButtonId input',
  '#bottomSubmitOrderButtonId input',
  '[data-testid="bottom-submit-button"] button',
  '[data-testid="place-order-button"]',
  '#placeYourOrder',
];
const PLACE_ORDER_TEXT_RE = /place\s+(your\s+)?order/i;

export function findPlaceOrderControl(root = document) {
  for (const sel of PLACE_ORDER_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  for (const el of root.querySelectorAll('input[type="submit"], button, a[role="button"], span.a-button-text')) {
    const label = el.value || el.textContent || el.getAttribute('aria-label') || '';
    if (PLACE_ORDER_TEXT_RE.test(label)) return el.closest('button, input, a, [role="button"]') || el;
  }
  return null;
}

export function clickPlaceOrder(control) {
  if (!control) return false;
  control.click();
  return true;
}

export function isPlaceOrderClick(ev, root = document) {
  const control = findPlaceOrderControl(root);
  if (!control) return false;
  const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
  if (path.includes(control)) return true;
  let n = ev.target;
  while (n) { if (n === control) return true; n = n.parentElement; }
  return !!(ev.target && control.contains(ev.target));
}

const CONFIRM_SELECTORS = [
  '#widget-purchaseConfirmationStatus',
  '[data-testid="order-confirmation"]',
  '.a-box.osc-thank-you',
];
const CONFIRM_TEXT_RE = /(order placed|thank you|order confirmed|your order has been placed)/i;

export function detectOrderConfirmation(root = document) {
  for (const sel of CONFIRM_SELECTORS) if (root.querySelector(sel)) return true;
  for (const h of root.querySelectorAll('h1, h2, h4')) {
    if (CONFIRM_TEXT_RE.test(h.textContent || '')) return true;
  }
  return false;
}

const FINAL_TOTAL_SELECTORS = [
  '#subtotals-marketplace-table .grand-total-price',
  '.grand-total-price',
  '[data-testid="order-summary-grand-total"]',
];

export function parseFinalOrderTotal(root = document) {
  for (const sel of FINAL_TOTAL_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) {
      const off = el.querySelector('.a-offscreen');
      const val = parseCurrency(off ? off.textContent : el.textContent);
      if (val != null) return val;
    }
  }
  return null;
}
