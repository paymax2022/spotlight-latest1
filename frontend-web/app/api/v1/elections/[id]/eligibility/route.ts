import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/elections/elections.service';

// GET /api/v1/elections/{id}/eligibility — VoterEligibility.
// Resident of the estate => eligible. (Payment-ineligibility, when the Payments
// module exposes a restriction status, should also be checked here.)
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
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
