import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isActionable } from '../_shared/decision.js';

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#222}` +
    `button{font-size:1.1rem;padding:.7rem 1.4rem;margin:.4rem .4rem 0 0;border-radius:8px;border:0;cursor:pointer}` +
    `.ok{background:#1f8a4c;color:#fff}.no{background:#b23b3b;color:#fff}ul{line-height:1.6}</style>${body}`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function money(n: any) { return (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(2) : '—'; }

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
    .map((it: any) => `<li>${esc(it?.title || 'Item')}${typeof it?.price === 'number' ? ` — $${money(it.price)}` : ''}</li>`).join('');
  return html(
    `<h1>Approve this purchase?</h1>` +
    (row.guardian_name ? `<p>Requested approval from ${esc(row.guardian_name)}.</p>` : '') +
    `<p><strong>Total: $${money(row.total)}</strong></p><ul>${items}</ul>` +
    `<form method="POST" action="?"><input type="hidden" name="token" value="${esc(token)}">` +
    `<button class="ok" name="verdict" value="approved">Approve</button>` +
    `<button class="no" name="verdict" value="rejected">Reject</button></form>`);
});
