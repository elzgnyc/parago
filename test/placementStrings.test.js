// test/placementStrings.test.js
import { describe, it, expect } from 'vitest';
import { STRINGS } from '../src/i18n/strings.js';

const KEYS = [
  'placement_processing_title', 'placement_processing_body',
  'placement_finishing', 'placement_confirmed',
  'placement_failed', 'placement_manual_title', 'placement_manual_body', 'placement_manual_button',
  'placement_changed_title', 'placement_changed_body', 'placement_changed_button',
];

describe('placement strings', () => {
  it('exist in both en and vi', () => {
    for (const k of KEYS) {
      expect(STRINGS.en[k], `en.${k}`).toBeTruthy();
      expect(STRINGS.vi[k], `vi.${k}`).toBeTruthy();
    }
  });
});
