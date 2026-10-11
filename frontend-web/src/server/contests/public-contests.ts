import { createAdminClient } from '@/lib/supabase/server';
import type { ContestFilter, PublicContest } from '@/src/lib/contests/contest-filter';

export { filterContests } from '@/src/lib/contests/contest-filter';
export type { ContestFilter, PublicContest } from '@/src/lib/contests/contest-filter';

// Public list of contests for the website (talent-vault "Live Contests").
//
// This replaces a fetch of the Go backend's /api/v1/public/contests, a route that
// does not exist (it was reverted after a staging crash-loop), which left the
// grid permanently empty. It reads connect_contests directly on the server: the
// same table the mobile app's contest list is served from, so web and phone show
// the same contests. Server-only; the service-role client never reaches a browser.

const LIST_LIMIT = 60;

function toStatus(raw: unknown): ContestFilter | null {
  if (raw === 'open') return 'active';
  if (raw === 'closed') return 'closed';
  return null;
}

export async function getPublicContests(): Promise<PublicContest[]> {
  try {
    const { data, error } = await createAdminClient()
      .from('connect_contests')
      .select('id, slug, title, description, status, opens_at, closes_at, banner_image_url, logo_url')
      .in('status', ['open', 'closed'])
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) throw new Error(error.message);

    const out: PublicContest[] = [];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const status = toStatus(row.status);
      if (!status) continue;
      out.push({
        id: String(row.id),
        slug: String(row.slug ?? ''),
        title: String(row.title ?? ''),
        description: String(row.description ?? ''),
        status,
        opensAt: (row.opens_at as string | null) ?? null,
        closesAt: (row.closes_at as string | null) ?? null,
        bannerImageUrl: String(row.banner_image_url ?? ''),
        logoUrl: String(row.logo_url ?? ''),
      });
    }
    return out;
  } catch (err) {
    // The page is marketing content; a failed read renders the empty state
    // rather than taking the whole page down.
    console.error('[public-contests] read failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
