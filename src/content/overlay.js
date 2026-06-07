import { t } from '../i18n/i18n.js';

const OVERLAY_ID = 'parago-guardian-overlay';

function fmtTotal(total) {
  if (total == null || Number.isNaN(total)) return '';
  return Number(total).toFixed(2);
}

function buildItemsList(items) {
  const ul = document.createElement('ul');
  ul.className = 'parago-go-items';
  for (const it of (items || []).slice(0, 12)) {
    const li = document.createElement('li');
    li.textContent = it.title || '';
    ul.appendChild(li);
  }
  return ul;
}

export function isOverlayShown() {
  return !!document.getElementById(OVERLAY_ID);
}

export function removeOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
}

export function setOverlayStatus(status) {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;
  overlay.dataset.status = status;
  const statusEl = overlay.querySelector('.parago-go-status');
  if (!statusEl) return;
  if (status === 'approved') statusEl.textContent = t('guardian_approved');
  else if (status === 'rejected') statusEl.textContent = t('guardian_rejected');
  else if (status === 'error') statusEl.textContent = t('guardian_error');
  else statusEl.textContent = '';
}

// Full-screen blocking overlay shown on the cart/checkout pages while approval is pending.
// Covers the viewport and captures pointer events, so the underlying page cannot be used.
export function showOverlay({ items, total, guardianName, status = 'pending', onCancel } = {}) {
  removeOverlay();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'parago-go-panel';

  const title = document.createElement('h2');
  title.className = 'parago-go-title';
  title.textContent = t('guardian_waiting_title');
  panel.appendChild(title);

  if (guardianName) {
    const who = document.createElement('p');
    who.className = 'parago-go-who';
    who.textContent = t('guardian_for') + ': ' + guardianName;
    panel.appendChild(who);
  }

  const body = document.createElement('p');
  body.textContent = t('guardian_waiting_body');
  panel.appendChild(body);

  if (items && items.length) panel.appendChild(buildItemsList(items));

  const totalStr = fmtTotal(total);
  if (totalStr) {
    const totalEl = document.createElement('p');
    totalEl.className = 'parago-go-total';
    totalEl.textContent = t('guardian_total_label') + ': ' + totalStr;
    panel.appendChild(totalEl);
  }

  const statusEl = document.createElement('p');
  statusEl.className = 'parago-go-status';
  statusEl.setAttribute('aria-live', 'polite');
  panel.appendChild(statusEl);

  if (onCancel) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'parago-go-cancel';
    cancel.textContent = t('guardian_cancel');
    cancel.addEventListener('click', onCancel);
    panel.appendChild(cancel);
  }

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  setOverlayStatus(status);
  return overlay;
}
