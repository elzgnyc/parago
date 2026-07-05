import { getSettings, setSettings, DEFAULTS, resolveTimezone } from '../settings/storage.js';
import { setLang, t } from '../i18n/i18n.js';
import { CONFIG } from '../config.js';
import { shouldUseSupabase, resolveFunctionsBaseUrl } from '../relay/selectRelay.js';
import { SupabaseRelay } from '../relay/supabaseRelay.js';

// Inputs/selects driven by a generic change -> save listener.
const fields = [
  'lang', 'minStars', 'minRatings',
  'guardianLimit', 'guardianEmail', 'functionsBaseUrl', 'githubUsername', 'timezone',
];

// Fill the time-zone select with the browser's IANA zones (falls back to a short list
// on older browsers). The "Automatic" option (value '') shows the detected device zone.
function populateTimezones() {
  const sel = document.getElementById('timezone');
  if (!sel) return;
  let zones = [];
  try { zones = (Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) || []; } catch (e) { zones = []; }
  if (!zones.length) zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'];
  let detected = 'UTC';
  try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* keep UTC */ }
  const auto = sel.querySelector('option[value=""]');
  if (auto) auto.textContent = `${t('tz_auto')} (${detected})`;
  for (const z of zones) {
    const o = document.createElement('option');
    o.value = z; o.textContent = z;
    sel.appendChild(o);
  }
}
// Settings driven by segmented controls instead of inputs/selects.
const boolSegs = ['hideSponsored', 'flagLowRating', 'flagFewRatings', 'flagNonPrime', 'hoverReveal', 'devMode'];
const segKeys = ['deliveryMethod', 'guardianMode', 'mode', ...boolSegs];

const ICON_EMAIL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
const ICON_TG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9L18 6.1c.4-.3-.1-.5-.6-.2L7.2 12.3l-4.6-1.4c-1-.3-1-1 .2-1.5L20.6 2.7c.8-.3 1.6.2 1.3 1.6z"/></svg>';

// ── Segmented controls (bound to a setting) ──────────────────────────────────────
const segState = {};
function initSeg(key, opts) {
  const host = document.getElementById('seg-' + key);
  if (!host) return;
  host.textContent = '';
  host._btns = {};
  for (const o of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    if (o.icon) {
      const ic = document.createElement('span');
      ic.className = 'seg-ic';
      ic.innerHTML = o.icon; // trusted, local static SVG constants
      b.appendChild(ic);
    }
    b.appendChild(document.createTextNode(o.label));
    b.addEventListener('click', () => { setSeg(key, o.v); save(); });
    host.appendChild(b);
    host._btns[String(o.v)] = b;
  }
}
function setSeg(key, v) {
  segState[key] = v;
  const host = document.getElementById('seg-' + key);
  if (host && host._btns) for (const [val, b] of Object.entries(host._btns)) b.classList.toggle('is-active', val === String(v));
}
function getSeg(key) { return segState[key]; }
function buildSegs() {
  initSeg('deliveryMethod', [
    { v: 'telegram', label: t('delivery_telegram'), icon: ICON_TG },
    { v: 'email', label: t('delivery_email'), icon: ICON_EMAIL },
  ]);
  initSeg('guardianMode', [
    { v: 'off', label: t('guardian_off') },
    { v: 'always', label: t('guardian_always_seg') },
    { v: 'over_limit', label: t('guardian_over_seg') },
  ]);
  initSeg('mode', [
    { v: 'grey', label: t('mode_grey_seg') },
    { v: 'hide', label: t('mode_hide_seg') },
    { v: 'off', label: t('mode_off_seg') },
  ]);
  for (const k of boolSegs) {
    // devMode reads better Off-first (it is a rarely-enabled, off-by-default control).
    const opts = k === 'devMode'
      ? [{ v: false, label: t('off') }, { v: true, label: t('on') }]
      : [{ v: true, label: t('on') }, { v: false, label: t('off') }];
    initSeg(k, opts);
  }
}

// ── Theme (light / dark / amoled) ────────────────────────────────────────────────
function applyTheme(theme) {
  const t = (theme === 'dark' || theme === 'amoled') ? theme : 'light';
  document.documentElement.setAttribute('data-theme', t);
}
// The header toggle cycles Light -> Dark -> AMOLED -> Light (tap Dark again for AMOLED).
function nextTheme(cur) {
  return cur === 'light' ? 'dark' : (cur === 'dark' ? 'amoled' : 'light');
}

