import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { mapPrizeRow, UNIQUE_VIOLATION } from './_shared';

// GET /api/admin/voting/contest-prizes?connectContestId=<uuid>
// Lists structured per-position prizes for a contest (CS-010), ordered by position.
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const connectContestId = searchParams.get('connectContestId');

    if (!connectContestId) {
      return errorResponse('connectContestId is required', 400);
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('contest_prizes')
      .select('*')
      .eq('connect_contest_id', connectContestId)
      .order('position', { ascending: true });

    if (error) return errorResponse(`Failed to load prizes: ${error.message}`, 500);

    return successResponse({ success: true, prizes: (data ?? []).map(mapPrizeRow) });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest prizes');
  }
}

// POST /api/admin/voting/contest-prizes
// Body: { connectContestId, position, prizeDescription, prizeValueKobo? }
// A duplicate position for the same contest is rejected with 409 — checked
// up front for a clean message, and also mapped from the DB's own unique
// constraint (UNIQUE(connect_contest_id, position)) in case of a race.
export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();

    if (typeof body.connectContestId !== 'string' || !body.connectContestId.trim()) {
      return errorResponse('connectContestId is required', 400);
    }
    if (!Number.isInteger(body.position) || body.position <= 0) {
      return errorResponse('position must be a positive integer', 400);
    }
    if (typeof body.prizeDescription !== 'string' || !body.prizeDescription.trim()) {
      return errorResponse('prizeDescription is required', 400);
    }
    if (
      body.prizeValueKobo !== undefined &&
      body.prizeValueKobo !== null &&
      (!Number.isInteger(body.prizeValueKobo) || body.prizeValueKobo < 0)
    ) {
      return errorResponse('prizeValueKobo must be a non-negative integer (kobo)', 400);
    }

    const supabase = createAdminClient();

    const { data: existing } = await supabase
      .from('contest_prizes')
      .select('id')
      .eq('connect_contest_id', body.connectContestId)
      .eq('position', body.position)
      .maybeSingle();

    if (existing) {
      return errorResponse(`A prize already exists for position ${body.position} on this contest`, 409);
    }

    const { data: inserted, error } = await supabase
      .from('contest_prizes')
      .insert({
        connect_contest_id: body.connectContestId,
        position: body.position,
        prize_description: body.prizeDescription.trim(),
        prize_value_kobo: body.prizeValueKobo ?? null,
        created_by: identity.actorId || null,
      })
      .select('*')
      .single();

    if (error) {
      if ((error as any).code === UNIQUE_VIOLATION) {
        return errorResponse(`A prize already exists for position ${body.position} on this contest`, 409);
      }
      return errorResponse(`Failed to create prize: ${error.message}`, 500);
    }

    return successResponse({ success: true, prize: mapPrizeRow(inserted) }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create contest prize');
  }
}
