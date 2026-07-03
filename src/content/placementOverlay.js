// src/content/placementOverlay.js
// A full-page blocking card used by the purgatory-hold flow. Blocking matters:
// after we intercept "Place your order", the real button is still on the page,
// so we cover it to prevent a second submit.
import { t } from '../i18n/i18n.js';

const OVERLAY_ID = 'parago-placement-overlay';
const TOAST_ID = 'parago-placement-toast';

export function isPlacementOverlayShown() {
  return !!document.getElementById(OVERLAY_ID);
}

export function removePlacementOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
  const toast = document.getElementById(TOAST_ID);
  if (toast) toast.remove();
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

// Processing is the one terminal, informational placement state ("All set... you
// can close this page"). Unlike the active finishing/confirmed/manual/changed
// screens, it does not need to block a second submit, so it shows as a small,
// non-blocking corner toast instead of a full-page card.
export function showProcessing() {
  removePlacementOverlay();
  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  const title = document.createElement('div');
  title.className = 'parago-pl-toast-title';
  title.textContent = t('placement_processing_title');
  toast.appendChild(title);
  const bodyText = t('placement_processing_body');
  if (bodyText) {
    const b = document.createElement('div');
    b.className = 'parago-pl-toast-body';
    b.textContent = bodyText;
    toast.appendChild(b);
  }
  document.body.appendChild(toast);
  return toast;
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
