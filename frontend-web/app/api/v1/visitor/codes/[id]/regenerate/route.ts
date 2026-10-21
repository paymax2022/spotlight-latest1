import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ACCESS_CODE_COLUMNS,
  genNumericCode,
  isUniqueViolation,
  mapAccessCode,
} from '@/src/server/visitor/visitor.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Regenerate a code after a compromised share (EST-UAT-0084): the old numeric
// code and QR are invalidated immediately (status -> revoked, which also frees
// its numeric_code from the partial unique index) and a replacement with the
// same visitor/validity is issued. The revoked row remains in the resident's
// code list as the audit trail; the response carries regeneratedFromCodeId so
// the client can link the pair.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new ApiError('Invalid access code ID', 400);
    const supabase = createAdminClient();

    const { data: old } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (!old || (old as any).issued_by !== user.id) throw new ApiError('Access code not found', 404);
    if ((old as any).status !== 'active') {
      throw new ApiError('Only an active code can be regenerated', 409);
    }

    const { data: revoked, error: revokeErr } = await supabase
      .from('visitor_access_codes')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('status', 'active')
      .select('id');
    if (revokeErr) throw revokeErr;
    if (!(revoked ?? []).length) throw new ApiError('Access code is no longer active', 409);

    let created: any = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const { data, error } = await supabase
        .from('visitor_access_codes')
        .insert({
          estate_id: (old as any).estate_id,
          issued_by: user.id,
          visitor_name: (old as any).visitor_name,
          visitor_phone: (old as any).visitor_phone ?? null,
          vehicle_plate: (old as any).vehicle_plate ?? null,
          purpose: (old as any).purpose ?? null,
          code_type: (old as any).code_type,
          numeric_code: genNumericCode(),
          qr_code: randomUUID(),
          valid_from: (old as any).valid_from,
          valid_until: (old as any).valid_until,
          recurrence: (old as any).recurrence ?? null,
          used_count: 0,
          max_uses: (old as any).max_uses ?? 1,
          usage_mode: (old as any).usage_mode ?? 'one_time',
          party_size: (old as any).party_size ?? 1,
          status: 'active',
          blacklisted: (old as any).blacklisted ?? false,
        })
        .select(ACCESS_CODE_COLUMNS)
        .single();
      if (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
      created = data;
    }
    if (!created) {
      // The old code is already revoked — surface the partial state honestly.
      throw new ApiError('Old code revoked but replacement could not be issued; create a new invite', 500);
    }

    const mapped = await mapAccessCode(supabase, created);
    return NextResponse.json({ ...mapped, regeneratedFromCodeId: id }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to regenerate access code');
  }
}
