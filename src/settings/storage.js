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
  guardianEmail: '',    // where approval emails are sent (required for remote approval)
  functionsBaseUrl: '', // Supabase Edge Functions URL for email approval; set in Options (not code). Blank = local popup approval. Not a secret (it is the public project URL).
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
