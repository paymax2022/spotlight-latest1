/**
 * The origin that metadata (og:url, canonical, og:image, robots, sitemap) is
 * resolved against. An explicit NEXT_PUBLIC_SITE_URL always wins; otherwise a
 * dev server reports itself and only a production build assumes the public
 * domain, so previews never advertise spotlightng.com while running locally.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://www.spotlightng.com');
