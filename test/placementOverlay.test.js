// test/placementOverlay.test.js
import { describe, it, expect, afterEach } from 'vitest';
import {
  showProcessing, showFinishing, showConfirmed, showCouldNotComplete,
  showManualFallback, removePlacementOverlay, isPlacementOverlayShown,
} from '../src/content/placementOverlay.js';

afterEach(() => { removePlacementOverlay(); document.body.innerHTML = ''; });

describe('placementOverlay', () => {
  it('shows processing as a non-blocking corner toast, not the blocking card', () => {
    showProcessing();
    // Processing is informational ("you can close this page"), so it is a corner
    // toast, not the full-page blocking overlay the active-placement states use.
    expect(isPlacementOverlayShown()).toBe(false);
    expect(document.getElementById('parago-placement-toast')).not.toBeNull();
    expect(document.body.textContent).toContain('being processed');
  });

  it('switching from the processing toast to a blocking state clears the toast', () => {
    showProcessing();
    showConfirmed();
    expect(document.getElementById('parago-placement-toast')).toBeNull();
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
