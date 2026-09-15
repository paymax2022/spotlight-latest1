// ── Paymax Media — remote marketing banner types ─────────────────────────────

/** Descriptor returned by GET /api/media/banners/:slug. */
export type RemoteBannerDescriptor = {
  slug: string;
  /** Short-lived presigned Cloudflare R2 GET URL for the artwork. */
  url: string;
  width: number;
  height: number;
  /** width / height — used to reserve layout space before the image decodes. */
  aspectRatio: number;
  /** Alt text authored alongside the artwork, for screen readers. */
  alt: string;
  /** ISO timestamp at which `url` stops working. */
  expiresAt: string;
};
