import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';

type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

/**
 * Static public routes only — deliberately no DB/Supabase calls here so the
 * sitemap stays a cheap, cacheable route handler.
 *
 * Excluded on purpose:
 *  - private/gated routes (dashboard, user-dashboard, profile, my-applications,
 *    apply, contestant, film-academy, stem/contests, open-mic/{dashboard,profile},
 *    utility/receipt) — see app/robots.ts and src/middleware.ts;
 *  - transactional/auth flows (auth/*, forgot-password, verify-email,
 *    vote-callback, vote-link/[token]);
 *  - dynamic-only segments that aren't statically enumerable
 *    (/vote/[contestSlug]/[contestantSlug], /service-details/[slug]);
 *  - /404 and the legacy template/demo duplicates (index-*, index-*-page,
 *    homepage, *-carousel, news-standard, news-details, project-details,
 *    team-details) — lorem-ipsum/duplicate content, not for indexing.
 */
const ROUTES: Array<{ path: string; changeFrequency: ChangeFrequency; priority: number }> = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/voting', changeFrequency: 'daily', priority: 0.9 },
  { path: '/open-mic', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/open-mic-competition', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/contestants', changeFrequency: 'daily', priority: 0.8 },
  { path: '/login', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/register', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/academy', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/brand-activation', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.6 },
  { path: '/crowdfunding', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/earn', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/faq', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/government-partnerships', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/impact', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/institutional-partnerships', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/media', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/media-room', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/news', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/opportunities', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/partnerships', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/press', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/programs', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/project', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/restaurant', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/season-2', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/service', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/service-details', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/services', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/sponsor', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/sponsors-partners', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/spotlight-studios', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/stem', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/studios', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/talent-vault', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/team', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/utility', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/privacy-policy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms-and-conditions', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path === '/' ? '/' : path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