// ── Detail level (Simple / Advanced) ─────────────────────────────────────────────
function applyAdvancedVisibility(advanced) {
  for (const el of document.querySelectorAll('[data-adv]')) el.hidden = !advanced;
  for (const b of document.querySelectorAll('.ui-mode-btn')) {
    b.classList.toggle('is-active', (b.getAttribute('data-mode') === 'advanced') === !!advanced);
  }
}

function applyMethodVisibility(method) {
  for (const el of document.querySelectorAll('[data-method]')) {
    el.hidden = el.getAttribute('data-method') !== method;
  }
  if (method === 'telegram') getSettings().then(renderTelegramState);
  else stopTgPoll();
  const tb = document.getElementById('testBtn');
  if (tb) tb.textContent = method === 'telegram' ? t('btn_test_tg') : t('btn_test_email');
}

function applyGuardianModeVisibility(mode) {
  const el = document.getElementById('guardianLimitField');
  if (el) el.hidden = mode !== 'over_limit';
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
  const body = document.getElementById('tgDetailsBody');
  if (body) body.textContent = settings.telegramName
    ? ('Connected to ' + settings.telegramName + '. Approval requests are sent to this Telegram chat.')
    : 'Approval requests are sent to this Telegram chat. Re-link to show which account is connected.';
}

function genLinkCode() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let tgPoll = null;
function stopTgPoll() { if (tgPoll) { clearInterval(tgPoll); tgPoll = null; } }
function tgStatus(msg) { const el = document.getElementById('tgLinkStatus'); if (el) el.textContent = msg; }

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
  return [...fields, ...segKeys].every((key) => JSON.stringify(s[key]) === JSON.stringify(DEFAULTS[key]));
}
function updateDirty() {
  document.getElementById('reset').hidden = settingsAreDefault(readForm());
}

// Put a dot next to each setting whose value differs from its default.
function markChanged() {
  const cur = readForm();
  const mark = (key, el) => {
    if (el) el.classList.toggle('is-changed', JSON.stringify(cur[key]) !== JSON.stringify(DEFAULTS[key]));
  };
  for (const key of ['guardianLimit', 'minStars', 'minRatings', 'guardianEmail', 'functionsBaseUrl', 'githubUsername', 'lang']) {
    const ctrl = document.getElementById(key);
    const field = ctrl && ctrl.closest('.field, .lang-row');
    mark(key, field && field.querySelector('label, .field-label'));
  }
  for (const key of segKeys) {
    const host = document.getElementById('seg-' + key);
    const field = host && host.closest('.field');
    mark(key, field && field.querySelector('.field-label, label'));
  }
}
function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  document.documentElement.lang = document.getElementById('lang').value;
}

// Show the full approval URL the entered GitHub username resolves to, so it is
// obvious only the username goes in the box (the server builds the rest).
function updateGithubPreview() {
  const el = document.getElementById('githubUrlPreview');
  if (!el) return;
  const user = document.getElementById('githubUsername').value.trim().replace(/^@/, '');
  el.textContent = `https://${user || 'your-username'}.github.io/parago/approve.html`;
  el.classList.toggle('is-placeholder', !user);
}

function load(settings) {
  document.getElementById('lang').value = settings.lang;
  document.getElementById('timezone').value = settings.timezone || '';
  document.getElementById('minStars').value = settings.minStars;
  document.getElementById('minRatings').value = settings.minRatings;
  document.getElementById('guardianLimit').value = settings.guardianLimit;
  document.getElementById('guardianEmail').value = settings.guardianEmail;
  document.getElementById('functionsBaseUrl').value = settings.functionsBaseUrl || '';
  document.getElementById('githubUsername').value = settings.githubUsername || '';
  updateGithubPreview();
  setSeg('deliveryMethod', settings.deliveryMethod || 'email');
  setSeg('guardianMode', settings.guardianMode);
  setSeg('mode', settings.mode);
  for (const k of boolSegs) setSeg(k, settings[k]);
  setLang(settings.lang);
  applyI18n();
  applyTheme(settings.theme);
  applyAdvancedVisibility(settings.advancedMode);
  applyMethodVisibility(settings.deliveryMethod || 'email');
  applyGuardianModeVisibility(settings.guardianMode);
  renderTelegramState(settings);
  renderStars(settings.minStars);
  updateDirty();
  markChanged();
}

