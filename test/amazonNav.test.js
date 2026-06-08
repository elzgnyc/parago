// test/amazonNav.test.js
import { describe, it, expect } from 'vitest';
import { pageKind } from '../src/content/amazonNav.js';

describe('pageKind', () => {
  it('classifies checkout pages', () => {
    expect(pageKind({ pathname: '/gp/buy/spc/handlers/display.html' })).toBe('checkout');
    expect(pageKind({ pathname: '/checkout/p/123' })).toBe('checkout');
  });
  it('classifies cart pages', () => {
    expect(pageKind({ pathname: '/gp/cart/view.html' })).toBe('cart');
    expect(pageKind({ pathname: '/cart' })).toBe('cart');
  });
  it('classifies everything else as other', () => {
    expect(pageKind({ pathname: '/s' })).toBe('other');
    expect(pageKind({ pathname: '/dp/B000' })).toBe('other');
  });
});
