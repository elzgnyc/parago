// test/hardenedIntercept.test.js
// Covers the fail-closed hard-block decision (Finding D) and the one-shot suppress
// guard that stops our own programmatic placement from being re-intercepted (Finding A).
import { describe, it, expect, afterEach } from 'vitest';
import { needsHardBlockFallback } from '../src/content/checkout.js';
import { suppressNextPlace, consumeSuppress, _resetSuppress } from '../src/content/interceptGuard.js';

afterEach(() => { document.body.innerHTML = ''; _resetSuppress(); });

const ALWAYS = { guardianMode: 'always', guardianLimit: 50 };

function finalPage({ withButton }) {
  document.body.innerHTML =
    `<div class="grand-total-price"><span class="a-offscreen">$80.00</span></div>` +
    (withButton ? `<input id="placeYourOrder" type="submit" value="Place your order">` : '');
}

describe('needsHardBlockFallback (fail closed)', () => {
  it('is TRUE on a final order page that needs approval with no recognizable button', () => {
    finalPage({ withButton: false });
    expect(needsHardBlockFallback(ALWAYS, document)).toBe(true);
  });

  it('is FALSE when the place-order button IS recognized (interceptor handles it)', () => {
    finalPage({ withButton: true });
    expect(needsHardBlockFallback(ALWAYS, document)).toBe(false);
  });

  it('is FALSE when there is no final order total (not the final page)', () => {
    document.body.innerHTML = `<button>Continue</button>`;
    expect(needsHardBlockFallback(ALWAYS, document)).toBe(false);
  });

  it('is FALSE when approval is not required (under the limit)', () => {
    document.body.innerHTML = `<div class="grand-total-price"><span class="a-offscreen">$10.00</span></div>`;
    expect(needsHardBlockFallback({ guardianMode: 'over_limit', guardianLimit: 50 }, document)).toBe(false);
  });
});

describe('suppress guard (no duplicate request on programmatic place)', () => {
  it('consumes exactly one suppression', () => {
    suppressNextPlace();
    expect(consumeSuppress()).toBe(true);  // our programmatic click is let through
    expect(consumeSuppress()).toBe(false); // the next genuine click is intercepted again
  });
});
