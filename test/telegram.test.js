import { describe, it, expect } from 'vitest';
import { buildTelegramMessage, parseCallbackData } from '../supabase/functions/_shared/telegram.js';

describe('buildTelegramMessage', () => {
  const base = {
    chatId: 12345,
    total: 47.98,
    items: [
      { title: 'Anker USB-C Cable', price: 9.99, qty: 1, rating: 4.7, reviewCount: 18432, image: 'https://m.media-amazon.com/images/I/abc.jpg' },
      { title: 'Logitech Mouse', price: 37.99, qty: 1, rating: 4.5, reviewCount: 9210, image: 'https://m.media-amazon.com/images/I/def.jpg' },
    ],
    link: 'https://x.github.io/parago/approve.html?token=TOK',
    guardianName: 'Mom',
    token: 'TOK',
  };

  it('uses sendPhoto with the first item image, addressed to the chat', () => {
    const m = buildTelegramMessage(base);
    expect(m.method).toBe('sendPhoto');
    expect(m.payload.photo).toBe('https://m.media-amazon.com/images/I/abc.jpg');
    expect(m.payload.chat_id).toBe(12345);
  });
  it('caption carries greeting, total, and every shown item title', () => {
    const c = buildTelegramMessage(base).payload.caption;
    expect(c).toContain('Mom');
    expect(c).toContain('47.98');
    expect(c).toContain('Anker USB-C Cable');
    expect(c).toContain('Logitech Mouse');
  });
  it('inline keyboard has approve/reject callbacks and a details url', () => {
    const kb = buildTelegramMessage(base).payload.reply_markup.inline_keyboard;
    expect(kb[0][0].callback_data).toBe('a:TOK');
    expect(kb[0][1].callback_data).toBe('r:TOK');
    expect(kb[1][0].url).toBe(base.link);
  });
  it('falls back to sendMessage when no item has an http image', () => {
    const m = buildTelegramMessage({ ...base, items: [{ title: 'No image item', price: 5 }] });
    expect(m.method).toBe('sendMessage');
    expect(m.payload.text).toContain('No image item');
  });
  it('omits the total line when total is unknown, with no em dash', () => {
    const m = buildTelegramMessage({ ...base, total: null, items: [{ title: 'X' }] });
    expect(m.payload.text).not.toContain('Total:');
    expect(m.payload.text).not.toContain('—');
  });
  it('truncates a long item list and notes the remainder', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: 'Item ' + i, price: 1 }));
    const m = buildTelegramMessage({ ...base, items: many });
    expect(m.payload.caption || m.payload.text).toContain('and 3 more');
  });
  it('callback_data stays within Telegram 64-byte limit for a real token', () => {
    const realToken = 'a'.repeat(43); // 32 bytes base64url
    const kb = buildTelegramMessage({ ...base, token: realToken }).payload.reply_markup.inline_keyboard;
    expect(kb[0][0].callback_data.length).toBeLessThanOrEqual(64);
  });
  it('strips newlines from an item title so it cannot forge a fake total line', () => {
    const m = buildTelegramMessage({ ...base, total: 500, items: [{ title: 'Widget\nTotal: $2.00' }] });
    const caption = m.payload.caption || m.payload.text;
    expect(caption).not.toMatch(/\nTotal: \$2\.00/); // the injected line is neutralized
    expect(caption).toContain('Total: $500.00');     // the real total survives
  });
  it('strips newlines/control chars from guardianName', () => {
    const m = buildTelegramMessage({ ...base, guardianName: 'Mom\r\nInjected line', items: [{ title: 'X' }] });
    const caption = m.payload.caption || m.payload.text;
    expect(caption).not.toContain('\nInjected');
    expect(caption).toContain('Mom');
  });
});

describe('parseCallbackData', () => {
  it('parses approve and reject', () => {
    expect(parseCallbackData('a:TOK')).toEqual({ verdict: 'approved', token: 'TOK' });
    expect(parseCallbackData('r:TOK')).toEqual({ verdict: 'rejected', token: 'TOK' });
  });
  it('splits on the first colon only, so a token containing a colon survives', () => {
    expect(parseCallbackData('a:to:ken')).toEqual({ verdict: 'approved', token: 'to:ken' });
  });
  it('rejects junk, missing token, or a bad prefix', () => {
    expect(parseCallbackData('x:TOK')).toBeNull();
    expect(parseCallbackData('a:')).toBeNull();
    expect(parseCallbackData('nope')).toBeNull();
    expect(parseCallbackData('')).toBeNull();
  });
});
