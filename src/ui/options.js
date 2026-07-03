import { getSettings, setSettings, DEFAULTS } from '../settings/storage.js';
import { setLang, t } from '../i18n/i18n.js';
import { CONFIG } from '../config.js';
import { resolveFunctionsBaseUrl } from '../relay/selectRelay.js';

const fields = [
  'lang', 'minStars', 'minRatings', 'mode',
  'hideSponsored', 'flagLowRating', 'flagFewRatings', 'flagNonPrime', 'hoverReveal',
  'guardianMode', 'guardianLimit', 'deliveryMethod', 'guardianEmail', 'functionsBaseUrl',
  'devMode',
];

// ── Detail level (Simple / Advanced) ─────────────────────────────────────────────
// Advanced-only controls carry [data-adv]; Simple mode hides them so the page is not
// overwhelming. The choice persists (settings.advancedMode).
function applyAdvancedVisibility(advanced) {
  for (const el of document.querySelectorAll('[data-adv]')) el.hidden = !advanced;
  for (const b of document.querySelectorAll('.ui-mode-btn')) {
    b.classList.toggle('is-active', (b.getAttribute('data-mode') === 'advanced') === !!advanced);
  }
}

// Show only the fields for the selected delivery method; the others stay in the DOM
// (their stored values persist) but hidden, so swapping never clears the other method.
function applyMethodVisibility(method) {
  for (const el of document.querySelectorAll('[data-method]')) {
    el.hidden = el.getAttribute('data-method') !== method;
  }
  if (method === 'telegram') getSettings().then(renderTelegramState);
  else stopTgPoll();
}

// Spending limit only applies to the "only over a spending limit" mode.
function applyGuardianModeVisibility(mode) {
  const el = document.getElementById('guardianLimitField');
  if (el) el.hidden = mode !== 'over_limit';
}

// A plain-language, live example of what the selected approval mode does.
function updateGuardianExample() {
  const el = document.getElementById('guardianExample');
  if (!el) return;
  const mode = document.getElementById('guardianMode').value;
  const via = document.getElementById('deliveryMethod').value === 'telegram' ? t('via_telegram') : t('via_email');
  const limit = document.getElementById('guardianLimit').value || '0';
  if (mode === 'off') el.textContent = t('ex_off');
  else if (mode === 'always') el.textContent = t('ex_always').replace('{via}', via);
  else el.textContent = t('ex_over').replace('{limit}', limit).replace('{via}', via);
}

// ── Telegram: connected badge vs linking flow ─────────────────────────────────────
function renderTelegramState(settings) {
  const linked = !!settings.telegramLinked;
  const conn = document.getElementById('tgConnected');
  const flow = document.getElementById('tgLinkFlow');
  const details = document.getElementById('tgDetails');
  if (conn) conn.hidden = !linked;
  if (flow) flow.hidden = linked;
  if (!linked && details) details.hidden = true;
  const nameEl = document.getElementById('tgConnectedName');
  if (nameEl) nameEl.textContent = settings.telegramName ? (' · ' + settings.telegramName) : '';
}

function genLinkCode() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let tgPoll = null;
function stopTgPoll() { if (tgPoll) { clearInterval(tgPoll); tgPoll = null; } }
function tgStatus(msg) {
  const el = document.getElementById('tgLinkStatus');
  if (el) el.textContent = msg;
}

