// ── Paymax Media — remote marketing banner hooks ─────────────────────────────

import { useQuery } from '@tanstack/react-query';
import { getBanner } from './api';

/**
 * Presign TTL on the server is 1h; refetch well before that so a screen left
 * open never re-renders with a URL that has already expired.
 */
const BANNER_STALE_MS = 30 * 60 * 1000;

export function useBanner(slug: string) {
  return useQuery({
    queryKey: ['media', 'banner', slug],
    queryFn: () => getBanner(slug),
    staleTime: BANNER_STALE_MS,
    gcTime: BANNER_STALE_MS,
    // Decorative art: one quiet retry, then give up. The screen renders fine
    // without it and must never show an error state for a banner.
    retry: 1,
  });
}
