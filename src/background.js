import { parseProductMeta } from './lib/parseProduct.js';

// MV3 background service worker. Content scripts can't make host-permission'd
// cross-origin fetches in MV3, so the relay sends a message here and we fetch.
async function doFetch({ url, options }) {
  const res = await fetch(url, options || {});
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

// Fetch a product page and extract rating/reviewCount for enrichment. A programmatic
// /dp/ fetch may return a robot-check page instead of the product page; parseProductMeta
// fail-softs to nulls in that case, and the email/page simply omit the rating.
// credentials:'include' sends the user's amazon.com cookies (background holds the
// *://*.amazon.com/* host permission) to better get the real page.
async function productMeta(asin) {
  try {
    const res = await fetch('https://www.amazon.com/dp/' + encodeURIComponent(asin), { credentials: 'include' });
    if (!res.ok) return { rating: null, reviewCount: null };
    const html = await res.text();
    return parseProductMeta(html);
  } catch { return { rating: null, reviewCount: null }; }
}

// Exactly-once placement lock. Content scripts run per-tab and chrome.storage has
// no atomic compare-and-set, so two checkout tabs loading at once could both decide
// to place the same approved order. The service worker is a SINGLE instance with a
// serialized event loop, so a check-and-set here is atomic: the first tab to claim
// an order id wins, every later claim for that id is denied. The claim is held for
// the worker's lifetime (never released): a placed/failed order is terminal and is
// never re-claimed, and a brand-new checkout uses a fresh id.
const placementClaims = new Set();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'parago_fetch') {
    doFetch(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, status: 0, body: null, error: String(e) }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === 'parago_claim_placement' && msg.id) {
    const granted = !placementClaims.has(msg.id);
    if (granted) placementClaims.add(msg.id);
    sendResponse({ granted });
    return true;
  }
  if (msg && msg.type === 'parago_product_meta' && msg.asin) {
    productMeta(msg.asin).then(sendResponse).catch(() => sendResponse({ rating: null, reviewCount: null }));
    return true; // async response
  }
  return false;
});

// No toolbar badge. Protection on/off is shown only in the popup power toggle, so the
// toolbar icon stays plain (the persistent green badge was removed by request).
