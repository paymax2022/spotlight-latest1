import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { ACCESS_CODE_COLUMNS, genNumericCode, mapAccessCode } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/codes/event — bulk-create event-guest access codes.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const body = await request.json();
    const eventName = String(body?.eventName ?? '').trim();
    const guestCount = Math.max(1, Math.min(Number(body?.guestCount ?? 1), 500));
    const validFrom: string = body?.validFrom;
    const validUntil: string = body?.validUntil;
    const estateId: string = body?.estateId;

    if (!eventName) throw new ApiError('eventName is required', 400);
    if (!validFrom || !validUntil) throw new ApiError('validFrom and validUntil are required', 400);
    if (!estateId) throw new ApiError('estateId is required', 400);

    const inserts = Array.from({ length: guestCount }, (_, i) => ({
      estate_id: estateId,
      issued_by: user.id,
      visitor_name: `${eventName} Guest ${i + 1}`,
      code_type: 'event_guest',
      numeric_code: genNumericCode(),
      valid_from: validFrom,
      valid_until: validUntil,
      max_uses: 1,
      status: 'active',
      usage_mode: 'one_time',
      party_size: 1,
    }));

    const { data: rows, error } = await supabase
      .from('visitor_access_codes')
      .insert(inserts)
      .select(ACCESS_CODE_COLUMNS);
    if (error) throw error;

    const codes = await Promise.all((rows ?? []).map((r) => mapAccessCode(supabase, r)));
    return NextResponse.json({ eventName, codes }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create event codes');
  }
}
