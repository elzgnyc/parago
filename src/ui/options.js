import { getSettings, setSettings, DEFAULTS } from '../settings/storage.js';
import { setLang, t } from '../i18n/i18n.js';

const fields = [
  'lang', 'minStars', 'minRatings', 'mode',
  'hideSponsored', 'flagLowRating', 'flagFewRatings', 'flagNonPrime', 'hoverReveal',
  'guardianMode', 'guardianLimit', 'guardianName', 'guardianEmail',
];

const SVGNS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
const STAR_GOLD = '#f6b01e';
const STAR_GRAY = '#d9cebd';

function toFinite(raw, fallback, min, max) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Build five SVG stars. Each star's fill is a horizontal gradient with a hard stop,
// so a fractional value (e.g. 3.5) renders a clean left-half-gold star.
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

    btn.addEventListener('click', () => {
      document.getElementById('minStars').value = String(i);
      renderStars(i);
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

// The reset control only appears once a setting differs from its default.
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
  document.getElementById('guardianName').value = settings.guardianName;
  document.getElementById('guardianEmail').value = settings.guardianEmail;
  setLang(settings.lang);
  applyI18n();
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
    guardianName: document.getElementById('guardianName').value,
    guardianEmail: document.getElementById('guardianEmail').value.trim(),
  };
}

function flash() {
  const saved = document.getElementById('saved');
  saved.textContent = t('saved');
  setTimeout(() => { saved.textContent = ''; }, 1500);
}

async function save() {
  const patch = readForm();
  await setSettings(patch);
  document.getElementById('minStars').value = patch.minStars;
  document.getElementById('minRatings').value = patch.minRatings;
  document.getElementById('guardianLimit').value = patch.guardianLimit;
  renderStars(patch.minStars);
  setLang(patch.lang);
  applyI18n();
  flash();
  updateDirty();
}

async function resetDefaults() {
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
}

main();
