import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        // API surface — never indexable.
        '/api/',
        // Admin console lives in frontend-admin (:3001); no admin pages ship
        // here, but keep the prefix disallowed in case one ever does.
        '/admin',
        // Auth / transactional flows (login + register stay crawlable — they
        // are the public entry points and are listed in the sitemap).
        '/auth/',
        '/forgot-password',
        '/verify-email',
        '/vote-callback',
        '/vote-link/',
        // User-private route families. Mirrors the auth gate in
        // src/middleware.ts (PROTECTED_PATTERNS) plus the dashboard, utility
        // receipts and Open Mic self-service areas, which hold per-user data.
        '/dashboard',
        '/user-dashboard',
        '/profile',
        '/my-applications',
        '/apply',
        '/contestant',
        '/film-academy',
        '/stem/contests',
        '/open-mic/dashboard',
        '/open-mic/profile',
        '/open-mic/*/apply',
        '/open-mic/*/enter',
        '/utility/receipt',
        // Error page.
        '/404',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
