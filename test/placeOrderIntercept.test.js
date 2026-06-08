// test/placeOrderIntercept.test.js
import { describe, it, expect, afterEach } from 'vitest';
import { evaluatePlaceOrder } from '../src/content/checkout.js';

afterEach(() => { document.body.innerHTML = ''; });

function checkoutDom(total) {
  document.body.innerHTML =
    `<div id="sc-active-cart"><div class="sc-list-item" data-asin="A1"><div class="sc-product-title">Widget</div></div></div>` +
    `<div class="grand-total-price"><span class="a-offscreen">$${total}</span></div>`;
}

describe('evaluatePlaceOrder', () => {
  it('holds in always mode', () => {
    checkoutDom('10.00');
    const r = evaluatePlaceOrder({ guardianMode: 'always', guardianLimit: 50 }, document);
    expect(r.hold).toBe(true);
    expect(r.total).toBe(10);
    expect(r.items.map((i) => i.asin)).toEqual(['A1']);
  });

  it('holds in over_limit mode when the final total exceeds the limit', () => {
    checkoutDom('80.00');
    expect(evaluatePlaceOrder({ guardianMode: 'over_limit', guardianLimit: 50 }, document).hold).toBe(true);
  });

  it('does not hold under the limit', () => {
    checkoutDom('10.00');
    expect(evaluatePlaceOrder({ guardianMode: 'over_limit', guardianLimit: 50 }, document).hold).toBe(false);
  });

  it('holds (fail closed) in over_limit mode when the total cannot be parsed', () => {
    document.body.innerHTML = `<div id="sc-active-cart"></div>`;
    expect(evaluatePlaceOrder({ guardianMode: 'over_limit', guardianLimit: 50 }, document).hold).toBe(true);
  });

  it('never holds when guardian mode is off', () => {
    checkoutDom('999.00');
    expect(evaluatePlaceOrder({ guardianMode: 'off', guardianLimit: 50 }, document).hold).toBe(false);
  });
});