async function setupTelegramLink() {
  const settings = await getSettings();
  const base = resolveFunctionsBaseUrl(settings, CONFIG);
  if (!/^https?:\/\//i.test(base) || base.includes('<PROJECT_REF>')) { tgStatus(t('tg_need_backend')); return; }
  let code = settings.telegramLinkCode;
  if (!code) { code = genLinkCode(); await setSettings({ telegramLinkCode: code }); }

  tgStatus(t('tg_fetching'));
  let username = null;
  try {
    const r = await fetch(`${base}/telegram-webhook?action=info`);
    const j = await r.json();
    username = j && j.username;
  } catch (e) { /* handled below */ }
  if (!username) { tgStatus(t('tg_unreachable')); return; }

  const url = `https://t.me/${username}?start=${encodeURIComponent(code)}`;
  const a = document.getElementById('tgLinkUrl');
  if (a) { a.href = url; a.textContent = url; }
  const area = document.getElementById('tgLinkArea');
  if (area) area.hidden = false;
  tgStatus(t('tg_waiting'));

  // Poll link-status until the guardian taps Start, then stop. Bounded so an Options
  // tab left open never polls forever if they never connect.
  stopTgPoll();
  const startedAt = Date.now();
  tgPoll = setInterval(async () => {
    if (Date.now() - startedAt > 5 * 60 * 1000) { stopTgPoll(); tgStatus(t('tg_timeout')); return; }
    try {
      const r = await fetch(`${base}/telegram-webhook?action=link-status&code=${encodeURIComponent(code)}`);
      const j = await r.json();
      if (j && j.linked) {
        stopTgPoll();
        await setSettings({ telegramLinked: true, telegramName: (j && j.name) || '' });
        renderTelegramState(await getSettings());
      }
    } catch (e) { /* transient: keep polling */ }
  }, 3000);
}

// Rotate to a fresh link code and clear the linked flag so the approver can be
// re-linked on a different device. Shows the linking flow again.
async function resetTelegramLink() {
  stopTgPoll();
  await setSettings({ telegramLinkCode: '', telegramLinked: false, telegramName: '' });
  const a = document.getElementById('tgLinkUrl');
  if (a) { a.href = '#'; a.textContent = ''; }
  const area = document.getElementById('tgLinkArea');
  if (area) area.hidden = true;
  tgStatus('');
  renderTelegramState(await getSettings());
  await setupTelegramLink();
}

// ── Stars ─────────────────────────────────────────────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
const STAR_GOLD = '#f6b01e';
const STAR_GRAY = '#d9cebd';

function toFinite(raw, fallback, min, max) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Five SVG stars with a hard-stop gradient fill, so a fractional value renders a clean
// half star. Clicking the LEFT half of a star sets the half value (e.g. 3.5).
function buildStars() {
  const picker = document.getElementById('starPicker');
  if (!picker) return;
  picker.textContent = '';
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'star';
    btn.setAttribute('aria-label', i + (i === 1 ? ' star' : ' stars'));

    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');

    const defs = document.createElementNS(SVGNS, 'defs');
    const grad = document.createElementNS(SVGNS, 'linearGradient');
    grad.setAttribute('id', 'pg-star-' + i);
    const stop1 = document.createElementNS(SVGNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', STAR_GOLD);
    const stop2 = document.createElementNS(SVGNS, 'stop');
    stop2.setAttribute('offset', '0%');
    stop2.setAttribute('stop-color', STAR_GRAY);
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', STAR_PATH);
    path.setAttribute('fill', 'url(#pg-star-' + i + ')');

    svg.appendChild(defs);
    svg.appendChild(path);
    btn.appendChild(svg);

    btn.addEventListener('click', (e) => {
      const rect = btn.getBoundingClientRect();
      const val = (e.clientX - rect.left) < rect.width / 2 ? i - 0.5 : i;
      document.getElementById('minStars').value = String(val);
      renderStars(val);
      save();
    });
    picker.appendChild(btn);
  }
}

function renderStars(value) {
  const v = Number.isFinite(parseFloat(value)) ? parseFloat(value) : 0;
  for (let i = 1; i <= 5; i++) {
    let pct = 0;
    if (v >= i) pct = 100;
    else if (v > i - 1) pct = Math.round((v - (i - 1)) * 100);
    const grad = document.getElementById('pg-star-' + i);
    if (!grad) continue;
    const stops = grad.querySelectorAll('stop');
    if (stops.length >= 2) {
      stops[0].setAttribute('offset', pct + '%');
      stops[1].setAttribute('offset', pct + '%');
    }
  }
}

// ── Form ────────────────────────────────────────────────────────────────────────
function settingsAreDefault(s) {
  return fields.every((key) => JSON.stringify(s[key]) === JSON.stringify(DEFAULTS[key]));
}
function updateDirty() {
  document.getElementById('reset').hidden = settingsAreDefault(readForm());
}
function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  document.documentElement.lang = document.getElementById('lang').value;
}

function load(settings) {
  document.getElementById('lang').value = settings.lang;
  document.getElementById('minStars').value = settings.minStars;
  document.getElementById('minRatings').value = settings.minRatings;
  document.getElementById('mode').value = settings.mode;
  document.getElementById('hideSponsored').checked = settings.hideSponsored;
  document.getElementById('flagLowRating').checked = settings.flagLowRating;
  document.getElementById('flagFewRatings').checked = settings.flagFewRatings;
  document.getElementById('flagNonPrime').checked = settings.flagNonPrime;
  document.getElementById('hoverReveal').checked = settings.hoverReveal;
  document.getElementById('guardianMode').value = settings.guardianMode;
  document.getElementById('guardianLimit').value = settings.guardianLimit;
  document.getElementById('deliveryMethod').value = settings.deliveryMethod || 'email';
  document.getElementById('guardianEmail').value = settings.guardianEmail;
  document.getElementById('functionsBaseUrl').value = settings.functionsBaseUrl || '';
  document.getElementById('devMode').checked = settings.devMode;
  setLang(settings.lang);
  applyI18n();
  applyAdvancedVisibility(settings.advancedMode);
  applyMethodVisibility(settings.deliveryMethod || 'email');
  applyGuardianModeVisibility(settings.guardianMode);
  renderTelegramState(settings);
  updateGuardianExample();
  renderStars(settings.minStars);
  updateDirty();
}

