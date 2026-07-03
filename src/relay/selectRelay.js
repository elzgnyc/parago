// Resolve the Supabase Edge Functions base URL. The in-extension Options field
// (settings.functionsBaseUrl) wins, so a machine is pointed at a project from the
// UI without editing code or rebuilding; the baked config.js value is only the
// fallback default. Trailing slashes are trimmed so callers append '/create-request'.
export function resolveFunctionsBaseUrl(settings, config) {
  const fromSettings = settings && typeof settings.functionsBaseUrl === 'string' && settings.functionsBaseUrl.trim();
  const fromConfig = config && config.functionsBaseUrl;
  return String(fromSettings || fromConfig || '').replace(/\/+$/, '');
}

// Use the remote (email) relay only when we can actually send: a usable https
// functions base URL is configured AND the user provided a guardian email.
// Otherwise fall back to MockRelay (local popup approval) so the feature degrades
// gracefully. A malformed URL (e.g. a typo pasted into Options) also fails safe
// here rather than reaching fetch, keeping the checkout gate fail-closed.
export function shouldUseSupabase(settings, config) {
  const base = resolveFunctionsBaseUrl(settings, config);
  if (!/^https?:\/\//i.test(base) || base.includes('<PROJECT_REF>')) return false;
  return !!(settings && settings.guardianEmail && settings.guardianEmail.trim());
}
