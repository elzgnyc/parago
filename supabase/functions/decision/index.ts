import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isActionable } from '../_shared/decision.js';

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#222}` +
    `button{font-size:1.1rem;padding:.7rem 1.4rem;margin:.4rem .4rem 0 0;border-radius:8px;border:0;cursor:pointer}` +
    `.ok{background:#1f8a4c;color:#fff}.no{background:#b23b3b;color:#fff}ul{line-height:1.6}` +
    // Rich item rows: small thumbnail, title, muted meta line.
    `ul.items{list-style:none;padding:0;margin:0}` +
    `ul.items li{display:flex;gap:.75rem;align-items:flex-start;padding:.6rem 0;border-top:1px solid #eee}` +
    `ul.items li:first-child{border-top:0}` +
    `.thumb{width:64px;height:64px;object-fit:contain;flex:0 0 auto;border-radius:6px;background:#f6f6f6}` +
    `.it-body{min-width:0;flex:1 1 auto}.it-title{font-weight:600}.it-title a{color:inherit}` +
    `.it-meta{color:#888;font-size:.85rem;margin-top:.15rem}</style>${body}`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function money(n: any) { return (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(2) : '—'; }

// Build a star/rating meta line. rating is numeric (0..5); glyphs need no escaping.
// reviewCount is optional; when absent show the rating without a count.
function renderStars(rating: number, reviewCount: any) {
  // Clamp to [0,5]: a finite but out-of-range rating (items are stored from the
  // request body, validated nowhere) would make full/empty negative and crash
  // '☆'.repeat(). Mirror of email.js renderStars; keep the two in sync.
  const cr = Math.max(0, Math.min(5, rating));
  const r2 = Math.round(cr * 2) / 2;
  const full = Math.floor(r2);
  const half = (r2 - full) === 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  const stars = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  const count = (typeof reviewCount === 'number' && Number.isFinite(reviewCount))
    ? ` · ${Math.round(reviewCount).toLocaleString()} ratings` : '';
  return `${stars} ${cr.toFixed(1)}${count}`;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);

  // Read token from query (GET) or form body (POST).
  let token = url.searchParams.get('token') ?? '';
  let verdict = '';
  if (req.method === 'POST') {
    const form = await req.formData();
    token = String(form.get('token') ?? '');
    verdict = String(form.get('verdict') ?? '');
  }
  if (!token) return html('<h1>Invalid link</h1>', 400);

  const { data: row } = await supabase.from('purchase_requests').select('*').eq('token', token).maybeSingle();
  const guard = isActionable(row, Date.now());
  if (!guard.ok) {
    const msg = { not_found: 'This link is not valid.', used: 'This request was already decided.',
      decided: 'This request was already decided.', expired: 'This link has expired.' }[guard.reason!] ?? 'This link cannot be used.';
    return html(`<h1>${esc(msg)}</h1>`);
  }

  if (req.method === 'POST') {
    if (verdict !== 'approved' && verdict !== 'rejected') return html('<h1>Invalid choice</h1>', 400);
    const { error } = await supabase.from('purchase_requests')
      .update({ status: verdict, decided_at: new Date().toISOString(), token_used: true })
      .eq('token', token).eq('status', 'pending');   // double-guard against races
    if (error) return html('<h1>Something went wrong. Try again.</h1>', 500);
    return html(`<h1>${verdict === 'approved' ? 'Approved ✓' : 'Rejected'}</h1><p>You can close this page.</p>`);
  }

  // GET → render the approve/reject page (buttons POST; email prefetch of this GET only renders).
  const items = (Array.isArray(row.items) ? row.items : [])
    .map((it: any) => {
      const title = esc(it?.title || 'Item');
      // Thumbnail: only render an <img> for an http(s) image URL.
      const img = (typeof it?.image === 'string' && /^https?:\/\//i.test(it.image))
        ? `<img class="thumb" src="${esc(it.image)}" alt="">` : '';
      // Link the title to the product page only for an http(s) url. esc()
      // neutralises quotes/brackets but NOT a "javascript:" scheme (no special
      // chars), so a crafted url would yield a clickable javascript: link.
      // Match the image guard: scheme-allowlist before linking.
      const safeUrl = (typeof it?.url === 'string' && /^https?:\/\//i.test(it.url)) ? it.url : null;
      const titleHtml = safeUrl
        ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener">${title}</a>` : title;
      // Per-item price, and qty only when more than one.
      const price = (typeof it?.price === 'number') ? ` · $${money(it.price)}` : '';
      const qty = (Number.isFinite(Number(it?.qty)) && Number(it.qty) > 1) ? ` × ${Math.round(Number(it.qty))}` : '';
      // Star/rating meta line only when rating is present.
      const meta = (typeof it?.rating === 'number' && Number.isFinite(it.rating))
        ? `<div class="it-meta">${renderStars(it.rating, it.reviewCount)}</div>` : '';
      return `<li>${img}<div class="it-body"><div class="it-title">${titleHtml}${price}${qty}</div>${meta}</div></li>`;
    }).join('');
  return html(
    `<h1>Approve this purchase?</h1>` +
    (row.guardian_name ? `<p>Requested approval from ${esc(row.guardian_name)}.</p>` : '') +
    `<p><strong>Total: $${money(row.total)}</strong></p><ul class="items">${items}</ul>` +
    `<form method="POST" action="?"><input type="hidden" name="token" value="${esc(token)}">` +
    `<button class="ok" name="verdict" value="approved">Approve</button>` +
    `<button class="no" name="verdict" value="rejected">Reject</button></form>`);
});
