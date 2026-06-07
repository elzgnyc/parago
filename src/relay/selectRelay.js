// Use the remote (email) relay only when we can actually send: a real functions
// base URL is configured AND the user provided a guardian email. Otherwise fall
// back to MockRelay (local popup approval), so the feature degrades gracefully.
export function shouldUseSupabase(settings, config) {
  const base = config && config.functionsBaseUrl;
  if (!base || base.includes('<PROJECT_REF>')) return false;
  return !!(settings && settings.guardianEmail && settings.guardianEmail.trim());
}
