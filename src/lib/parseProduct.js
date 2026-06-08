// Enrichment for a cart item: pull the star rating + review count off a product
// page's HTML. This runs inside the MV3 background service worker, which has NO
// document and NO DOMParser, so we cannot build a DOM. We parse the raw HTML
// STRING with regular expressions only. Fully fail-soft: bad/empty/unmatched
// input yields { rating: null, reviewCount: null } and never throws.

export function parseProductMeta(html) {
  const out = { rating: null, reviewCount: null };
  if (typeof html !== 'string' || !html) return out;

  // rating: "4.7 out of 5" (Amazon's a-icon-alt text). Clamp to 0..5.
  const rm = html.match(/([0-5](?:\.\d{1,2})?)\s+out of\s+5/i);
  if (rm) {
    const r = parseFloat(rm[1]);
    if (Number.isFinite(r) && r >= 0 && r <= 5) out.rating = r;
  }

  // reviewCount: prefer Amazon's ratings element, else any "N ratings" phrase.
  // Live markup renders the count parenthesised, e.g. >(1,039,135)< , so allow any
  // non-digit prefix ([^\d<]*) between the tag close and the number rather than
  // requiring digits immediately. Verified against a live /dp/ page (2026-06).
  let cm = html.match(/id="acrCustomerReviewText"[^>]*>[^\d<]*([\d,]+)/i);
  if (!cm) cm = html.match(/([\d,]+)\s+(?:global\s+)?ratings?\b/i);
  if (cm) {
    const c = parseInt(cm[1].replace(/,/g, ''), 10);
    if (Number.isFinite(c)) out.reviewCount = c;
  }

  return out;
}