function readForm() {
  return {
    lang: document.getElementById('lang').value,
    minStars: toFinite(document.getElementById('minStars').value, DEFAULTS.minStars, 0, 5),
    minRatings: Math.round(toFinite(document.getElementById('minRatings').value, DEFAULTS.minRatings, 0, Infinity)),
    mode: document.getElementById('mode').value,
    hideSponsored: document.getElementById('hideSponsored').checked,
    flagLowRating: document.getElementById('flagLowRating').checked,
    flagFewRatings: document.getElementById('flagFewRatings').checked,
    flagNonPrime: document.getElementById('flagNonPrime').checked,
    hoverReveal: document.getElementById('hoverReveal').checked,
    guardianMode: document.getElementById('guardianMode').value,
    guardianLimit: Math.round(toFinite(document.getElementById('guardianLimit').value, DEFAULTS.guardianLimit, 0, Infinity)),
    deliveryMethod: document.getElementById('deliveryMethod').value,
    guardianEmail: document.getElementById('guardianEmail').value.trim(),
    functionsBaseUrl: document.getElementById('functionsBaseUrl').value.trim(),
    devMode: document.getElementById('devMode').checked,
  };
}

// Flash a clear "Saved" confirmation on every change.
function flash() {
  const saved = document.getElementById('saved');
  saved.textContent = t('saved');
  saved.classList.remove('show');
  void saved.offsetWidth; // restart the animation
  saved.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => saved.classList.remove('show'), 1800);
}

async function save() {
  const patch = readForm();
  await setSettings(patch);
  document.getElementById('minStars').value = patch.minStars;
  document.getElementById('minRatings').value = patch.minRatings;
  document.getElementById('guardianLimit').value = patch.guardianLimit;
  renderStars(patch.minStars);
  applyMethodVisibility(patch.deliveryMethod);
  applyGuardianModeVisibility(patch.guardianMode);
  updateGuardianExample();
  setLang(patch.lang);
  applyI18n();
  flash();
  updateDirty();
}

// Reset needs a second click to confirm, so an accidental click never wipes settings.
let resetArmed = false;
let resetTimer = null;
function resetLabel(key) {
  const span = document.querySelector('#reset [data-i18n]');
  if (span) span.textContent = t(key);
}
async function resetDefaults() {
  const btn = document.getElementById('reset');
  if (!resetArmed) {
    resetArmed = true;
    btn.classList.add('is-armed');
    resetLabel('reset_confirm');
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { resetArmed = false; btn.classList.remove('is-armed'); resetLabel('reset_defaults'); }, 3000);
    return;
  }
  resetArmed = false;
  clearTimeout(resetTimer);
  btn.classList.remove('is-armed');
  resetLabel('reset_defaults');
  await setSettings({ ...DEFAULTS });
  load({ ...DEFAULTS });
  flash();
}

async function main() {
  buildStars();
  const settings = await getSettings();
  load(settings);
  for (const id of fields) {
    document.getElementById(id).addEventListener('change', save);
  }
  document.getElementById('reset').addEventListener('click', resetDefaults);
  document.getElementById('tgLinkBtn').addEventListener('click', setupTelegramLink);
  document.getElementById('tgResetBtn').addEventListener('click', resetTelegramLink);

  for (const b of document.querySelectorAll('.ui-mode-btn')) {
    b.addEventListener('click', async () => {
      const advanced = b.getAttribute('data-mode') === 'advanced';
      await setSettings({ advancedMode: advanced });
      applyAdvancedVisibility(advanced);
    });
  }

  const tgc = document.getElementById('tgConnected');
  if (tgc) tgc.addEventListener('click', () => {
    const d = document.getElementById('tgDetails');
    const open = d.hidden;
    d.hidden = !open;
    tgc.setAttribute('aria-expanded', String(open));
  });
}

main();
