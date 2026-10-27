import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS } from '@/src/server/visitor/visitor.service';

// Approve a visitor check-in.
//
// Admission is enforced server-side, not just in the app's lookup screen:
// the code must be active, inside its validity window, under max_uses, not
// blacklisted (per-code flag or the estate watchlist on phone/plate), and its
// issuer must still be an active member of the estate. Consumption is an
// atomic compare-and-swap on (status, used_count) so two guards scanning the
// same one-time code concurrently admit exactly one visitor.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id, { forWrite: true });
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const accessCodeId: string = body?.accessCodeId;
    const visitorName: string = String(body?.visitorName ?? '').trim();
    const unitLabel: string = String(body?.unitLabel ?? '').trim();
    const gateId: string = body?.gateId ?? guard.gateId;
    const plate: string | null = body?.plate ?? null;

    if (!accessCodeId) throw new ApiError('accessCodeId is required', 400);

    const { data: code, error: codeErr } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('id', accessCodeId)
      .eq('estate_id', guard.estateId)
      .maybeSingle();
    if (codeErr) throw codeErr;
    if (!code) throw new ApiError('Access code not found', 404);

    const now = new Date();
    if ((code as any).status !== 'active') {
      throw new ApiError(`Access code is ${(code as any).status}`, 409);
    }
    if (new Date((code as any).valid_from) > now) throw new ApiError('Access code is not yet valid', 409);
    if (new Date((code as any).valid_until) <= now) throw new ApiError('Access code has expired', 409);
    if ((code as any).used_count >= (code as any).max_uses) {
      throw new ApiError('Access code has reached maximum uses', 409);
    }
    if ((code as any).blacklisted) throw new ApiError('Visitor is blacklisted', 403);

    // Estate watchlist on the visitor's phone/plate (per-code flag checked above).
    const watchMatches: Array<{ kind: string; value: string }> = [];
    if ((code as any).visitor_phone) watchMatches.push({ kind: 'phone', value: (code as any).visitor_phone });
    const effectivePlate = plate ?? (code as any).vehicle_plate;
    if (effectivePlate) watchMatches.push({ kind: 'plate', value: effectivePlate });
    for (const m of watchMatches) {
      const { data: bl } = await supabase
        .from('visitor_blacklist')
        .select('id')
        .eq('estate_id', guard.estateId)
        .eq('match_kind', m.kind)
        .eq('match_value', m.value)
        .maybeSingle();
      if (bl) throw new ApiError('Visitor is blacklisted', 403);
    }

    // A code whose issuer moved out or was banned no longer admits (EST-UAT-0098).
    const { data: issuer, error: issuerErr } = await supabase
      .from('estate_residents')
      .select('unit')
      .eq('estate_id', guard.estateId)
      .eq('user_id', (code as any).issued_by)
      .is('deleted_at', null)
      .is('banned_at', null)
      .maybeSingle();
    if (issuerErr) throw issuerErr;
    if (!issuer) throw new ApiError('Host is no longer an active member of this estate', 409);

    // Atomic consumption claim: only one concurrent approve can flip
    // (status='active', used_count=N) -> (used_count=N+1). A second scanner
    // sees zero updated rows and is denied (EST-UAT-0094).
    const used = (code as any).used_count ?? 0;
    const maxUses = Math.max(1, (code as any).max_uses ?? 1);
    const newUsed = used + 1;
    const { data: claimed, error: claimErr } = await supabase
      .from('visitor_access_codes')
      .update({
        used_count: newUsed,
        status: newUsed >= maxUses ? 'used' : 'active',
      })
      .eq('id', accessCodeId)
      .eq('estate_id', guard.estateId)
      .eq('status', 'active')
      .eq('used_count', used)
      .select('id');
    if (claimErr) throw claimErr;
    if (!(claimed ?? []).length) {
      throw new ApiError('Access code is no longer valid (already used or revoked)', 409);
    }

    const { data: evt, error: evtErr } = await supabase
      .from('visitor_gate_events')
      .insert({
        estate_id: guard.estateId,
        access_code_id: accessCodeId,
        visitor_name: visitorName || (code as any).visitor_name,
        unit_label: unitLabel || (issuer as any)?.unit || '',
        gate_id: gateId,
        guard_id: user.id,
        action: 'check_in',
        captured_plate: plate,
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) {
      // The claim succeeded but the event did not — roll the consumption back so
      // a retry is not denied as "already used". Best-effort CAS restore.
      await supabase
        .from('visitor_access_codes')
        .update({ used_count: used, status: (code as any).status })
        .eq('id', accessCodeId)
        .eq('used_count', newUsed);
      throw evtErr;
    }

    await supabase.from('visitor_notifications').insert({
      estate_id: guard.estateId,
      user_id: (code as any).issued_by,
      type: 'checked_in',
      title: 'Visitor Checked In',
      body: `${visitorName || ((code as any).visitor_name ?? 'Your visitor')} has been checked in.`,
      access_code_id: accessCodeId,
      read: false,
    });

    return NextResponse.json(mapGateEvent(evt));
  } catch (error) {
    return handleApiError(error, 'Failed to approve visitor');
  }
}
