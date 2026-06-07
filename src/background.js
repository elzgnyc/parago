// MV3 background service worker. Content scripts can't make host-permission'd
// cross-origin fetches in MV3, so the relay sends a message here and we fetch.
async function doFetch({ url, options }) {
  const res = await fetch(url, options || {});
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'parago_fetch') {
    doFetch(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, status: 0, body: null, error: String(e) }));
    return true; // keep the channel open for the async response
  }
  return false;
});
