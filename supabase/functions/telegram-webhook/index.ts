import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.js';
import { isActionable } from '../_shared/decision.js';
import { parseCallbackData } from '../_shared/telegram.js';

// Telegram webhook + link helper. Two audiences:
//  - Telegram POSTs bot updates here (verified by the secret token set on the
//    webhook): /start binds a chat to a code; a button tap records the verdict.
//  - The extension GETs ?action=info (bot username, to build the deep link) and
//    ?action=link-status&code=... (has this code been linked yet?).
// State changes use the service role; the shopper's device never touches the DB.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

async function tg(method: string, payload: unknown) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return res.json().catch(() => null);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  const url = new URL(req.url);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Extension-facing GET actions. Non-secret: the bot username is public, and
  // link-status only reveals a boolean for a code the caller already holds.
  if (req.method === 'GET') {
    const action = url.searchParams.get('action');
    if (action === 'info') {
      const me = await tg('getMe', {});
      return json({ username: (me && me.ok && me.result) ? me.result.username : null });
    }
    if (action === 'link-status') {
      const code = url.searchParams.get('code') || '';
      if (!code) return json({ linked: false });
      const { data } = await supabase.from('telegram_links').select('chat_id').eq('code', code).maybeSingle();
      return json({ linked: !!(data && data.chat_id) });
    }
    // One-shot: register this function as the bot's webhook using the server-side
    // secret, so the operator never handles the raw bot token. Idempotent: it always
    // sets the canonical url + secret, so re-calling it just re-asserts the same config.
    if (action === 'setup') {
      const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
      if (!secret) return json({ ok: false, error: 'no_secret' }, 503);
      const hookUrl = `https://${url.host}/telegram-webhook`; // Telegram requires https; the fn sees http internally
      const result = await tg('setWebhook', { url: hookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
      return json({ url: hookUrl, result });
    }
    return json({ error: 'bad_action' }, 400);
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Verify the update actually came from Telegram (the secret token echoed from
  // setWebhook). Fail CLOSED when the secret is not configured: an unset secret
  // must be a hard error, not a silent bypass that would let anyone POST forged
  // /start or callback updates and drive the bot as a spam relay.
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'webhook_not_configured' }, 503);
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return json({ ok: false }, 401);
  }

  let update: any;
  try { update = await req.json(); } catch { return json({ ok: true }); } // ignore malformed updates

  // /start <code>: bind this chat to the code. First bind wins; a different chat
  // trying to claim an already-bound code is refused (the shopper rotates the code
  // in the extension to re-link a new device).
  if (update.message && typeof update.message.text === 'string') {
    const chatId = update.message.chat && update.message.chat.id;
    const text = update.message.text.trim();
    if (text.startsWith('/start')) {
      const code = text.slice('/start'.length).trim();
      if (!code) {
        await tg('sendMessage', { chat_id: chatId, text: 'Open "Link Telegram" in the Parago extension to connect your account.' });
        return json({ ok: true });
      }
      // Bind atomically: ensure a row exists, then claim it only if still unbound.
      // The conditional UPDATE (is chat_id null) is the lock, so exactly one chat
      // wins a fresh code even if two /start updates race. A read-then-upsert would
      // be last-write-wins and silently let a second chat steal the binding.
      await supabase.from('telegram_links').upsert({ code }, { onConflict: 'code', ignoreDuplicates: true });
      const { data: bound } = await supabase.from('telegram_links')
        .update({ chat_id: chatId, bound_at: new Date().toISOString() })
        .eq('code', code).is('chat_id', null).select('chat_id');
      if (bound && bound.length) {
        await tg('sendMessage', { chat_id: chatId, text: 'Connected. Approval requests will appear here with Approve and Reject buttons.' });
        return json({ ok: true });
      }
      // Already bound: to this chat (a harmless re-Start) or to a different device.
      const { data: cur } = await supabase.from('telegram_links').select('chat_id').eq('code', code).maybeSingle();
      const mine = cur && String(cur.chat_id) === String(chatId);
      await tg('sendMessage', { chat_id: chatId, text: mine ? 'Already connected. You are all set.' : 'This link is already connected to another device.' });
      return json({ ok: true });
    }
    return json({ ok: true });
  }

  // Button tap: record the verdict, guarded by the single-use token AND the bound
  // chat, then clear the buttons and confirm.
  if (update.callback_query) {
    const cq = update.callback_query;
    const cbId = cq.id;
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const messageId = cq.message && cq.message.message_id;
    const parsed = parseCallbackData(cq.data);
    if (!parsed) { await tg('answerCallbackQuery', { callback_query_id: cbId }); return json({ ok: true }); }

    const { data: row } = await supabase.from('purchase_requests').select('*').eq('token', parsed.token).maybeSingle();
    // The tap must come from the exact chat this request was sent to.
    if (!row || row.telegram_chat_id == null || String(row.telegram_chat_id) !== String(chatId)) {
      await tg('answerCallbackQuery', { callback_query_id: cbId, text: 'This request is not available.' });
      return json({ ok: true });
    }
    const guard = isActionable(row, Date.now());
    if (!guard.ok) {
      await tg('answerCallbackQuery', { callback_query_id: cbId, text: 'Already decided or expired.' });
      await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
      return json({ ok: true });
    }
    const { data: updated, error } = await supabase.from('purchase_requests')
      .update({ status: parsed.verdict, decided_at: new Date().toISOString(), token_used: true })
      .eq('token', parsed.token).eq('status', 'pending') // double-guard against races
      .select('id');
    if (error) {
      await tg('answerCallbackQuery', { callback_query_id: cbId, text: 'Something went wrong. Try again.' });
      return json({ ok: true });
    }
    if (!updated || !updated.length) {
      // Our update matched 0 rows: another surface (approve.html, or a second tap)
      // decided this first. Report the RECORDED verdict, never a false confirmation.
      const { data: fresh } = await supabase.from('purchase_requests').select('status').eq('token', parsed.token).maybeSingle();
      const st = fresh && fresh.status;
      await tg('answerCallbackQuery', { callback_query_id: cbId, text: st === 'approved' ? 'Already approved.' : st === 'rejected' ? 'Already rejected.' : 'Already decided.' });
      await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
      return json({ ok: true });
    }
    await tg('answerCallbackQuery', { callback_query_id: cbId, text: parsed.verdict === 'approved' ? 'Approved' : 'Rejected' });
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    await tg('sendMessage', { chat_id: chatId, text: parsed.verdict === 'approved' ? 'Approved ✓' : 'Rejected ✓' });
    return json({ ok: true });
  }

  return json({ ok: true });
});
