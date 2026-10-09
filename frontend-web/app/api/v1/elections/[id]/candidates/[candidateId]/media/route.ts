import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// Returns the candidate's media gallery: profile photo + any campaign_media from
// the election's candidates JSONB array. No separate media table needed — the
// campaign_media field is a string[] stored on each candidate object.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; candidateId: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id, candidateId } = await context.params;
    // Non-UUID ids can never match elections.id — reject before the query so a
    // malformed id doesn't surface as a Postgres 22P02 → 500 for residents.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(id)) throw new ApiError('Invalid election ID', 400);

    const { data: election, error } = await supabase
      .from('elections')
      .select('id, estate_id, candidates')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!election || (election as any).estate_id !== ctx.estateId)
      throw new ApiError('Election not found', 404);

    const candidates: any[] = (election as any).candidates ?? [];
    const candidate = candidates.find((c: any) => c.id === candidateId);
    if (!candidate) throw new ApiError('Candidate not found', 404);

    // Return a normalised media array: profile photo first, then any extra
    // campaign_media URLs stored on the candidate JSON.
    const items: Array<{ kind: 'photo' | 'campaign'; url: string }> = [];
    if (candidate.photo_url) items.push({ kind: 'photo', url: candidate.photo_url });
    for (const url of candidate.campaign_media ?? []) {
      items.push({ kind: 'campaign', url });
    }

    return NextResponse.json({
      candidateId,
      candidateName: candidate.name ?? '',
      media: items,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load candidate media');
  }
}
