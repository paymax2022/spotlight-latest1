import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ── Admin — Film Academy areas of interest ───────────────────────────────────
// Each area carries a NAIRA fee that is ADDED to academy_settings.application_fee
// when an applicant selects it. The applicant-facing total is computed
// server-side in /api/academy/apply from these same rows, so editing a fee here
// changes what the next applicant pays — nothing is cached client-side.
//
// `slug` is written into academy_applications.areas_of_interest, so it must stay
// stable once applications reference it. Renaming an area's LABEL is safe;
// changing its slug orphans historic rows, which is why slug is only accepted on
// create and ignored on update.

const PERMISSION = 'programs:manage';

interface AreaBody {
  id?: string;
  slug?: string;
  label?: string;
  description?: string | null;
  fee_ngn?: number | string;
  is_active?: boolean;
  sort_order?: number | string;
}

/** Naira, non-negative, at most 2dp — the column is numeric(12,2). */
function parseFee(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function slugify(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}


/**
 * Log the underlying Postgres error, return a clean message to the client.
 *
 * These handlers used to answer a bare 500 and discard the cause. When the
 * table was missing from a local database the response said only "Failed to
 * create the area of interest" — true, useless, and it cost three probes to
 * find that Postgres had plainly said `relation ... does not exist`.
 *
 * The detail goes to the SERVER log, not the response: a Postgres error can
 * name columns and constraints, which is not something to hand an HTTP caller.
 */
function logDbError(where: string, error: unknown): void {
  const e = error as { message?: string; code?: string; details?: string; hint?: string } | null;
  console.error(`[admin/academy/interest-areas] ${where} failed`, {
    code: e?.code,
    message: e?.message,
    details: e?.details,
    hint: e?.hint,
  });
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const supabase = createAdminClient();
    // Inactive areas are included here (unlike the applicant endpoint) so an
    // admin can see and re-enable what they retired.
    const { data, error } = await supabase
      .from('academy_interest_areas')
      .select('id, slug, label, description, fee_ngn, is_active, sort_order, updated_at')
      .order('sort_order', { ascending: true });
    if (error) {
      logDbError('GET', error);
      return errorResponse('Failed to load areas of interest', 500);
    }
    return successResponse({ success: true, areas: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load areas of interest');
  }
}

export async function POST(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const body = (await request.json()) as AreaBody;
    const label = String(body.label ?? '').trim();
    if (!label) return errorResponse('Label is required', 400);

    const slug = slugify(String(body.slug ?? '') || label);
    if (!slug) return errorResponse('Could not derive a slug from that label', 400);

    const fee = parseFee(body.fee_ngn ?? 0);
    if (fee === null) return errorResponse('Fee must be a number of naira, zero or more', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_interest_areas')
      .insert({
        slug,
        label,
        description: body.description ?? null,
        fee_ngn: fee,
        is_active: body.is_active ?? true,
        sort_order: Number(body.sort_order ?? 0) || 0,
      })
      .select()
      .single();

    // 23505 = unique_violation on slug. Say so plainly rather than 500.
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return errorResponse(`An area with the slug "${slug}" already exists`, 409);
      }
      logDbError('POST', error);
      return errorResponse('Failed to create the area of interest', 500);
    }
    return successResponse({ success: true, area: data });
  } catch (error) {
    return handleApiError(error, 'Failed to create the area of interest');
  }
}

export async function PUT(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const body = (await request.json()) as AreaBody;
    const id = String(body.id ?? '').trim();
    if (!id) return errorResponse('id is required', 400);

    // Deliberately NOT updatable: slug. Historic applications store it, so
    // changing it would orphan them.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.label !== undefined) {
      const label = String(body.label).trim();
      if (!label) return errorResponse('Label cannot be empty', 400);
      patch.label = label;
    }
    if (body.description !== undefined) patch.description = body.description ?? null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
    if (body.fee_ngn !== undefined) {
      const fee = parseFee(body.fee_ngn);
      if (fee === null) return errorResponse('Fee must be a number of naira, zero or more', 400);
      patch.fee_ngn = fee;
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_interest_areas')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      logDbError('PUT', error);
      return errorResponse('Failed to update the area of interest', 500);
    }
    if (!data) return errorResponse('Area of interest not found', 404);
    return successResponse({ success: true, area: data });
  } catch (error) {
    return handleApiError(error, 'Failed to update the area of interest');
  }
}
