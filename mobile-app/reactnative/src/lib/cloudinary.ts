// ── Cloudinary — responsive CDN URL builder ──────────────────────────────────
// Marketing banners live in Cloudinary under the SPOTLIGHT/Banners/ folder,
// uploaded out-of-band (no in-app upload flow yet — same precedent as the
// existing R2 banner map in frontend-web/app/api/media/banners/[slug]/route.ts).
// The server hands the client a FULL public ID (folder included, e.g.
// "SPOTLIGHT/Banners/banner-connect_epyebw") rather than a bare filename —
// Cloudinary public IDs are case-sensitive, so the folder path is never
// reconstructed client-side, only ever passed through verbatim. The actual
// delivery URL is built HERE so each device requests the width IT needs,
// never a fixed size everyone pays for regardless of screen.
import { useWindowDimensions } from 'react-native';

// The cloud name is public (it is part of every delivery URL), so a build that
// forgot it, or kept the env template's placeholder (CHANGE_ME /
// your-cloudinary-cloud-name), must still resolve to the real account — the
// failure mode otherwise is every banner 404ing and rendering as an empty frame.
const DEFAULT_CLOUD_NAME = 'paymax';
const rawCloudName = (process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '').trim();
const CLOUD_NAME =
  rawCloudName && !/change_me|your-cloudinary|^xxx/i.test(rawCloudName) ? rawCloudName : DEFAULT_CLOUD_NAME;

/**
 * Width buckets, narrowest to widest, matching the phone / large-phone /
 * desktop bands product asked for. A small FIXED set (not the viewport's
 * exact pixel width) matters for caching: every phone in the same bucket
 * requests the identical transformed URL, so Cloudinary's edge cache serves
 * it after the first device anywhere hits it, instead of minting a new
 * variant per unique width.
 */
const BANNER_WIDTH_BUCKETS = [480, 768, 960, 1280] as const;

/** Picks the smallest bucket that comfortably covers a given viewport width. */
export function bannerWidthForViewport(viewportWidth: number): number {
  for (const w of BANNER_WIDTH_BUCKETS) {
    if (viewportWidth <= w) return w;
  }
  return BANNER_WIDTH_BUCKETS[BANNER_WIDTH_BUCKETS.length - 1];
}

/** The bucketed banner width for the CURRENT window — re-evaluates on rotation/resize/web-resize. */
export function useBannerWidth(): number {
  const { width } = useWindowDimensions();
  return bannerWidthForViewport(width);
}

/**
 * Builds a responsive, auto-format/auto-quality Cloudinary delivery URL.
 * `f_auto` serves WebP/AVIF to clients that support it; `q_auto` picks the
 * smallest quality that looks unchanged, instead of one fixed quality for
 * every image. Cloudinary already sets long-lived, immutable cache headers
 * on a versioned delivery URL — the discipline that matters is on the
 * UPLOAD side: redesign a banner as a NEW public ID (or a new Cloudinary
 * version), never overwrite one in place, or every device already holding
 * the old cached bytes keeps showing stale artwork indefinitely.
 */
export function cloudinaryBannerUrl(publicId: string, width: number): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_${width}/${publicId}`;
}

/**
 * A tiny (20px-wide, heavily blurred) variant of the same asset — small
 * enough to decode almost instantly, so it can stand in as a placeholder
 * while the real image is still loading.
 */
export function cloudinaryBannerPlaceholderUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_20,e_blur:1000/${publicId}`;
}
