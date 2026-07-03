import { describe, it, expect, afterEach } from 'vitest';
import { parseCart, parseCartItems, parseCartTotal } from '../src/lib/parseCart.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('parseCartTotal label fallback', () => {
  it('reads the price, not the item count, from a "Subtotal (N items): $X" row', () => {
    // No known TOTAL_CONTAINERS, so the label-anchored fallback runs on the row text.
    // parseCurrency grabs the first digit-run, so the "(3 items)" count must be stripped
    // first or the total comes back as 3 instead of 59.97.
    document.body.innerHTML = '<div><span>Subtotal (3 items): $59.97</span></div>';
    expect(parseCartTotal(document)).toBe(59.97);
  });
});

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

// Amazon marks each active-cart line with a "Select <product> for checkout"
// checkbox. A DEselected item stays in the cart (and out of the subtotal) but is
// NOT being purchased, so it must not reach the guardian. Only what's checked out
// should be sent.
describe('parseCartItems excludes items deselected for checkout', () => {
  it('drops an item whose "Select … for checkout" checkbox is unchecked', () => {
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="SEL1">
          <input type="checkbox" aria-label="Select Meditations (Penguin Classics) for checkout" checked="">
          <div class="sc-product-title">Meditations</div>
        </div>
        <div class="sc-list-item" data-asin="SEL2">
          <input type="checkbox" aria-label="Select Deselected Book for checkout">
          <div class="sc-product-title">Deselected Book</div>
        </div>
      </div>`;
    expect(parseCartItems(document).map((i) => i.title)).toEqual(['Meditations']);
  });

  it('keeps an item that has no selection checkbox (filter only on a confident deselect)', () => {
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="NOCB">
          <div class="sc-product-title">No Checkbox Item</div>
        </div>
      </div>`;
    expect(parseCartItems(document).map((i) => i.title)).toEqual(['No Checkbox Item']);
  });

  it('ignores a non-selection checkbox (e.g. gift options) when deciding inclusion', () => {
    // An unchecked checkbox that is NOT the "for checkout" selection control must
    // not cause exclusion — otherwise a stray checkbox would hide a purchased item.
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="GIFT">
          <input type="checkbox" aria-label="This will be a gift">
          <div class="sc-product-title">Gift Item</div>
        </div>
      </div>`;
    expect(parseCartItems(document).map((i) => i.title)).toEqual(['Gift Item']);
  });
});

// Amazon's active-cart subtotal (#sc-subtotal-amount-activecart) reflects the WHOLE
// active cart, not the checkbox selection. When some lines are deselected, the total
// the guardian sees must match the items shown — i.e. the SELECTED subtotal.
describe('parseCart total tracks the selected items', () => {
  const cart = (extra) => `
    <div id="sc-active-cart">
      <div class="sc-list-item" data-asin="KEEP" ${extra || ''}>
        <input type="checkbox" aria-label="Select Meditations for checkout" checked="">
        <div class="sc-product-title">Meditations</div>
        <span class="a-price"><span class="a-offscreen">$7.26</span></span>
      </div>
      <div class="sc-list-item" data-asin="DROP">
        <input type="checkbox" aria-label="Select Expensive Thing for checkout">
        <div class="sc-product-title">Expensive Thing</div>
        <span class="a-price"><span class="a-offscreen">$229.99</span></span>
      </div>
    </div>
    <div id="sc-subtotal-amount-activecart"><span class="a-offscreen">$237.25</span></div>`;

  it('totals only the selected items, not the whole-cart subtotal', () => {
    document.body.innerHTML = cart();
    const { total, items } = parseCart(document);
    expect(items.map((i) => i.title)).toEqual(['Meditations']);
    expect(total).toBe(7.26); // NOT 237.25
  });

  it('multiplies unit price by quantity in the selected total', () => {
    document.body.innerHTML = cart('data-quantity="3"');
    expect(parseCart(document).total).toBe(21.78); // 7.26 × 3
  });

  it('keeps the page subtotal when a selected item has no parseable price', () => {
    // Can't trust a partial sum, so fall back to the page subtotal rather than
    // send a fabricated number.
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="KEEP">
          <input type="checkbox" aria-label="Select NoPrice for checkout" checked="">
          <div class="sc-product-title">NoPrice</div>
        </div>
        <div class="sc-list-item" data-asin="DROP">
          <input type="checkbox" aria-label="Select Other for checkout">
          <div class="sc-product-title">Other</div>
        </div>
      </div>
      <div id="sc-subtotal-amount-activecart"><span class="a-offscreen">$99.00</span></div>`;
    expect(parseCart(document).total).toBe(99);
  });

  it('leaves the total unchanged when nothing is deselected', () => {
    document.body.innerHTML = `
      <div id="sc-active-cart">
        <div class="sc-list-item" data-asin="A">
          <input type="checkbox" aria-label="Select A for checkout" checked="">
          <div class="sc-product-title">A</div>
          <span class="a-price"><span class="a-offscreen">$5.00</span></span>
        </div>
      </div>
      <div id="sc-subtotal-amount-activecart"><span class="a-offscreen">$5.00</span></div>`;
    expect(parseCart(document).total).toBe(5);
  });
});
