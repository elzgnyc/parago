// MV3 background service worker. Content scripts can't make host-permission'd
// cross-origin fetches in MV3, so the relay sends a message here and we fetch.
async function doFetch({ url, options }) {
  const res = await fetch(url, options || {});
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

// Exactly-once placement lock. Content scripts run per-tab and chrome.storage has
// no atomic compare-and-set, so two checkout tabs loading at once could both decide
// to place the same approved order. The service worker is a SINGLE instance with a
// serialized event loop, so a check-and-set here is atomic: the first tab to claim
// an order id wins, every later claim for that id is denied. The claim is held for
// the worker's lifetime (never released): a placed/failed order is terminal and is
// never re-claimed, and a brand-new checkout uses a fresh id.
const placementClaims = new Set();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'parago_fetch') {
    doFetch(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, status: 0, body: null, error: String(e) }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === 'parago_claim_placement' && msg.id) {
    const granted = !placementClaims.has(msg.id);
    if (granted) placementClaims.add(msg.id);
    sendResponse({ granted });
    return true;
  }
  return false;
});

// Persistent "running" indicator. A green badge on the toolbar icon on EVERY site,
// so Parago visibly shows it is active even when you are not on Amazon. The badge
// is a global action badge (no tabId), so it persists across pages and survives the
// service worker sleeping. It reflects whether any protection is on (search filter
// or guardian approval); when everything is off, the badge is cleared.
const BADGE_DEFAULTS = { mode: 'grey', guardianMode: 'off' };

function paragoIsActive(s) {
  return (s.mode && s.mode !== 'off') || (s.guardianMode && s.guardianMode !== 'off');
}

function updateBadge() {
  chrome.storage.sync.get(BADGE_DEFAULTS, (got) => {
    const s = (chrome.runtime && chrome.runtime.lastError) ? BADGE_DEFAULTS : got;
    if (paragoIsActive(s)) {
      chrome.action.setBadgeBackgroundColor({ color: '#1f8a4c' });
      if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' });
      chrome.action.setBadgeText({ text: '●' });
      chrome.action.setTitle({ title: 'Parago: protection on' });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'Parago: protection off' });
    }
  });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') updateBadge(); });
// Set it as soon as the service worker wakes.
updateBadge();
