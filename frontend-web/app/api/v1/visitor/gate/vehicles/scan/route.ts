import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/gate/vehicles/scan — stub ANPR/OCR plate scan.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json();
    const plate: string = String(body?.plate ?? '').trim().toUpperCase();
    if (!plate) throw new ApiError('plate is required', 400);

    // Check blacklist for plate match.
    const { data: blRow } = await supabase
      .from('visitor_blacklist')
      .select('id')
      .eq('estate_id', guard.estateId)
      .eq('match_kind', 'plate')
      .eq('match_value', plate)
      .maybeSingle();

    // Check access codes for matching vehicle_plate (if column exists).
    let matchedCode: any = null;
    const { data: codeRow } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('estate_id', guard.estateId)
      .eq('vehicle_plate', plate)
      .eq('status', 'active')
      .maybeSingle();
    if (codeRow) {
      matchedCode = await mapAccessCode(supabase, codeRow);
    }

    return NextResponse.json({ plate, blacklisted: Boolean(blRow), matchedCode });
  } catch (error) {
    return handleApiError(error, 'Failed to scan plate');
  }
}
