import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ACCESS_CODE_COLUMNS,
  genNumericCode,
  getResidentContext,
  mapAccessCode,
  ruleToRecurrence,
  toDbCodeType,
} from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/codes — the caller's access codes (newest first).
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { data: rows, error } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('issued_by', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const result = await Promise.all((rows ?? []).map((r) => mapAccessCode(supabase, r)));
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to list access codes');
  }
}

// POST /api/v1/visitor/codes — create an access code.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const visitorName = String(body?.visitorName ?? '').trim();
    if (!visitorName) throw new ApiError('Visitor name is required', 400);
    if (!body?.validityStart || !body?.validityEnd) throw new ApiError('Validity window is required', 400);

    const { data: created, error } = await supabase
      .from('visitor_access_codes')
      .insert({
        estate_id: ctx.estateId,
        issued_by: user.id,
        visitor_name: visitorName,
        visitor_phone: body?.visitorPhone ?? null,
        vehicle_plate: body?.vehiclePlate ?? null,
        purpose: body?.purpose ?? null,
        code_type: toDbCodeType(String(body?.codeType ?? 'one_time')),
        numeric_code: genNumericCode(),
        valid_from: body.validityStart,
        valid_until: body.validityEnd,
        recurrence: ruleToRecurrence(body?.recurrenceRule),
        max_uses: Number(body?.maxEntries ?? 1),
        usage_mode: body?.usageMode === 'entry_exit' ? 'entry_exit' : 'one_time',
        party_size: Math.max(1, Number(body?.partySize ?? 1)),
        status: 'active',
      })
      .select(ACCESS_CODE_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json(await mapAccessCode(supabase, created), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create access code');
  }
}
