// Pure builders for the Telegram Bot API. No network here; the Edge Function does
// the fetch with the returned object. Plain text only (no parse_mode), so there is
// no markup injection. But the caption is newline-joined, so untrusted strings
// (item titles, guardianName, all attacker-influenceable via the public endpoint)
// are stripped of newlines and control/bidi chars first: without that, a title
// like "Widget\nTotal: $2.00" would forge a second total line and mislead the
// guardian's approval decision.

function fmtMoney(n) {
  return (typeof n === 'number' && Number.isFinite(n)) ? '$' + n.toFixed(2) : '';
}

// Replace newlines and control/bidi-override chars with a space so untrusted text
// cannot inject or reorder lines in the plain-text approval message. Stripped:
// C0 controls (incl. \n, \r), DEL, line/paragraph separators, and bidi overrides.
function clean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    const bad = c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e);
    out += bad ? ' ' : ch;
  }
  return out.trim();
}

// Star/rating line, mirroring the email + approve.html rendering. Empty when the
// rating is not a finite number; omits the count when reviewCount is missing.
function stars(rating, reviewCount) {
  if (rating == null) return '';
  const r = Number(rating);
  if (!Number.isFinite(r)) return '';
  const cr = Math.max(0, Math.min(5, r)); // clamp: request-body ratings are unvalidated
  const r2 = Math.round(cr * 2) / 2;
  const full = Math.floor(r2);
  const half = (r2 - full) === 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  const s = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  const rc = Number(reviewCount);
  const count = (reviewCount != null && Number.isFinite(rc)) ? ` (${rc.toLocaleString()})` : '';
  return `${s} ${cr.toFixed(1)}${count}`;
}

const MAX_ITEMS_IN_CAPTION = 6;
const CAPTION_LIMIT = 1024; // Telegram sendPhoto caption hard limit

// Build the sendPhoto (or sendMessage) call for one approval request. Leads with a
// product photo when an item has an http(s) image; the "See full details" button
// opens approve.html for the full, rich, tap-through-to-Amazon view. Approve/Reject
// are inline callback buttons carrying the single-use token.
export function buildTelegramMessage({ chatId, total, items, link, guardianName, token }) {
  const list = Array.isArray(items) ? items : [];
  const totalStr = fmtMoney(total);
  const who = clean(guardianName);
  const header = (who ? `${who}, a` : 'A') + ' purchase needs your approval.';
  const totalLine = totalStr ? `Total: ${totalStr}` : '';

  const shown = list.slice(0, MAX_ITEMS_IN_CAPTION);
  const lines = shown.map((it) => {
    const o = it || {};
    const title = clean(o.title) || 'Item';
    const price = (typeof o.price === 'number') ? ' ' + fmtMoney(o.price) : '';
    const qtyNum = Number(o.qty);
    const qty = (Number.isFinite(qtyNum) && qtyNum > 1) ? ` x${qtyNum}` : '';
    const meta = stars(o.rating, o.reviewCount);
    return `- ${title}${price}${qty}${meta ? '  ' + meta : ''}`;
  });
  const more = list.length > shown.length ? `...and ${list.length - shown.length} more` : '';

  let text = [header, totalLine, '', ...lines, more, '', 'Tap Approve or Reject below, or open See full details for photos and links.']
    .filter((s) => s !== '')
    .join('\n');
  if (text.length > CAPTION_LIMIT) text = text.slice(0, CAPTION_LIMIT - 1) + '…';

  const reply_markup = {
    inline_keyboard: [
      [{ text: '✅ Approve', callback_data: 'a:' + token }, { text: '❌ Reject', callback_data: 'r:' + token }],
      [{ text: '🔎 See full details', url: link }],
    ],
  };

  const firstImg = shown.map((it) => it && it.image).find((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  if (firstImg) {
    return { method: 'sendPhoto', payload: { chat_id: chatId, photo: firstImg, caption: text, reply_markup } };
  }
  return { method: 'sendMessage', payload: { chat_id: chatId, text, reply_markup, disable_web_page_preview: true } };
}

// Inline-button callback_data is 'a:<token>' (approve) or 'r:<token>' (reject).
// Returns { verdict, token } or null. Kept short to stay under Telegram's 64-byte
// callback_data limit.
export function parseCallbackData(data) {
  const s = String(data || '');
  const i = s.indexOf(':');
  if (i < 0) return null;
  const prefix = s.slice(0, i);
  const token = s.slice(i + 1);
  if (!token) return null;
  if (prefix === 'a') return { verdict: 'approved', token };
  if (prefix === 'r') return { verdict: 'rejected', token };
  return null;
}
