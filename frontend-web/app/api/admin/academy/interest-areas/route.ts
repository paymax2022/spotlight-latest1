import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import {
  attachPricingOptions,
  defaultPricingRows,
  isPricingKey,
  pricingDefinition,
  type AcademyPricingKey,
  type AreaPricingOptionRow,
} from '@/src/server/services/academy/pricing';

// Each area is priced by the composite structure in
// academy_area_pricing_options — five training formats (weekend/weekday, each
// with and without boarding, plus 30-day full-time boarding), one row per
// area × format, NAIRA. GET returns every area with its pricing_options; PUT
// accepts a `pricing` array to reprice formats. The legacy single `fee_ngn`
// is no longer what applicants are priced on: it survives only for historic
// rows, and editing it here changes nothing an applicant sees.
// `slug` is written into academy_applications.areas_of_interest, so it must stay
// changing its slug orphans historic rows, which is why slug is only accepted on
// create and ignored on update.

const PERMISSION = 'programs:manage';

interface PricingPatchItem {
  key?: unknown;
  price_ngn?: unknown;
}

interface AreaBody {
  id?: string;
  slug?: string;
  label?: string;
  description?: string | null;
  fee_ngn?: number | string;
  is_active?: boolean;
  sort_order?: number | string;
  pricing?: PricingPatchItem[];
}

/** Naira, non-negative, at most 2dp — the column is numeric(12,2). */
function parseFee(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Trims leading/trailing `ch` runs by index scan — NOT `.replace(/^_+|_+$/g, '')`,
 *  which is quadratic on adversarial input: an end-anchored alternative under
 *  a global search still tries every start position, and greedily consuming a
 *  long run before backtracking to check the anchor is O(run length) at each
 *  of those positions. This is unconditionally O(n). */
function trimChar(s: string, ch: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === ch) start += 1;
  while (end > start && s[end - 1] === ch) end -= 1;
  return s.slice(start, end);
}

function slugify(v: string): string {
  return trimChar(v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'), '_');
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
    const { data: optionRows, error: optionsError } = await supabase
      .from('academy_area_pricing_options')
      .select('area_id, key, label, note, price_ngn, sort_order');
    if (optionsError) {
      logDbError('GET options', optionsError);
      return errorResponse('Failed to load area pricing', 500);
    }
    const areas = attachPricingOptions(
      (data ?? []) as Array<{ id: string } & Record<string, unknown>>,
      (optionRows ?? []) as AreaPricingOptionRow[],
    );
    return successResponse({ success: true, areas });
  } catch (error) {
    return handleApiError(error, 'Failed to load areas of interest');
  }
}

export async function POST(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as AreaBody;
    if (!body) return errorResponse('Invalid JSON body', 400);
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

    // A new area is offerable immediately, so it must carry the five formats —
    // priced at the launch structure. An area with no option rows would fall
    // back to those same defaults when an applicant picks a format, so a
    // failure here is logged, not fatal.
    const { error: seedError } = await supabase
      .from('academy_area_pricing_options')
      .insert(defaultPricingRows(data.id));
    if (seedError) logDbError('POST pricing', seedError);

    return successResponse({ success: true, area: data });
  } catch (error) {
    return handleApiError(error, 'Failed to create the area of interest');
  }
}

export async function PUT(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as AreaBody;
    if (!body) return errorResponse('Invalid JSON body', 400);
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

    // Composite pricing: `{ key, price_ngn }` per format, upserted against the
    // (area_id, key) unique. Labels/notes/sort stay whatever the structure
    // says — the admin edits the PRICE of a format, not its identity.
    const pricing = Array.isArray(body.pricing) ? body.pricing : null;
    if (body.pricing !== undefined && !pricing) {
      return errorResponse('pricing must be an array of { key, price_ngn }', 400);
    }
    const validatedPricing: Array<{ key: AcademyPricingKey; price_ngn: number }> = [];
    for (const item of pricing ?? []) {
      if (!isPricingKey(item?.key)) {
        return errorResponse(`Unknown pricing format: ${String(item?.key)}`, 400);
      }
      const price = parseFee(item.price_ngn);
      if (price === null) {
        return errorResponse(`Price for ${item.key} must be a number of naira, zero or more`, 400);
      }
      validatedPricing.push({ key: item.key, price_ngn: price });
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

    if (validatedPricing.length > 0) {
      const rows = validatedPricing.map(({ key, price_ngn }) => {
        const def = pricingDefinition(key);
        return {
          area_id: id,
          key,
          label: def.label,
          note: def.note,
          price_ngn,
          sort_order: def.sort_order,
          updated_at: new Date().toISOString(),
        };
      });
      const { error: pricingError } = await supabase
        .from('academy_area_pricing_options')
        .upsert(rows, { onConflict: 'area_id,key' });
      if (pricingError) {
        logDbError('PUT pricing', pricingError);
        return errorResponse('Failed to save the area pricing', 500);
      }
    }

    return successResponse({ success: true, area: data });
  } catch (error) {
    return handleApiError(error, 'Failed to update the area of interest');
  }
}
