import { describe, it, expect } from 'vitest';
import { shouldUseSupabase } from '../src/relay/selectRelay.js';

describe('shouldUseSupabase', () => {
  const cfg = { functionsBaseUrl: 'https://x.functions.supabase.co' };
  it('true when a base URL and guardian email are both present', () => {
    expect(shouldUseSupabase({ guardianEmail: 'h@e.com' }, cfg)).toBe(true);
  });
  it('false when guardian email is empty (fall back to local MockRelay)', () => {
    expect(shouldUseSupabase({ guardianEmail: '' }, cfg)).toBe(false);
  });
  it('false when the base URL is the unreplaced placeholder', () => {
    expect(shouldUseSupabase({ guardianEmail: 'h@e.com' }, { functionsBaseUrl: 'https://<PROJECT_REF>.functions.supabase.co' })).toBe(false);
  });
});
