import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ACCESS_CODE_COLUMNS,
  genNumericCode,
  getResidentContext,
  isUniqueViolation,
  isValidVisitorPhone,
  mapAccessCode,
  ruleToRecurrence,
  toDbCodeType,
} from '@/src/server/visitor/visitor.service';

// The caller's access codes (newest first).
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

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) {
      throw new ApiError(
        "You're not registered as a resident of any estate yet. Ask your estate manager to add you before you can invite visitors.",
        403,
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const visitorName = String(body?.visitorName ?? '').trim();
    if (!visitorName) throw new ApiError('Visitor name is required', 400);
    if (!body?.validityStart || !body?.validityEnd) throw new ApiError('Validity window is required', 400);
    const visitorPhone = String(body?.visitorPhone ?? '').trim();
    if (visitorPhone && !isValidVisitorPhone(visitorPhone)) {
      throw new ApiError('Visitor phone number is invalid', 400);
    }
    const validFrom = new Date(body.validityStart);
    const validUntil = new Date(body.validityEnd);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      throw new ApiError('Validity window must be valid ISO datetimes', 400);
    }
    if (validUntil <= validFrom) throw new ApiError('Validity end must be after the start', 400);
    if (validUntil <= new Date()) throw new ApiError('Cannot issue a pass for a window that has already ended', 400);

    const vehiclePlate = String(body?.vehiclePlate ?? '').trim().toUpperCase();

    // Watchlist check (EST-UAT-0100): a matching blacklist entry does not leak a
    // verdict to the resident — the code is still issued but flagged, so the
    // gate denies it and the review trail stays in visitor_blacklist.
    let blacklisted = false;
    const watchMatches: Array<{ kind: string; value: string }> = [];
    if (visitorPhone) watchMatches.push({ kind: 'phone', value: visitorPhone });
    if (vehiclePlate) watchMatches.push({ kind: 'plate', value: vehiclePlate });
    for (const m of watchMatches) {
      const { data: bl } = await supabase
        .from('visitor_blacklist')
        .select('id')
        .eq('estate_id', ctx.estateId)
        .eq('match_kind', m.kind)
        .eq('match_value', m.value)
        .maybeSingle();
      if (bl) {
        blacklisted = true;
        break;
      }
    }

    // uq_visitor_code_active (estate_id, numeric_code) WHERE status='active'
    // can collide on a 6-digit space — retry a fresh code like the Go service does.
    let created: any = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const { data, error } = await supabase
        .from('visitor_access_codes')
        .insert({
          estate_id: ctx.estateId,
          issued_by: user.id,
          visitor_name: visitorName,
          visitor_phone: visitorPhone || null,
          vehicle_plate: vehiclePlate || null,
          purpose: body?.purpose ?? null,
          code_type: toDbCodeType(String(body?.codeType ?? 'one_time')),
          numeric_code: genNumericCode(),
          valid_from: validFrom.toISOString(),
          valid_until: validUntil.toISOString(),
          recurrence: ruleToRecurrence(body?.recurrenceRule),
          max_uses: Math.max(1, Number(body?.maxEntries ?? 1) || 1),
          usage_mode: body?.usageMode === 'entry_exit' ? 'entry_exit' : 'one_time',
          party_size: Math.max(1, Number(body?.partySize ?? 1)),
          status: 'active',
          blacklisted,
        })
        .select(ACCESS_CODE_COLUMNS)
        .single();
      if (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
      created = data;
    }
    if (!created) throw new ApiError('Failed to issue a unique access code, try again', 500);

    return NextResponse.json(await mapAccessCode(supabase, created), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create access code');
  }
}
