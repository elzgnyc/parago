// Pure builder for a Brevo transactional-email payload (POST /v3/smtp/email).
// No network here — the Edge Function does the actual fetch with this object.
function money(n) {
  return (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(2) : '—';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildBrevoPayload({ senderEmail, senderName, guardianEmail, guardianName, total, items, link }) {
  const list = Array.isArray(items) ? items : [];
  const to = guardianName ? [{ email: guardianEmail, name: guardianName }] : [{ email: guardianEmail }];
  const totalStr = money(total);

  const itemsHtml = list.map((it) => {
    const price = (it && typeof it.price === 'number') ? ` — $${money(it.price)}` : '';
    return `<li>${escapeHtml((it && it.title) || 'Item')}${price}</li>`;
  }).join('');
  const itemsText = list.map((it) => {
    const price = (it && typeof it.price === 'number') ? ` - $${money(it.price)}` : '';
    return `- ${(it && it.title) || 'Item'}${price}`;
  }).join('\n');

  const subject = `Approve a purchase — $${totalStr}`;
  const htmlContent =
    `<p>${guardianName ? escapeHtml(guardianName) + ', a' : 'A'} purchase needs your approval.</p>` +
    `<p><strong>Total: $${totalStr}</strong></p>` +
    `<ul>${itemsHtml}</ul>` +
    `<p><a href="${link}">Review and approve or reject</a></p>` +
    `<p style="color:#888;font-size:12px">This link expires in 24 hours.</p>`;
  const textContent =
    `A purchase needs your approval.\nTotal: $${totalStr}\n${itemsText}\n\nReview: ${link}\n\nThis link expires in 24 hours.`;

  return { sender: { email: senderEmail, name: senderName }, to, subject, htmlContent, textContent };
}
