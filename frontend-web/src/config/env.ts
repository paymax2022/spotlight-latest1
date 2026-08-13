const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080/api/v1';

export const env = {
  apiBaseUrl,
  // MapService proxy base. Derived from the API origin unless overridden.
  // The client ALWAYS talks to our backend here — never to a maps provider,
  // so provider API keys never reach the browser.
  mapsBaseUrl:
    process.env.NEXT_PUBLIC_MAPS_BASE_URL ||
    apiBaseUrl.replace(/\/api\/v1\/?$/, '') + '/api/finance/maps',
  // Old admin console, still serving routes the consolidated portal hasn't
  // absorbed yet (the /admin/[...slug] bridge page links here).
  legacyAdminBaseUrl: process.env.NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL || 'http://localhost:4028',
};
