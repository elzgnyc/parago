// test/proactiveBlock.test.js
// Root cause (confirmed live): Amazon's new SPC checkout submits the order on
// pointerdown and navigates before `click` fires, so a click-only interceptor never
// runs and the order places with no approval. The fix blocks PROACTIVELY: on a
// place-order page that needs approval we engage the overlay up front, without
// waiting for (or trusting) any click event. These tests pin that trigger.
import { describe, it, expect, afterEach } from 'vitest';
import { hasPlaceOrderIntent } from '../src/lib/placeOrder.js';
import { isPlaceOrderPage } from '../src/content/checkout.js';

afterEach(() => { document.body.innerHTML = ''; history.pushState({}, '', '/'); });

describe('hasPlaceOrderIntent', () => {
  it('true when a recognized place-order input exists', () => {
    document.body.innerHTML = '<input name="placeYourOrder1" type="submit" value="Place your order">';
    expect(hasPlaceOrderIntent(document)).toBe(true);
  });

  it('true when only the "Place your order" TEXT exists (button not in our selector list)', () => {
    // The real SPC case: Amazon delivers the click to an <a class="a-button-text">.
    document.body.innerHTML = '<a class="a-button-text">Place your order</a>';
    expect(hasPlaceOrderIntent(document)).toBe(true);
  });

  it('false on a page with no place-order affordance', () => {
    document.body.innerHTML = '<button>Continue shopping</button>';
    expect(hasPlaceOrderIntent(document)).toBe(false);
  });
});

describe('isPlaceOrderPage (proactive-block trigger)', () => {
  it('TRUE on the SPC place-order page even when the total cannot be parsed', () => {
    history.pushState({}, '', '/checkout/p/p-123-456/spc');
    document.body.innerHTML = '<input id="placeOrder" name="placeYourOrder1" type="submit" value="Place your order">';
    expect(isPlaceOrderPage(document)).toBe(true);
  });

  it('FALSE on the order-confirmation (thank you) page even if place-order text lingers', () => {
    history.pushState({}, '', '/gp/buy/thankyou/handlers/display.html');
    document.body.innerHTML = '<a class="a-button-text">Place your order</a>';
    expect(isPlaceOrderPage(document)).toBe(false);
  });

  it('FALSE on a non-checkout page', () => {
    history.pushState({}, '', '/s?k=widgets');
    document.body.innerHTML = '<input name="placeYourOrder1" value="Place your order">';
    expect(isPlaceOrderPage(document)).toBe(false);
  });

  it('FALSE on a checkout page with no place-order intent yet (still navigating)', () => {
    history.pushState({}, '', '/checkout/entry/cart');
    document.body.innerHTML = '<button>Proceed to checkout</button>';
    expect(isPlaceOrderPage(document)).toBe(false);
  });
});
