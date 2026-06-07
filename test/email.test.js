import { describe, it, expect } from 'vitest';
import { buildBrevoPayload } from '../supabase/functions/_shared/email.js';

describe('buildBrevoPayload', () => {
  const opts = {
    senderEmail: 'noreply@example.com',
    senderName: 'Parago',
    guardianEmail: 'helper@example.com',
    guardianName: 'Alex',
    total: 42.5,
    items: [{ title: 'Reading glasses', price: 19.99 }, { title: 'Lamp' }],
    link: 'https://x.functions.supabase.co/decision?token=abc',
  };

  it('addresses the guardian and a verified sender', () => {
    const p = buildBrevoPayload(opts);
    expect(p.sender).toEqual({ email: 'noreply@example.com', name: 'Parago' });
    expect(p.to).toEqual([{ email: 'helper@example.com', name: 'Alex' }]);
  });
  it('puts the total in the subject', () => {
    expect(buildBrevoPayload(opts).subject).toContain('42.50');
  });
  it('includes the approval link and item titles in the HTML and text', () => {
    const p = buildBrevoPayload(opts);
    expect(p.htmlContent).toContain(opts.link);
    expect(p.htmlContent).toContain('Reading glasses');
    expect(p.textContent).toContain(opts.link);
    expect(p.textContent).toContain('Lamp');
  });
  it('omits the name when guardianName is empty', () => {
    const p = buildBrevoPayload({ ...opts, guardianName: '' });
    expect(p.to).toEqual([{ email: 'helper@example.com' }]);
  });
});
