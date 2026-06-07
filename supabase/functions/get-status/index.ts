import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json({ error: 'missing_id' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data } = await supabase.from('purchase_requests')
    .select('id,status,total,decided_at,expires_at').eq('id', id).maybeSingle();
  if (!data) return json({ error: 'not_found' }, 404);
  // Report expiry on read: a still-'pending' row past expires_at is dead (its link
  // no longer works), so surface 'expired' and let the client prune + resubmit
  // instead of reusing a stuck request forever.
  const status = (data.status === 'pending' && new Date(data.expires_at).getTime() <= Date.now())
    ? 'expired' : data.status;
  return json({ id: data.id, status, total: data.total, decidedAt: data.decided_at });
});
