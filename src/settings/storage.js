export const DEFAULTS = {
  minStars: 3.5,        // flag items rated below this
  minRatings: 5,        // flag items with this many ratings or fewer
  mode: 'grey',         // 'grey' | 'hide' | 'off'
  preferredMode: 'grey',// remembers grey-vs-hide so the popup power toggle can restore it after 'off'
  hideSponsored: true,
  flagLowRating: true,
  flagFewRatings: true,
  flagNonPrime: false,  // opt-in: flag items not eligible for Prime
  hoverReveal: true,
  guardianMode: 'off',  // 'off' | 'always' | 'over_limit'
  guardianLimit: 50,    // approval required above this total when over_limit
  guardianName: '',     // label for whoever approves
  deliveryMethod: 'email', // how the approver is reached: 'email' | 'telegram'. Per-method config below persists independently, so switching never clears the other.
  guardianEmail: '',    // email delivery: where approval emails are sent
  telegramLinkCode: '', // telegram delivery: opaque code this install generated; the guardian binds it by tapping the t.me deep link
  telegramLinked: false,// telegram delivery: true once the guardian completes linking
  telegramName: '',     // display name of the connected Telegram chat (shown in Options), filled at link time
  functionsBaseUrl: '', // Supabase Edge Functions URL for email approval; set in Options (not code). Blank = local popup approval. Not a secret (it is the public project URL).
  advancedMode: false,  // Options page detail level: false = Simple (hides advanced/developer controls)
  lang: 'en',           // 'en' | 'vi'
  devMode: false,       // show the on-page Developer test panel (no real purchases)
};

export function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (items) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve({ ...DEFAULTS });
        return;
      }
      resolve({ ...DEFAULTS, ...items });
    });
  });
}

export function setSettings(patch) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(patch, () => {
      void (chrome.runtime && chrome.runtime.lastError);
      resolve();
    });
  });
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') cb(changes);
  });
}
