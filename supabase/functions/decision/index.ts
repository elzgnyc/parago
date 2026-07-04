import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isActionable } from '../_shared/decision.js';
import { corsHeaders, preflight } from '../_shared/cors.js';

// JSON API for the guardian approval page (docs/approve.html, hosted on GitHub
// Pages). Supabase Edge Functions on the default *.supabase.co domain rewrite any
// text/html response to text/plain, so this can no longer render the page itself;
// it serves data and records the decision, and the static page does the rendering.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

// Confirm a web-page decision back to the guardian's Telegram chat, so a decision
// made on approve.html is reflected in Telegram too (not just the browser). Best
// effort: never let a Telegram hiccup fail the decision that was already recorded.
async function notifyTelegram(chatId: number, verdict: string, total: unknown) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken || !chatId) return;
  const when = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const amount = typeof total === 'number' && isFinite(total) ? ` ($${total.toFixed(2)})` : '';
  const text = verdict === 'approved'
    ? `Purchase approved${amount} on ${when}. Parago will complete the checkout.`
    : `Purchase rejected${amount} on ${when}.`;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch { /* best effort */ }
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);

  // Token from query (GET, page load) or JSON body (POST, the verdict).
  let token = url.searchParams.get('token') ?? '';
  let verdict = '';
  let selection: any = null;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      token = String(body?.token ?? token);
      verdict = String(body?.verdict ?? '');
      selection = Array.isArray(body?.selection) ? body.selection : null;
    } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  }
  if (!token) return json({ ok: false, reason: 'invalid' }, 400);

  const { data: row } = await supabase.from('purchase_requests').select('*').eq('token', token).maybeSingle();
  const guard = isActionable(row, Date.now());

  if (req.method === 'POST') {
    // Record the verdict. Reject stale/used/expired links and bad verdicts.
    if (!guard.ok) return json({ ok: false, reason: guard.reason });
    if (verdict !== 'approved' && verdict !== 'rejected') return json({ ok: false, error: 'bad_verdict' }, 400);

    // Guardian edits: if they kept a subset / changed quantities on the approval page,
    // store the approved items + recomputed total (leaving the row untouched when the
    // selection is the full cart unchanged, so the normal approve-as-is flow is intact).
    const patch: Record<string, unknown> = { status: verdict, decided_at: new Date().toISOString(), token_used: true };
    if (verdict === 'approved' && selection) {
      const orig = Array.isArray(row.items) ? row.items : [];
      const byAsin = new Map(selection.filter((s: any) => s && s.asin != null).map((s: any) => [String(s.asin), s]));
      const kept = orig.filter((it: any) => it && it.asin != null && byAsin.has(String(it.asin)))
        .map((it: any) => {
          const q = Number(byAsin.get(String(it.asin)).qty);
          return { ...it, qty: (Number.isFinite(q) && q > 0) ? Math.round(q) : (it.qty || 1) };
        });
      const sameCount = kept.length === orig.length;
      const sameQty = kept.every((it: any, i: number) => Number(it.qty || 1) === Number((orig[i] && orig[i].qty) || 1));
      const edited = kept.length > 0 && (!sameCount || !sameQty);
      if (edited) {
        patch.items = kept;
        let sum = 0, allPriced = true;
        for (const it of kept) {
          if (typeof it.price === 'number' && Number.isFinite(it.price)) sum += it.price * (it.qty || 1);
          else { allPriced = false; break; }
        }
        if (allPriced) patch.total = Math.round(sum * 100) / 100;
      }
    }

    const { data: updated, error } = await supabase.from('purchase_requests')
      .update(patch)
      .eq('token', token).eq('status', 'pending')   // double-guard against races
      .select('id, total');
    if (error) return json({ ok: false, error: 'update_failed' }, 500);
    if (!updated || !updated.length) {
      // 0 rows updated: another surface (a Telegram tap, or a second click) decided
      // first between our read and write. Report the RECORDED verdict, not ours, so
      // the page never shows a decision the server did not store.
      const { data: fresh } = await supabase.from('purchase_requests').select('status').eq('token', token).maybeSingle();
      return json({ ok: true, status: (fresh && fresh.status) || 'decided', alreadyDecided: true });
    }
    // This call is the one that recorded the verdict → confirm it back to Telegram
    // (only the web page reaches this function; a Telegram tap goes to the webhook).
    const finalTotal = (patch.total != null) ? patch.total : row.total;
    if (row.telegram_chat_id) await notifyTelegram(row.telegram_chat_id, verdict, finalTotal);
    return json({ ok: true, status: verdict });
  }

  // GET → the purchase detail the page renders, or why it can't be acted on.
  if (!guard.ok) return json({ ok: false, reason: guard.reason });
  return json({
    ok: true,
    status: row.status,
    total: row.total,
    guardianName: row.guardian_name ?? null,
    items: Array.isArray(row.items) ? row.items : [],
  });
});
