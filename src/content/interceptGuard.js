// One-shot suppression flag shared between the place-order click interceptor
// (checkout.js) and our own programmatic placement (placementManager.js).
//
// When placementManager places an approved order it calls clickPlaceOrder(), which
// dispatches a real click. Without this, the capture-phase interceptor would catch
// that click, treat it as a fresh purchase, block it, and submit a DUPLICATE
// approval request. Before any programmatic click we set the flag; the interceptor
// consumes it once and lets that single click through.
let suppress = false;

export function suppressNextPlace() { suppress = true; }

export function consumeSuppress() {
  if (suppress) { suppress = false; return true; }
  return false;
}

// Test-only: clear the flag between tests.
export function _resetSuppress() { suppress = false; }