function readForm() {
  const out = {
    lang: document.getElementById('lang').value,
    timezone: document.getElementById('timezone').value,
    minStars: toFinite(document.getElementById('minStars').value, DEFAULTS.minStars, 0, 5),
    minRatings: Math.round(toFinite(document.getElementById('minRatings').value, DEFAULTS.minRatings, 0, Infinity)),
    guardianLimit: Math.round(toFinite(document.getElementById('guardianLimit').value, DEFAULTS.guardianLimit, 0, Infinity)),
    guardianEmail: document.getElementById('guardianEmail').value.trim(),
    functionsBaseUrl: document.getElementById('functionsBaseUrl').value.trim(),
    githubUsername: document.getElementById('githubUsername').value.trim().replace(/^@/, ''),
    deliveryMethod: getSeg('deliveryMethod'),
    guardianMode: getSeg('guardianMode'),
    mode: getSeg('mode'),
  };
  for (const k of boolSegs) out[k] = getSeg(k);
  return out;
}

// Debounced: every change is persisted immediately; this only shows "Saved" once,
// after the user stops changing settings, so rapid clicks do not spam the bubble.
function flash() {
  clearTimeout(flash._debounce);
  flash._debounce = setTimeout(() => {
    const saved = document.getElementById('saved');
    saved.textContent = t('saved');
    saved.classList.add('show');
    clearTimeout(flash._hide);
    flash._hide = setTimeout(() => saved.classList.remove('show'), 2200);
  }, 800);
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
  setLang(patch.lang);
  applyI18n();
  flash();
  updateDirty();
  markChanged();
}

// Reset needs a second click to confirm.
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

// The real cart the checkout script stashed while on the Amazon cart page (selected
// items only). Read from Options so the test uses the actual cart, not a fake one.
function loadCartSnapshot() {
  return new Promise((resolve) => {
    try { chrome.storage.local.get({ parago_cart_snapshot: null }, (d) => resolve(d.parago_cart_snapshot || null)); }
    catch (e) { resolve(null); }
  });
}

// Fire a real test approval through the configured channel (email or Telegram) using
// the shopper's actual cart, so the whole flow can be checked from Settings.
async function sendTest() {
  const status = document.getElementById('testStatus');
  const settings = await getSettings();
  if (!shouldUseSupabase(settings, CONFIG)) { status.textContent = t('test_need_config'); return; }
  const snap = await loadCartSnapshot();
  if (!snap || !Array.isArray(snap.items) || !snap.items.length) { status.textContent = t('test_no_cart'); return; }
  const method = settings.deliveryMethod || 'email';
  const relay = new SupabaseRelay({
    baseUrl: resolveFunctionsBaseUrl(settings, CONFIG),
    guardianEmail: settings.guardianEmail,
    guardianName: settings.guardianName,
    deliveryMethod: method,
    telegramLinkCode: settings.telegramLinkCode || null,
    githubUsername: settings.githubUsername || null,
    timezone: resolveTimezone(settings),
  });
  status.textContent = t('test_sending');
  try {
    await relay.submitRequest({ total: snap.total, items: snap.items });
    status.textContent = method === 'telegram' ? t('test_sent_tg') : t('test_sent_email');
  } catch (e) {
    status.textContent = t('test_failed') + ' ' + ((e && e.message) || e);
  }
}

async function main() {
  const settings = await getSettings();
  setLang(settings.lang);
  buildStars();
  buildSegs();
  populateTimezones();
  load(settings);
  for (const id of fields) {
    document.getElementById(id).addEventListener('change', save);
  }
  document.getElementById('githubUsername').addEventListener('input', updateGithubPreview);
  document.getElementById('reset').addEventListener('click', resetDefaults);
  document.getElementById('tgLinkBtn').addEventListener('click', setupTelegramLink);
  document.getElementById('tgResetBtn').addEventListener('click', resetTelegramLink);
  document.getElementById('testBtn').addEventListener('click', sendTest);

  for (const b of document.querySelectorAll('.ui-mode-btn')) {
    b.addEventListener('click', async () => {
      const advanced = b.getAttribute('data-mode') === 'advanced';
      await setSettings({ advancedMode: advanced });
      applyAdvancedVisibility(advanced);
    });
  }

  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', async () => {
    const next = nextTheme(document.documentElement.getAttribute('data-theme') || 'light');
    applyTheme(next);
    await setSettings({ theme: next });
  });

  const tgc = document.getElementById('tgConnected');
  if (tgc) tgc.addEventListener('click', () => {
    const d = document.getElementById('tgDetails');
    const open = d.hidden;
    d.hidden = !open;
    tgc.setAttribute('aria-expanded', String(open));
  });
}

main();
