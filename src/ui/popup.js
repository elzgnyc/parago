import { getSettings, setSettings, onSettingsChanged } from '../settings/storage.js';
import { setLang, t } from '../i18n/i18n.js';
import { MockRelay } from '../relay/mockRelay.js';
import { nextModePatch } from '../lib/protectionToggle.js';
import { shouldUseSupabase } from '../relay/selectRelay.js';
import { CONFIG } from '../config.js';

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

// Reflect protection state on the header switch. "On" means the search filter is doing
// something (mode is not 'off'); the toggle controls the filter only, never guardian.
function renderPower(settings) {
  const on = settings.mode !== 'off';
  const el = document.getElementById('power');
  el.checked = on;
  el.setAttribute('aria-label', on ? t('popup_status_on') : t('popup_status_off'));
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = on ? t('popup_status_on') : t('popup_status_off');
    statusEl.classList.toggle('is-off', !on);
  }
}

// Flip the display mode between 'off' and the last non-off mode (see nextModePatch).
// preferredMode remembers grey-vs-hide so turning protection back on restores the choice.
async function togglePower() {
  await setSettings(nextModePatch(await getSettings()));
  renderPower(await getSettings());
}

function applyTheme(theme) {
  const t = (theme === 'dark' || theme === 'amoled') ? theme : 'light';
  document.documentElement.setAttribute('data-theme', t);
}

async function main() {
  const settings = await getSettings();
  setLang(settings.lang);
  applyTheme(settings.theme);
  document.documentElement.lang = settings.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  const power = document.getElementById('power');
  power.addEventListener('change', togglePower);
  renderPower(settings);
  // Reflect changes made elsewhere (e.g. the Options page) while the popup is open.
  onSettingsChanged(() => getSettings().then((s) => { renderPower(s); applyTheme(s.theme); }));
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // The local approve/reject list only makes sense for LOCAL (MockRelay) approval. With
  // email/Supabase approval the guardian decides by email, so a local "waiting" list here
  // is stale and confusing — keep the section hidden in that mode.
  if (!shouldUseSupabase(settings, CONFIG)) {
    const section = document.getElementById('pendingSection');
    if (section) section.hidden = false;
    await refresh();
    relay.onChange(() => refresh());
  } else {
    // Email/Supabase approval is configured: the guardian decides by email, so the local
    // MockRelay list is legacy. Prune any stale local requests so they can't reappear, and
    // leave the section hidden.
    try { chrome.storage.local.remove('parago_requests'); } catch (e) { /* no-op */ }
  }
}

main();
