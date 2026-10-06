import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// VoterEligibility.
// module exposes a restriction status, should also be checked here.)
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match elections.id — reject before the query so a
    // malformed id doesn't surface as a Postgres 22P02 → 500 for residents.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json({ eligible: false, reason: 'You are not a resident of this estate.' });

    const { data: row } = await supabase.from('elections').select('estate_id').eq('id', id).maybeSingle();
    if (!row || (row as any).estate_id !== ctx.estateId) {
      return NextResponse.json({ eligible: false, reason: 'This election is not for your estate.' });
    }
    return NextResponse.json({ eligible: true });
  } catch (error) {
    return handleApiError(error, 'Failed to check eligibility');
  }
}
