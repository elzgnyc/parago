import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.js';
import { buildBrevoPayload } from '../_shared/email.js';
import { buildTelegramMessage } from '../_shared/telegram.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const {
    total = null, items = [], deliveryMethod = 'email',
    guardianEmail = null, guardianName = null, telegramLinkCode = null,
    githubUsername = null, breakdown = null,
  } = body ?? {};

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve the recipient per delivery method, and a per-recipient filter for the
  // rate guard below. Telegram resolves the chat_id from the link code; email
  // validates the address.
  let telegramChatId: number | null = null;
  let perRecipient: (q: any) => any;
  if (deliveryMethod === 'telegram') {
    if (!telegramLinkCode) return json({ error: 'not_linked' }, 400);
    const { data: link } = await supabase.from('telegram_links').select('chat_id').eq('code', telegramLinkCode).maybeSingle();
    if (!link || !link.chat_id) return json({ error: 'not_linked' }, 400);
    telegramChatId = link.chat_id;
    perRecipient = (q) => q.eq('telegram_chat_id', telegramChatId);
  } else {
    if (!guardianEmail || !EMAIL_RE.test(String(guardianEmail))) return json({ error: 'bad_email' }, 400);
    perRecipient = (q) => q.eq('guardian_email', guardianEmail);
  }

  // Rate guard. This endpoint is public and the caller controls the recipient AND
  // the body, so without this it is a spam/phishing relay (email or Telegram) that
  // sends attacker-chosen content from your verified sender / bot. Refuse bursts.
  const HOUR_MS = 3_600_000;
  const sinceHour = new Date(Date.now() - HOUR_MS).toISOString();
  const sinceDay = new Date(Date.now() - 24 * HOUR_MS).toISOString();
  const [perRecip, perDay] = await Promise.all([
    perRecipient(supabase.from('purchase_requests').select('id', { count: 'exact', head: true })).gte('created_at', sinceHour),
    supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).gte('created_at', sinceDay),
  ]);
  if (perRecip.error || perDay.error) return json({ error: 'rate_check_failed' }, 503); // fail closed
  if ((perRecip.count ?? 0) >= 10) return json({ error: 'rate_limited' }, 429);   // per-recipient/hour
  if ((perDay.count ?? 0) >= 250) return json({ error: 'daily_cap' }, 429);        // global/day

  const token = makeToken();
  const { data, error } = await supabase
    .from('purchase_requests')
    .insert({
      token, total, items,
      guardian_email: deliveryMethod === 'telegram' ? null : guardianEmail,
      guardian_name: guardianName,
      telegram_chat_id: telegramChatId,
    })
    .select('id')
    .single();
  if (error) return json({ error: 'insert_failed', detail: error.message }, 500);

  // Attach the order-summary breakdown separately + best-effort: a failure here (e.g. the
  // column not migrated yet) must never fail the request or leave an orphan pending row.
  if (Array.isArray(breakdown) && breakdown.length) {
    try { await supabase.from('purchase_requests').update({ breakdown }).eq('id', data.id); } catch { /* ignore */ }
  }

  // The approval link points at the static page (GitHub Pages), which renders the
  // purchase and calls the decision function. Used by email and by Telegram's
  // "See full details" button.
  //
  // Resolution order: caller githubUsername -> APPROVE_URL secret -> baked default.
  // The caller only supplies a GitHub *username*, never a full URL: we validate it
  // against GitHub's username grammar and interpolate a fixed host+path, so the link
  // can only ever be https://<user>.github.io/parago/approve.html. That bounds the
  // classic phishing risk (a fully caller-controlled link on a public endpoint could
  // point a trusted-sender email/message at an arbitrary attacker page) to a
  // github.io/parago/approve.html page. If you don't want callers choosing the host,
  // leave githubUsername unset in the extension and rely on APPROVE_URL.
  const GH_USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i; // GitHub username: alnum + single internal hyphens, <=39 chars
  const ghUser = typeof githubUsername === 'string' && GH_USER_RE.test(githubUsername.trim())
    ? githubUsername.trim() : null;
  const approveBase = ghUser
    ? `https://${ghUser}.github.io/parago/approve.html`
    : (Deno.env.get('APPROVE_URL') ?? 'https://elzgnyc.github.io/parago/approve.html').replace(/\/$/, '');
  const link = `${approveBase}?token=${token}`;

  if (deliveryMethod === 'telegram') {
    const botBase = `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}`;
    const post = (method: string, payload: unknown) => fetch(`${botBase}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const { sends } = buildTelegramMessage({ chatId: telegramChatId, total, items, link, guardianName, token });
    // Send each call in order. The message that carries reply_markup is the approval
    // itself (Approve/Reject buttons) and MUST get through; a photo/album that fails
    // (bad image, hotlink block) is non-fatal — Telegram still can't attach buttons to
    // a media group anyway. If the button-bearing send fails, fall back to a text-only
    // message so the approval is never lost.
    let delivered = false;
    for (const s of sends) {
      const res = await post(s.method, s.payload);
      const carriesButtons = !!(s.payload as any).reply_markup;
      if (res.ok) {
        if (carriesButtons) delivered = true;
      } else if (carriesButtons) {
        const p = s.payload as any;
        const fb = await post('sendMessage', { chat_id: telegramChatId, text: p.caption ?? p.text, reply_markup: p.reply_markup, disable_web_page_preview: true });
        if (fb.ok) delivered = true;
      }
    }
    if (!delivered) return json({ error: 'telegram_failed' }, 502);
    return json({ id: data.id });
  }

  const payload = buildBrevoPayload({
    senderEmail: Deno.env.get('BREVO_SENDER_EMAIL')!,
    senderName: 'Parago',
    guardianEmail, guardianName, total, items, link,
  });
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': Deno.env.get('BREVO_API_KEY')!, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return json({ error: 'email_failed', detail: await res.text() }, 502);

  return json({ id: data.id });
});
