import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import {
  orderFormats,
  type AcademyPricingFormat,
} from '@/src/server/services/academy/pricing';
import {
  FORMAT_KEY_PATTERN,
  insertFormat,
  isFormatReadFailure,
  isValidFormatKey,
  priceNewFormatEverywhere,
  syncFormatCopies,
  tryGetTrainingFormats,
  updateFormat,
} from '@/src/server/services/academy/formats';

// The training formats an applicant chooses between — "Weekend (No Boarding)",
// "1 month - Boarding", and whatever the operator adds next season — are rows in
// academy_pricing_formats, managed here. Before this table existed the same five
// names lived in a Postgres CHECK and two TypeScript unions, so changing the
// wording or the order of the list a learner sees meant writing a migration,
// deploying it, and hoping the mobile build in someone's pocket agreed.
//
// Identity only: `key` is what academy_applications stores forever and what the
// per-training price rows in academy_area_pricing_options are addressed by, so
// this route renames and reorders a format but never edits its key (see
// [key]/route.ts for that rule, and for deleting). The MONEY for a training sits
// in the areas route's `pricing` array; `default_price_ngn` here is only what a
// newly created format costs before anyone reprices it per training.
//
// Writes here fan out to every training (a rename re-syncs the wording stored on
// each price row), so they are audited as a group and, where the fan-out fails,
// say so instead of returning a bare success: the format table and the price rows
// are two tables, and an operator needs to know which half they are looking at.

const PERMISSION = 'programs:manage';

/** Display text; the columns are varchar(200)/text. */
const MAX_LABEL_CHARS = 200;
const MAX_NOTE_CHARS = 500;

/** Largest whole-naira value numeric(12,2) can hold — same ceiling as the areas route. */
const MAX_FORMAT_PRICE_NGN = 9_999_999_999;

interface FormatBody {
  key?: unknown;
  label?: unknown;
  note?: unknown;
  sort_order?: unknown;
  is_active?: unknown;
  default_price_ngn?: unknown;
}

/**
 * A whole number of naira above zero, exactly as the areas route reads a price.
 * Zero is refused on purpose: `tuitionForFormat` returning 0 is what makes the
 * tuition services fall back to the batch `training_fee_ngn`, a figure the
 * applicant never saw, and a format nobody can be charged for is not a format.
 */
function parseDefaultPrice(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isInteger(n) || n <= 0 || n > MAX_FORMAT_PRICE_NGN) return null;
  return n;
}

/** Display order step: 10 apart, matching the seeded catalogue so an insert can slot between. */
function parseSortOrder(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
  return n;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

/** The last place in the operator's order — where a new format appears. */
function lastSortOrder(formats: AcademyPricingFormat[]): number {
  return formats.reduce((max, f) => Math.max(max, f.sort_order), 0) + 10;
}

function toRow(format: AcademyPricingFormat) {
  return { ...format };
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    // includeInactive: an operator who withdraws a format must still see it —
    // that is the only way back to it.
    const { formats, degraded } = await tryGetTrainingFormats({ includeInactive: true });
    return successResponse({ success: true, formats: formats.map(toRow), degraded });
  } catch (error) {
    return handleApiError(error, 'Failed to load tuition formats');
  }
}

