import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission, type AdminIdentity } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { createAdminClient } from '@/lib/supabase/server';

// Per-area tuition options (schedule x boarding). Prices are WHOLE NAIRA
// integers (bigint columns) and are the source of truth the apply endpoint
// resolves server-side — editing one changes what the next applicant pays.
// There is deliberately no DELETE: applications snapshot the option they chose,
// so retire an option with is_active=false instead.
// academy_area_options has no updated_at trigger, so PUT sets it explicitly.

const PERMISSION = 'programs:manage';
const COLUMNS =
  'id, area_id, label, duration_label, price_no_boarding_ngn, price_with_boarding_ngn, is_active, sort_order, created_at, updated_at';

interface OptionBody {
  id?: string;
  area_id?: string;
  label?: unknown;
  duration_label?: unknown;
  price_no_boarding_ngn?: unknown;
  price_with_boarding_ngn?: unknown;
  is_active?: unknown;
  sort_order?: unknown;
}

function isWholeNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function logDbError(where: string, error: unknown): void {
  const e = error as { message?: string; code?: string; details?: string; hint?: string } | null;
  console.error(`[admin/academy/area-options] ${where} failed`, {
    code: e?.code,
    message: e?.message,
    details: e?.details,
    hint: e?.hint,
  });
}

function audit(request: Request, identity: AdminIdentity, action: string, entityId: string | undefined, oldValue: unknown, newValue: unknown) {
  addAuditEvent({
    adminUser: identity.actorId,
    role: identity.role,
    action,
    module: 'academy',
    entityType: 'academy_area_options',
    entityId,
    oldValue,
    newValue,
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined,
  });
}

const BOARDING_RULE_MSG = 'price_with_boarding_ngn cannot be lower than price_no_boarding_ngn';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const areaId = new URL(request.url).searchParams.get('area_id')?.trim();
    if (!areaId) return errorResponse('area_id is required', 400);

    const supabase = createAdminClient();
    // Inactive options are included so an admin can re-enable what they retired.
    const { data, error } = await supabase
      .from('academy_area_options')
      .select(COLUMNS)
      .eq('area_id', areaId)
      .order('sort_order', { ascending: true });
    if (error) {
      logDbError('GET', error);
      return errorResponse('Failed to load area options', 500);
    }
    return successResponse({ success: true, options: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load area options');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as OptionBody | null;
    if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body', 400);

    const areaId = typeof body.area_id === 'string' ? body.area_id.trim() : '';
    if (!areaId) return errorResponse('area_id is required', 400);
    if (typeof body.label !== 'string' || !body.label.trim()) return errorResponse('Label is required', 400);
    if (!isWholeNonNegative(body.price_no_boarding_ngn)) {
      return errorResponse('price_no_boarding_ngn must be a whole number of naira, zero or more', 400);
    }
    const withBoarding = body.price_with_boarding_ngn ?? null;
    if (withBoarding !== null && !isWholeNonNegative(withBoarding)) {
      return errorResponse('price_with_boarding_ngn must be null or a whole number of naira, zero or more', 400);
    }
    if (withBoarding !== null && withBoarding < body.price_no_boarding_ngn) {
      return errorResponse(BOARDING_RULE_MSG, 400);
    }
    const duration = body.duration_label ?? null;
    if (duration !== null && typeof duration !== 'string') return errorResponse('duration_label must be a string or null', 400);
    const sortOrder = body.sort_order ?? 0;
    if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)) return errorResponse('sort_order must be an integer', 400);
    const isActive = body.is_active ?? true;
    if (typeof isActive !== 'boolean') return errorResponse('is_active must be a boolean', 400);

    const supabase = createAdminClient();
    const { data: area, error: areaErr } = await supabase
      .from('academy_interest_areas')
      .select('id')
      .eq('id', areaId)
      .maybeSingle();
    if (areaErr) {
      logDbError('POST area lookup', areaErr);
      return errorResponse('Failed to create the area option', 500);
    }
    if (!area) return errorResponse('Area of interest not found', 404);

    const { data, error } = await supabase
      .from('academy_area_options')
      .insert({
        area_id: areaId,
        label: body.label.trim(),
        duration_label: duration,
        price_no_boarding_ngn: body.price_no_boarding_ngn,
        price_with_boarding_ngn: withBoarding,
        is_active: isActive,
        sort_order: sortOrder,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      logDbError('POST', error);
      return errorResponse('Failed to create the area option', 500);
    }

    audit(request, identity, 'academy.area_option.create', (data as { id?: string } | null)?.id, undefined, data);
    return successResponse({ success: true, option: data });
  } catch (error) {
    return handleApiError(error, 'Failed to create the area option');
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as OptionBody | null;
    if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body', 400);
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return errorResponse('id is required', 400);

    // area_id is deliberately not updatable: applications snapshot (area, option).
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.label !== undefined) {
      if (typeof body.label !== 'string' || !body.label.trim()) return errorResponse('Label cannot be empty', 400);
      patch.label = body.label.trim();
    }
    if (body.duration_label !== undefined) {
      if (body.duration_label !== null && typeof body.duration_label !== 'string') {
        return errorResponse('duration_label must be a string or null', 400);
      }
      patch.duration_label = body.duration_label;
    }
    if (body.price_no_boarding_ngn !== undefined) {
      if (!isWholeNonNegative(body.price_no_boarding_ngn)) {
        return errorResponse('price_no_boarding_ngn must be a whole number of naira, zero or more', 400);
      }
      patch.price_no_boarding_ngn = body.price_no_boarding_ngn;
    }
    if (body.price_with_boarding_ngn !== undefined) {
      if (body.price_with_boarding_ngn !== null && !isWholeNonNegative(body.price_with_boarding_ngn)) {
        return errorResponse('price_with_boarding_ngn must be null or a whole number of naira, zero or more', 400);
      }
      patch.price_with_boarding_ngn = body.price_with_boarding_ngn;
    }
    if (body.sort_order !== undefined) {
      if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
        return errorResponse('sort_order must be an integer', 400);
      }
      patch.sort_order = body.sort_order;
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean', 400);
      patch.is_active = body.is_active;
    }

    const supabase = createAdminClient();
    const { data: existing, error: readErr } = await supabase
      .from('academy_area_options')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (readErr) {
      logDbError('PUT read', readErr);
      return errorResponse('Failed to update the area option', 500);
    }
    if (!existing) return errorResponse('Area option not found', 404);

    // Validate the boarding rule on the EFFECTIVE pair (patch over stored), so a
    // partial update that sends only one price is still checked.
    const cur = existing as { price_no_boarding_ngn: number; price_with_boarding_ngn: number | null };
    const effNo = (patch.price_no_boarding_ngn as number | undefined) ?? cur.price_no_boarding_ngn;
    const effWith =
      'price_with_boarding_ngn' in patch
        ? (patch.price_with_boarding_ngn as number | null)
        : cur.price_with_boarding_ngn;
    if (effWith !== null && effWith < effNo) return errorResponse(BOARDING_RULE_MSG, 400);

    const { data, error } = await supabase
      .from('academy_area_options')
      .update(patch)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) {
      logDbError('PUT', error);
      return errorResponse('Failed to update the area option', 500);
    }
    if (!data) return errorResponse('Area option not found', 404);

    audit(request, identity, 'academy.area_option.update', id, existing, data);
    return successResponse({ success: true, option: data });
  } catch (error) {
    return handleApiError(error, 'Failed to update the area option');
  }
}
