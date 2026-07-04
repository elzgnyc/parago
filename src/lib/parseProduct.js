// Enrichment for a cart item: pull rating/review count AND the richer detail that
// only exists on a product (/dp/) page (feature bullets, brand, "Date First
// Available", Best Sellers Rank) off the page's HTML. This runs inside the MV3
// background service worker, which has NO document and NO DOMParser, so we cannot
// build a DOM — we parse the raw HTML STRING with regular expressions only. Fully
// fail-soft: bad/empty/unmatched input yields nulls/empties and never throws.

function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' '); }
function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function clean(s) { return decode(stripTags(s)).replace(/\s+/g, ' ').trim(); }

export function parseProductMeta(html) {
  const out = { rating: null, reviewCount: null, bullets: [], dateFirstAvailable: null, rank: null, brand: null };
  if (typeof html !== 'string' || !html) return out;

  // rating: "4.7 out of 5" (Amazon's a-icon-alt text). Clamp to 0..5.
  const rm = html.match(/([0-5](?:\.\d{1,2})?)\s+out of\s+5/i);
  if (rm) { const r = parseFloat(rm[1]); if (Number.isFinite(r) && r >= 0 && r <= 5) out.rating = r; }

  // reviewCount: prefer Amazon's ratings element, else any "N ratings" phrase.
  // Live markup renders the count parenthesised, e.g. >(1,039,135)< , so allow any
  // non-digit prefix ([^\d<]*) between the tag close and the number rather than
  // requiring digits immediately. Verified against a live /dp/ page (2026-06).
  let cm = html.match(/id="acrCustomerReviewText"[^>]*>[^\d<]*([\d,]+)/i);
  if (!cm) cm = html.match(/([\d,]+)\s+(?:global\s+)?ratings?\b/i);
  if (cm) { const c = parseInt(cm[1].replace(/,/g, ''), 10); if (Number.isFinite(c)) out.reviewCount = c; }

  // Feature bullets ("About this item"): the a-list-item spans inside #feature-bullets.
  const fb = html.match(/id="feature-bullets"([\s\S]*?)(?:<\/ul>|<div id="|<hr\b)/i);
  if (fb) {
    const re = /class="a-list-item[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    const seen = new Set();
    let m;
    while ((m = re.exec(fb[1])) && out.bullets.length < 6) {
      const t = clean(m[1]);
      if (t.length < 3 || t.length > 240) continue;
      if (/make sure this fits by entering|see more product details/i.test(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t); out.bullets.push(t);
    }
  }

  out.dateFirstAvailable = labelValue(html, 'Date First Available');
  out.rank = rankValue(html);
  out.brand = brandValue(html);
  return out;
}

// A labelled value from a detail bullet (<span>Label</span> <span>Value</span>) or a
// product-details table (<th>Label</th><td>Value</td>).
function labelValue(html, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = html.match(new RegExp(esc + '\\s*<\\/span>\\s*<span[^>]*>\\s*([^<]+?)\\s*<', 'i'));
  if (m) { const v = clean(m[1]); if (v) return v; }
  m = html.match(new RegExp('<th[^>]*>\\s*' + esc + '\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>', 'i'));
  if (m) { const v = clean(m[1]); if (v) return v; }
  return null;
}

// Best Sellers Rank: keep the first "#1,234 in Category" clause (the full string is a
// long nested list of category ranks).
function rankValue(html) {
  const m = html.match(/Best Sellers Rank[\s\S]{0,400}?#([\d,]+\s+in\s+[^<(#]+)/i);
  if (m) { const v = clean('#' + m[1]).slice(0, 70); if (v.length > 3) return v; }
  return null;
}

function brandValue(html) {
  const m = html.match(/id="bylineInfo"[^>]*>\s*([^<]+?)\s*</i);
  if (m) { const v = clean(m[1]); if (v && v.length <= 80) return v; }
  return null;
}

// The extra detail worth carrying on a cart item (what the cart line lacks). Returns
// null when there is nothing useful, so callers can skip attaching an empty object.
export function productDetailFields(meta) {
  if (!meta) return null;
  const out = {};
  if (Array.isArray(meta.bullets) && meta.bullets.length) out.bullets = meta.bullets.slice(0, 6);
  if (meta.dateFirstAvailable) out.dateFirstAvailable = meta.dateFirstAvailable;
  if (meta.rank) out.rank = meta.rank;
  if (meta.brand) out.brand = meta.brand;
  return Object.keys(out).length ? out : null;
}
