import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { getTrainingFormats, tryGetTrainingFormats } from '@/src/server/services/academy/formats';
import {
  attachPricingOptions,
  defaultPricingRows,
  type AcademyPricingFormat,
  type AreaPricingOptionRow,
} from '@/src/server/services/academy/pricing';

// Each area is priced by the composite structure in
// academy_area_pricing_options — one row per area × TRAINING FORMAT, NAIRA — and
// the formats themselves are the operator's rows in academy_pricing_formats (see
// ../pricing-formats/route.ts). There is no fixed list any more: the number of
// formats, their names and their order are read from the catalogue on every
// request, which is why this route's shape is "ask the catalogue, then price".
// GET returns every area with its pricing_options plus the catalogue the console
// renders; PUT accepts a `pricing` array to reprice formats. The legacy single
// `fee_ngn` is no longer what applicants are priced on: it survives only for
// historic rows, and editing it here changes nothing an applicant sees.
// `slug` is written into academy_applications.areas_of_interest, so it must stay —
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

/** Largest whole-naira value numeric(12,2) can hold. */
const MAX_FORMAT_PRICE_NGN = 9_999_999_999;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A format price: a whole number of naira, strictly positive, fits the column.
 * Zero is NOT allowed — a 0 tuition_total_ngn makes the tuition services fall
 * back to the batch training_fee_ngn, a figure the applicant never saw. Accepts
 * a JSON number, or a string of plain digits (surrounding whitespace trimmed) —
 * the same rule as the admin form. Anything else (blank, null, booleans, and
 * strings Number() would happily read such as "1e5", "0x10", "1.0") is rejected.
 */
function parseFormatPrice(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isInteger(n) || n <= 0 || n > MAX_FORMAT_PRICE_NGN) return null;
  return n;
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
    // includeInactive on both reads: the console shows what the operator retired
    // as well as what is on offer, so that withdrawing a format is reversible
    // and its prices stay visible.
    const { formats } = await tryGetTrainingFormats({ includeInactive: true });
    const areas = attachPricingOptions(
      (data ?? []) as Array<{ id: string } & Record<string, unknown>>,
      (optionRows ?? []) as AreaPricingOptionRow[],
      formats,
      { includeInactive: true },
    );
    return successResponse({ success: true, areas, pricing_formats: formats });
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

    // A new area is offerable immediately, so it must carry every format the
    // operator has on offer right now, at each format's default price. An area
    // with no option rows would fall back to those same defaults when an
    // applicant picks a format, so a failure here is logged, not fatal.
    const { error: seedError } = await supabase
      .from('academy_area_pricing_options')
      .insert(defaultPricingRows(data.id, await getTrainingFormats()));
    if (seedError) logDbError('POST pricing', seedError);

    return successResponse({ success: true, area: data });
  } catch (error) {
    return handleApiError(error, 'Failed to create the area of interest');
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as AreaBody;
    if (!body) return errorResponse('Invalid JSON body', 400);
    const id = String(body.id ?? '').trim();
    if (!id) return errorResponse('id is required', 400);
    // The column is uuid: anything else makes Postgres raise 22P02 → 500.
    if (!UUID_RE.test(id)) return errorResponse('id must be a UUID', 400);

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
    // (area_id, key) unique. Labels/notes/sort come from the managed format —
    // the admin edits the PRICE of a format here, not its identity, and a key
    // the operator has not created (or has withdrawn) is refused rather than
    // allowed to reach the FK.
    const pricing = Array.isArray(body.pricing) ? body.pricing : null;
    if (body.pricing !== undefined && !pricing) {
      return errorResponse('pricing must be an array of { key, price_ngn }', 400);
    }
    const formats = await getTrainingFormats({ includeInactive: true });
    const formatByKey = new Map(formats.map((f) => [f.key, f]));
    const validatedPricing: Array<{ key: string; price_ngn: number }> = [];
    for (const item of pricing ?? []) {
      const key = typeof item?.key === 'string' ? item.key.trim() : '';
      if (!formatByKey.has(key)) {
        return errorResponse(`Unknown tuition format: ${String(item?.key)}`, 400);
      }
      // A repeated key makes the upsert fail ("cannot affect row a second time").
      if (validatedPricing.some((p) => p.key === key)) {
        return errorResponse(`Duplicate pricing format: ${key}`, 400);
      }
      const price = parseFormatPrice(item.price_ngn);
      if (price === null) {
        return errorResponse(
          `Price for ${key} must be a whole number of naira above zero (at most 9,999,999,999)`,
          400,
        );
      }
      validatedPricing.push({ key, price_ngn: price });
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
      const touchedKeys = validatedPricing.map((p) => p.key);
      // Previous prices for the audit trail only — a failed read is logged and
      // never blocks the save.
      let oldValue: Record<string, number> | undefined;
      const { data: oldRows, error: oldError } = await supabase
        .from('academy_area_pricing_options')
        .select('key, price_ngn')
        .eq('area_id', id)
        .in('key', touchedKeys);
      if (oldError) {
        logDbError('PUT pricing old-value read', oldError);
      } else {
        oldValue = {};
        for (const r of (oldRows ?? []) as Array<{ key: string; price_ngn: unknown }>) {
          oldValue[r.key] = Number(r.price_ngn);
        }
      }

      const rows = validatedPricing.map(({ key, price_ngn }) => {
        // Identity comes from the catalogue, so a reprice writes the label and
        // position the operator set — not a copy from before the last rename.
        const def: AcademyPricingFormat = formatByKey.get(key) ?? formats[0];
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

      // A no-op save (every touched key already at that price) is not a change.
      // An unknown old value (read failed) is always audited.
      const unchanged =
        oldValue !== undefined && validatedPricing.every((p) => oldValue[p.key] === p.price_ngn);
      if (!unchanged) {
        addAuditEvent({
          adminUser: admin.actorId || 'admin',
          role: admin.role,
          action: 'academy.area_pricing.update',
          module: 'academy',
          entityType: 'academy_area_pricing_options',
          entityId: id,
          reason: 'Updated area of interest pricing',
          oldValue,
          newValue: Object.fromEntries(validatedPricing.map((p) => [p.key, p.price_ngn])),
          ipAddress: request.headers.get('x-forwarded-for') || undefined,
        });
      }
    }

    return successResponse({ success: true, area: data });
  } catch (error) {
    return handleApiError(error, 'Failed to update the area of interest');
  }
}
