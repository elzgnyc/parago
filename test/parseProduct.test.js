import { describe, it, expect } from 'vitest';
import { parseProductMeta } from '../src/lib/parseProduct.js';

// parseProductMeta runs in the MV3 service worker (no DOMParser), so it parses an
// HTML STRING with regex. These cover a normal product page, a CAPTCHA/robot wall,
// non-string input, and a page with a rating but no review-count element.
describe('parseProductMeta', () => {
  it('pulls rating and review count from a product page', () => {
    const html = `
      <div>
        <span class="a-icon-alt">4.7 out of 5 stars</span>
        <span id="acrCustomerReviewText">18,432 ratings</span>
      </div>`;
    expect(parseProductMeta(html)).toEqual({ rating: 4.7, reviewCount: 18432 });
  });

  it('returns nulls for a robot/CAPTCHA page with neither', () => {
    const html = `
      <h4>Enter the characters you see below</h4>
      <p>Sorry, we just need to make sure you're not a robot.</p>`;
    expect(parseProductMeta(html)).toEqual({ rating: null, reviewCount: null });
  });

  it('returns nulls for non-string input', () => {
    expect(parseProductMeta(null)).toEqual({ rating: null, reviewCount: null });
    expect(parseProductMeta(undefined)).toEqual({ rating: null, reviewCount: null });
    expect(parseProductMeta(42)).toEqual({ rating: null, reviewCount: null });
    expect(parseProductMeta({})).toEqual({ rating: null, reviewCount: null });
    expect(parseProductMeta('')).toEqual({ rating: null, reviewCount: null });
  });

  it('sets rating but leaves reviewCount null when no review element', () => {
    const html = '<span class="a-icon-alt">3.5 out of 5 stars</span>';
    const meta = parseProductMeta(html);
    expect(meta.rating).toBe(3.5);
    expect(meta.reviewCount).toBeNull();
  });

  it('handles the live parenthesised count markup, e.g. >(1,039,135)<', () => {
    // Verified against a real /dp/ page (2026-06): Amazon renders the acr element
    // as "(1,039,135)", so the preferred path must tolerate a non-digit prefix.
    const html = '<span class="a-icon-alt">4.7 out of 5 stars</span>' +
      '<a><span id="acrCustomerReviewText" class="a-size-base">(1,039,135)</span></a>';
    expect(parseProductMeta(html)).toEqual({ rating: 4.7, reviewCount: 1039135 });
  });

  it('falls back to a "N ratings" phrase when the element is absent', () => {
    const html = '<span>4.0 out of 5</span><span>1,205 global ratings</span>';
    expect(parseProductMeta(html)).toEqual({ rating: 4.0, reviewCount: 1205 });
  });
});
