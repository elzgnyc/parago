import { getSettings } from '../settings/storage.js';
import { setLang, t } from '../i18n/i18n.js';
import { MockRelay } from '../relay/mockRelay.js';

const relay = new MockRelay();

function fmtTotal(total) {
  return total == null ? '' : Number(total).toFixed(2);
}

function renderPending(list) {
  const container = document.getElementById('pending');
  container.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'pending-empty';
    p.textContent = t('pending_none');
    container.appendChild(p);
    return;
  }
  for (const req of list) {
    const card = document.createElement('div');
    card.className = 'pending-item';

    const summary = document.createElement('p');
    const totalStr = fmtTotal(req.total);
    const titles = (req.items || []).map((i) => i.title).filter(Boolean).slice(0, 5).join(', ');
    const parts = [];
    if (totalStr) parts.push(t('guardian_total_label') + ': ' + totalStr);
    if (titles) parts.push(titles);
    summary.textContent = parts.join('  -  ');
    card.appendChild(summary);

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'btn btn-approve';
    approve.textContent = t('approve');
    approve.addEventListener('click', () => relay.decide(req.id, 'approved'));
    card.appendChild(approve);

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'btn btn-reject';
    reject.textContent = t('reject');
    reject.addEventListener('click', () => relay.decide(req.id, 'rejected'));
    card.appendChild(reject);

    container.appendChild(card);
  }
}

async function refresh() {
  renderPending(await relay.listPending());
}

async function main() {
  const settings = await getSettings();
  setLang(settings.lang);
  document.documentElement.lang = settings.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  const on = settings.mode !== 'off';
  const statusEl = document.getElementById('status');
  statusEl.textContent = on ? t('popup_status_on') : t('popup_status_off');
  statusEl.classList.toggle('is-off', !on);
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  await refresh();
  relay.onChange(() => refresh());
}

main();
