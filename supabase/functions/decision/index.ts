import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isActionable } from '../_shared/decision.js';
import { corsHeaders, preflight } from '../_shared/cors.js';

// JSON API for the guardian approval page (docs/approve.html, hosted on GitHub
// Pages). Supabase Edge Functions on the default *.supabase.co domain rewrite any
// text/html response to text/plain, so this can no longer render the page itself;
// it serves data and records the decision, and the static page does the rendering.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);

  // Token from query (GET, page load) or JSON body (POST, the verdict).
  let token = url.searchParams.get('token') ?? '';
  let verdict = '';
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      token = String(body?.token ?? token);
      verdict = String(body?.verdict ?? '');
    } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  }
  if (!token) return json({ ok: false, reason: 'invalid' }, 400);

  const { data: row } = await supabase.from('purchase_requests').select('*').eq('token', token).maybeSingle();
  const guard = isActionable(row, Date.now());

  if (req.method === 'POST') {
    // Record the verdict. Reject stale/used/expired links and bad verdicts.
    if (!guard.ok) return json({ ok: false, reason: guard.reason });
    if (verdict !== 'approved' && verdict !== 'rejected') return json({ ok: false, error: 'bad_verdict' }, 400);
    const { error } = await supabase.from('purchase_requests')
      .update({ status: verdict, decided_at: new Date().toISOString(), token_used: true })
      .eq('token', token).eq('status', 'pending');   // double-guard against races
    if (error) return json({ ok: false, error: 'update_failed' }, 500);
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
