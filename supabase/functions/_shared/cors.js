// Permissive CORS for these uncredentialed public functions. The extension's
// background worker calls them cross-origin; no cookies/credentials are used.
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
export function preflight(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  return null;
}
