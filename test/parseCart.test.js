import { describe, it, expect, afterEach } from 'vitest';
import { parseCart, parseCartItems, parseCartTotal } from '../src/lib/parseCart.js';

afterEach(() => { document.body.innerHTML = ''; });

// Amazon's cart page renders the ACTIVE cart and a "Saved for later" section with
// the SAME .sc-list-item[data-asin] markup. Only the active cart is being purchased,
// so saved items must never leak into the parsed items (they show in the approval
// overlay + email) and must never affect the total.
const CART_HTML = `
  <form id="activeCartViewForm">
    <div id="sc-active-cart">
      <div class="sc-list-item" data-asin="ACTIVE1" data-itemid="i1">
        <div class="sc-product-title">Active Item One</div>
        <span class="a-price"><span class="a-offscreen">$10.00</span></span>
      </div>
      <div class="sc-list-item" data-asin="ACTIVE2" data-itemid="i2">
        <div class="sc-product-title">Active Item Two</div>
      </div>
    </div>
  </form>
  <div id="sc-subtotal-amount-activecart"><span class="a-offscreen">$30.00</span></div>
  <form id="saved-for-later">
    <div id="sc-saved-cart">
      <div class="sc-list-item" data-asin="SAVED1" data-itemid="s1">
        <div class="sc-product-title">Saved Item One</div>
        <span class="a-price"><span class="a-offscreen">$999.00</span></span>
      </div>
      <div class="sc-list-item" data-asin="SAVED2" data-itemid="s2">
        <div class="sc-product-title">Saved Item Two</div>
      </div>
    </div>
  </form>`;

describe('parseCart excludes Saved for later', () => {
  it('parseCartItems returns only active-cart items', () => {
    document.body.innerHTML = CART_HTML;
    const titles = parseCartItems(document).map((i) => i.title);
    expect(titles).toEqual(['Active Item One', 'Active Item Two']);
  });

  it('parseCartTotal reads the active-cart subtotal, not saved items', () => {
    document.body.innerHTML = CART_HTML;
    expect(parseCartTotal(document)).toBe(30);
  });

  it('parseCart agrees', () => {
    document.body.innerHTML = CART_HTML;
    const { total, items } = parseCart(document);
    expect(total).toBe(30);
    expect(items.map((i) => i.asin)).toEqual(['ACTIVE1', 'ACTIVE2']);
  });

  // Fallback: no #sc-active-cart wrapper (DOM variant). Loose items still parse,
  // but anything inside the saved section is still dropped.
  it('drops saved items even without an active-cart container', () => {
    document.body.innerHTML = `
      <div class="sc-list-item" data-asin="A1"><div class="sc-product-title">Loose Active</div></div>
      <div id="sc-saved-cart">
        <div class="sc-list-item" data-asin="A2"><div class="sc-product-title">Saved</div></div>
      </div>`;
    expect(parseCartItems(document).map((i) => i.title)).toEqual(['Loose Active']);
  });
});

describe('parseCartItems enriches items with EASY fields', () => {
  it('parses price, qty, image, and url from item markup', () => {
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="B0EASY1" data-quantity="2">
          <div class="sc-product-title">Enriched Item</div>
          <span class="a-price"><span class="a-offscreen">$12.34</span></span>
          <img class="sc-product-image" src="https://m.media-amazon.com/images/I/easy.jpg">
        </div>
      </div>`;
    const [item] = parseCartItems(document);
    expect(item.price).toBe(12.34);
    expect(item.qty).toBe(2);
    expect(item.image).toBe('https://m.media-amazon.com/images/I/easy.jpg');
    expect(item.url).toBe('https://www.amazon.com/dp/B0EASY1');
    expect(item.title).toBe('Enriched Item');
    expect(item.asin).toBe('B0EASY1');
  });

  it('reads qty from a quantity input when data-quantity is absent', () => {
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="B0QTYIN">
          <div class="sc-product-title">Qty Input Item</div>
          <input class="sc-quantity-textfield" name="quantity" value="3">
        </div>
      </div>`;
    expect(parseCartItems(document)[0].qty).toBe(3);
  });

  it('defaults qty to 1 when there is no quantity markup', () => {
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="B0NOQTY">
          <div class="sc-product-title">No Qty Item</div>
        </div>
      </div>`;
    expect(parseCartItems(document)[0].qty).toBe(1);
  });

  it('null price/image and null url when markup and asin are absent', () => {
    // Empty data-asin still matches [data-name][data-asin] but yields a null asin,
    // so url must be null (no /dp/ link without an asin).
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="" data-name="No Asin Item">
          <div class="sc-product-title">No Asin Item</div>
        </div>
      </div>`;
    const [item] = parseCartItems(document);
    expect(item.asin).toBeNull();
    expect(item.url).toBeNull();
    expect(item.price).toBeNull();
    expect(item.image).toBeNull();
    expect(item.qty).toBe(1);
  });
});
