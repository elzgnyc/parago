// test/placementOverlay.test.js
import { describe, it, expect, afterEach } from 'vitest';
import {
  showProcessing, showFinishing, showConfirmed, showCouldNotComplete,
  showManualFallback, removePlacementOverlay, isPlacementOverlayShown,
} from '../src/content/placementOverlay.js';

afterEach(() => { removePlacementOverlay(); document.body.innerHTML = ''; });

describe('placementOverlay', () => {
  it('shows the processing screen and blocks the page', () => {
    showProcessing();
    expect(isPlacementOverlayShown()).toBe(true);
    expect(document.body.textContent).toContain('being processed');
  });

  it('replaces content when switching messages', () => {
    showProcessing();
    showConfirmed();
    expect(document.querySelectorAll('#parago-placement-overlay').length).toBe(1);
    expect(document.body.textContent).toContain('confirmed');
  });

  it('manual fallback wires the button to the callback', () => {
    let clicked = false;
    showManualFallback(() => { clicked = true; });
    document.querySelector('.parago-pl-button').click();
    expect(clicked).toBe(true);
  });

  it('removePlacementOverlay clears it', () => {
    showFinishing();
    removePlacementOverlay();
    expect(isPlacementOverlayShown()).toBe(false);
  });
});
