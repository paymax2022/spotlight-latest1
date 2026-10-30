import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

// Whether the caller belongs to an estate at all.
//
// This is the one question the estate and visitor screens ask before showing
// any estate feature: every route under /api/v1/estate and /api/v1/visitor
// resolves an estate_residents row and refuses without one, so an account with
// no row has no estate features to enter. It is deliberately backed by the same
// getResidentContext the real handlers use (banned/soft-deleted rows excluded)
// rather than by the property context envelope, which is a switchable UI hint
// and in local development is mocked outright — a gate reading a mock can never
// lock, and a gate reading a hint is not an authorization decision.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json({ isResident: false });
    return NextResponse.json({
      isResident: true,
      estateId: ctx.estateId,
      unit: ctx.unit,
      role: ctx.role,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load estate membership');
  }
}
