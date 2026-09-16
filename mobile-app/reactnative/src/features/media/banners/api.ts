// ── Paymax Media — remote marketing banner API ───────────────────────────────
// Marketing banners are stored in Cloudflare R2 and served through the gateway's
// slug-whitelisted resolver, which mints a short-lived presigned GET. The client
// never holds an object key, a bucket name or a credential — only a slug.

import { api } from '@/api/client';
import type { RemoteBannerDescriptor } from './types';

export async function getBanner(slug: string): Promise<RemoteBannerDescriptor> {
  // skipAuthRedirect: a banner is decorative. Without this, a 401 on this
  // background read would sign the user out through the global interceptor —
  // losing a session over a picture.
  const { data } = await api.get<RemoteBannerDescriptor>(`/api/media/banners/${slug}`, {
    skipAuthRedirect: true,
  });
  return data;
}
