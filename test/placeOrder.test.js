// test/placeOrder.test.js
import { describe, it, expect, afterEach } from 'vitest';
import {
  findPlaceOrderControl, isPlaceOrderClick, detectOrderConfirmation, parseFinalOrderTotal,
} from '../src/lib/placeOrder.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('placeOrder', () => {
  it('finds the place-order control by known selector', () => {
    document.body.innerHTML = `<span id="placeYourOrder"><input type="submit" value="Place your order"></span>`;
    expect(findPlaceOrderControl(document)).not.toBeNull();
  });

  it('finds the place-order control by text fallback', () => {
    document.body.innerHTML = `<button class="x">  Place Your Order  </button>`;
    const el = findPlaceOrderControl(document);
    expect(el && el.tagName).toBe('BUTTON');
  });

  it('returns null when there is no place-order control', () => {
    document.body.innerHTML = `<button>Continue</button>`;
    expect(findPlaceOrderControl(document)).toBeNull();
  });

  it('isPlaceOrderClick is true for a click on the control', () => {
    document.body.innerHTML = `<input id="placeYourOrder" type="submit" value="Place your order">`;
    const control = document.getElementById('placeYourOrder');
    const ev = { target: control, composedPath: () => [control] };
    expect(isPlaceOrderClick(ev, document)).toBe(true);
  });

  it('isPlaceOrderClick is false for an unrelated click', () => {
    document.body.innerHTML = `<input id="placeYourOrder" type="submit" value="Place your order"><a id="other">x</a>`;
    const other = document.getElementById('other');
    const ev = { target: other, composedPath: () => [other] };
    expect(isPlaceOrderClick(ev, document)).toBe(false);
  });

  it('detects an order confirmation page', () => {
    document.body.innerHTML = `<div id="widget-purchaseConfirmationStatus">ok</div>`;
    expect(detectOrderConfirmation(document)).toBe(true);
  });

  it('detects confirmation by heading text', () => {
    document.body.innerHTML = `<h1>Order placed, thank you</h1>`;
    expect(detectOrderConfirmation(document)).toBe(true);
  });

  it('parses the final order total', () => {
    document.body.innerHTML = `<div class="grand-total-price"><span class="a-offscreen">$1,234.56</span></div>`;
    expect(parseFinalOrderTotal(document)).toBe(1234.56);
  });
});