export async function POST(request: Request) {
  try {
    const admin = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as FormatBody | null;
    if (!body) return errorResponse('Invalid JSON body', 400);

    const rawKey = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
    if (!FORMAT_KEY_PATTERN.test(rawKey)) {
      return errorResponse(
        'Key must be 2-40 characters: a lowercase letter, then lowercase letters, digits or underscores (e.g. "summer_intensive")',
        400,
      );
    }

    const label = cleanText(body.label, MAX_LABEL_CHARS);
    if (label === null) return errorResponse(`Label must be at most ${MAX_LABEL_CHARS} characters`, 400);
    if (!label) return errorResponse('Label is required', 400);

    const note = cleanText(body.note, MAX_NOTE_CHARS);
    if (note === null) return errorResponse(`Note must be at most ${MAX_NOTE_CHARS} characters`, 400);

    const price = parseDefaultPrice(body.default_price_ngn);
    if (price === null) {
      return errorResponse(
        `Default price must be a whole number of naira above zero (at most ${MAX_FORMAT_PRICE_NGN.toLocaleString('en-NG')})`,
        400,
      );
    }

    const parsedSort = parseSortOrder(body.sort_order);
    if (body.sort_order !== undefined && parsedSort === null) {
      return errorResponse('sort_order must be a whole number', 400);
    }

    const { formats } = await tryGetTrainingFormats({ includeInactive: true });
    if (formats.some((f) => f.key === rawKey)) {
      return errorResponse(`A format with the key "${rawKey}" already exists`, 409);
    }

    const created: AcademyPricingFormat = {
      key: rawKey,
      label,
      note: note || null,
      sort_order: parsedSort ?? lastSortOrder(formats),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      default_price_ngn: price,
    };

    // The row first: an applicant-facing surface reads the catalogue, so a
    // format that is not in it yet must not be priced anywhere.
    try {
      await insertFormat(created);
    } catch (error) {
      // 23505 = the race where someone else created the same key between the
      // check above and the insert. Say so plainly rather than 500.
      if ((error as { code?: string }).code === '23505') {
        return errorResponse(`A format with the key "${rawKey}" already exists`, 409);
      }
      throw error;
    }

    // Then every training gets a price row at the default, so the format is
    // actually offerable. A failure here leaves a format that prices nowhere;
    // the applicant projection falls back to `default_price_ngn`, so it is
    // still sellable — hence the audit records it as a partial write.
    let seeded = true;
    try {
      await priceNewFormatEverywhere(created);
    } catch (error) {
      seeded = false;
      console.error('[admin/academy/pricing-formats] POST seeding failed', error);
    }

    addAuditEvent({
      adminUser: admin.actorId || 'admin',
      role: admin.role,
      action: 'academy.pricing_format.create',
      module: 'academy',
      entityType: 'academy_pricing_formats',
      entityId: created.key,
      reason: seeded
        ? 'Added a tuition format for every training'
        : 'Added a tuition format (per-training prices not seeded — the default price is used)',
      newValue: created,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    const fresh = orderFormats(await tryGetTrainingFormats({ includeInactive: true }).then((r) => r.formats));
    return successResponse({
      success: true,
      format: toRow(created),
      formats: fresh.map(toRow),
      warning: seeded
        ? undefined
        : 'The format was created but its per-training prices could not be written; applicants are charged its default price until you reprice it.',
    });
  } catch (error) {
    if (isFormatReadFailure(error)) {
      return errorResponse('Could not read the current format list, so nothing was changed. Try again.', 500);
    }
    return handleApiError(error, 'Failed to add the tuition format');
  }
}

/**
 * PUT is the reorder-only verb: it takes the whole list of keys in the order the
 * operator wants. A single format's label, note, price or active flag goes
 * through PUT /[key]. Keeping them apart means a drag-to-reorder never carries a
 * stale label over a concurrent edit.
 */
export async function PUT(request: Request) {
  try {
    const admin = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as { order?: unknown };
    const order = Array.isArray(body?.order) ? body.order : null;
    if (!order) return errorResponse('order must be an array of format keys', 400);
    if (order.length === 0) return errorResponse('order must not be empty', 400);

    const keys: string[] = [];
    for (const item of order) {
      const key = typeof item === 'string' ? item.trim() : '';
      // Two different refusals: a key that is not a legal identifier means the
      // client sent something the table could never hold (the operator sees a
      // corrupted list), while a well-formed key that is not in the catalogue
      // means the list moved under them. The same wording for both would tell an
      // operator to fix a typo by adding a format.
      if (!isValidFormatKey(key)) {
        return errorResponse(
          `Not a valid format key: "${key}". A key is 2-40 characters: a lowercase letter, then lowercase letters, digits or underscores.`,
          400,
        );
      }
      if (keys.includes(key)) return errorResponse(`Duplicate format key: ${key}`, 400);
      keys.push(key);
    }

    const { formats } = await tryGetTrainingFormats({ includeInactive: true });
    const known = new Set(formats.map((f) => f.key));
    const missing = keys.filter((key) => !known.has(key));
    if (missing.length > 0) {
      return errorResponse(`Unknown format key: ${missing.join(', ')}`, 400);
    }

    // A partial order would move the listed formats and leave the rest where
    // they were, which reads as a shuffle the operator did not ask for. Names
    // every format, in full, or nothing.
    const omitted = [...known].filter((key) => !keys.includes(key));
    if (omitted.length > 0) {
      return errorResponse(
        `order must list every format; missing: ${omitted.sort().join(', ')}`,
        400,
      );
    }

    const oldOrder = orderFormats(formats).map((f) => f.key);
    const previousByOrder: Record<string, number> = Object.fromEntries(
      formats.map((f) => [f.key, f.sort_order]),
    );
    const newValue: Record<string, number> = {};
    for (const [index, key] of keys.entries()) newValue[key] = (index + 1) * 10;

    // The same list in the same order is not a change: skipping it keeps the
    // audit honest and stops a no-op click fanning a label re-sync across every
    // training.
    const unchanged =
      keys.length === oldOrder.length && keys.every((key, i) => key === oldOrder[i]);

    if (!unchanged) {
      for (const key of keys) {
        const format = formats.find((f) => f.key === key);
        if (!format) continue;
        const sort_order = newValue[key];
        if (sort_order === format.sort_order) continue;
        await updateFormat(key, { sort_order });
        // The applicant read takes its order from the catalogue, but a PAST
        // application renders the rows stored on its own trainings — so the
        // position has to travel to those rows too, not just to the format.
        await syncFormatCopies({ ...format, sort_order });
      }

      addAuditEvent({
        adminUser: admin.actorId || 'admin',
        role: admin.role,
        action: 'academy.pricing_format.reorder',
        module: 'academy',
        entityType: 'academy_pricing_formats',
        entityId: 'all',
        reason: 'Reordered the tuition formats applicants choose between',
        oldValue: { order: oldOrder, sort: previousByOrder },
        newValue: { order: keys, sort: newValue },
        ipAddress: request.headers.get('x-forwarded-for') || undefined,
      });
    }

    const { formats: fresh } = await tryGetTrainingFormats({ includeInactive: true });
    return successResponse({ success: true, formats: orderFormats(fresh).map(toRow) });
  } catch (error) {
    if (isFormatReadFailure(error)) {
      return errorResponse('Could not read the current format list, so nothing was changed. Try again.', 500);
    }
    return handleApiError(error, 'Failed to reorder the tuition formats');
  }
}
