// src/content/placementOverlay.js
// A full-page blocking card used by the purgatory-hold flow. Blocking matters:
// after we intercept "Place your order", the real button is still on the page,
// so we cover it to prevent a second submit.
import { t } from '../i18n/i18n.js';

const OVERLAY_ID = 'parago-placement-overlay';

export function isPlacementOverlayShown() {
  return !!document.getElementById(OVERLAY_ID);
}

export function removePlacementOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
}

function render({ title, body, button, onButton }) {
  removePlacementOverlay();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'parago-pl-panel';

  const h = document.createElement('h2');
  h.className = 'parago-pl-title';
  h.textContent = title;
  panel.appendChild(h);

  if (body) {
    const p = document.createElement('p');
    p.className = 'parago-pl-body';
    p.textContent = body;
    panel.appendChild(p);
  }

  if (button && onButton) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'parago-pl-button';
    b.textContent = button;
    b.addEventListener('click', onButton);
    panel.appendChild(b);
  }

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return overlay;
}

export function showProcessing() {
  return render({ title: t('placement_processing_title'), body: t('placement_processing_body') });
}
export function showFinishing() {
  return render({ title: t('placement_finishing') });
}
export function showConfirmed() {
  return render({ title: t('placement_confirmed') });
}
export function showCouldNotComplete() {
  return render({ title: t('placement_failed') });
}
export function showManualFallback(onPlace) {
  return render({ title: t('placement_manual_title'), body: t('placement_manual_body'),
    button: t('placement_manual_button'), onButton: onPlace });
}
export function showOrderChanged(onReview) {
  return render({ title: t('placement_changed_title'), body: t('placement_changed_body'),
    button: t('placement_changed_button'), onButton: onReview });
}
