// ── Paymax Media — remote marketing banner types ─────────────────────────────

/**
 * Descriptor returned by GET /api/media/banners/:slug. Two shapes, matching
 * the resolver's two backing stores:
 *  - Cloudinary (preferred): `cloudinaryPublicId` is set, `url`/`expiresAt`
 *    are absent — the client builds its own responsive delivery URL (see
 *    src/lib/cloudinary.ts) rather than being handed one fixed-size URL.
 *  - Cloudflare R2 (legacy): `url` is a short-lived presigned GET, `expiresAt`
 *    says when it stops working, `cloudinaryPublicId` is absent.
 */
export type RemoteBannerDescriptor = {
  slug: string;
  width: number;
  height: number;
  /** width / height — used to reserve layout space before the image decodes. */
  aspectRatio: number;
  /** Alt text authored alongside the artwork, for screen readers. */
  alt: string;
  cloudinaryPublicId?: string;
  /** Short-lived presigned Cloudflare R2 GET URL for the artwork (legacy banners only). */
  url?: string;
  /** ISO timestamp at which `url` stops working (legacy banners only). */
  expiresAt?: string;
};
