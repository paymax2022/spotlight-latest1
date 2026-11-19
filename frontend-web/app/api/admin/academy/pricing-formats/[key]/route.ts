import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { orderFormats, type AcademyPricingFormat } from '@/src/server/services/academy/pricing';
import {
  countApplicationsUsingFormat,
  countPricedTrainings,
  deleteFormatRow,
  FORMAT_KEY_PATTERN,
  isFormatReadFailure,
  readFormatForWrite,
  syncFormatCopies,
  tryGetTrainingFormats,
  updateFormat,
} from '@/src/server/services/academy/formats';

// One training format: rename it, re-word it, change the price a freshly created
// training is offered at, or withdraw it. See ./route.ts for why identity is
// managed here and money per training is managed by the areas route.
//
// The rule that shapes every handler below: `key` is written into
// academy_applications (pricing_option_key, and the pricing_selections map) and
// is how a past application's wording is resolved, so it is a permanent
// identifier. Renaming is safe because the rows that carry it are re-synced
// inside the same request; editing the key is not offered at all. Retiring is
// the normal "remove" — deleting is reserved for a format no learner has ever
// been priced in, and is refused rather than guessed at when that cannot be
// checked.

const PERMISSION = 'programs:manage';

const MAX_LABEL_CHARS = 200;
const MAX_NOTE_CHARS = 500;
const MAX_FORMAT_PRICE_NGN = 9_999_999_999;

interface FormatPatchBody {
  key?: unknown;
  label?: unknown;
  note?: unknown;
  default_price_ngn?: unknown;
  is_active?: unknown;
}

function parseDefaultPrice(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isInteger(n) || n <= 0 || n > MAX_FORMAT_PRICE_NGN) return null;
  return n;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  return trimmed.length > max ? null : trimmed;
}

/** `/admin/academy/film` addresses a format by its key in the path — same shape
 *  the areas route expects of a uuid, before it reaches Postgres as 22P02. */
function formatKeyFrom(pathname: string): string | null {
  const raw = decodeURIComponent(pathname.split('/').pop() ?? '').trim().toLowerCase();
  return FORMAT_KEY_PATTERN.test(raw) ? raw : null;
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, PERMISSION);
    const key = formatKeyFrom(new URL(request.url).pathname);
    if (!key) return errorResponse('Unknown format key', 400);

    const current = await readFormatForWrite(key);
    if (!current) return errorResponse('Tuition format not found', 404);
    return successResponse({ success: true, format: current });
  } catch (error) {
    if (isFormatReadFailure(error)) {
      return errorResponse('Could not read the format list, so nothing was changed. Try again.', 500);
    }
    return handleApiError(error, 'Failed to load the tuition format');
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await assertAdminPermission(request, PERMISSION);
    const key = formatKeyFrom(new URL(request.url).pathname);
    if (!key) return errorResponse('Unknown format key', 400);

    const body = (await request.json().catch(() => null)) as FormatPatchBody | null;
    if (!body) return errorResponse('Invalid JSON body', 400);

    // Deliberately NOT updatable: key — academy_applications stores it. A client
    // that sends one is asked to rename the format, not silently having its
    // change dropped, because the rename it means is a delete-plus-create that
    // would orphan every application already priced in the old key.
    const askedKey = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
    if (askedKey && askedKey !== key) {
      return errorResponse(
        'A format key cannot be changed once created — applications store it. Withdraw this format and add a new one instead.',
        409,
      );
    }

    const patch: Partial<Omit<AcademyPricingFormat, 'key'>> = {};
    const changes: Record<string, unknown> = {};

    if (body.label !== undefined) {
      const label = cleanText(body.label, MAX_LABEL_CHARS);
      if (label === null) return errorResponse(`Label must be at most ${MAX_LABEL_CHARS} characters`, 400);
      if (!label) return errorResponse('Label cannot be empty', 400);
      patch.label = label;
      changes.label = label;
    }
    if (body.note !== undefined) {
      const note = cleanText(body.note, MAX_NOTE_CHARS);
      if (note === null) return errorResponse(`Note must be at most ${MAX_NOTE_CHARS} characters`, 400);
      patch.note = note || null;
      changes.note = patch.note;
    }
    if (body.default_price_ngn !== undefined) {
      const price = parseDefaultPrice(body.default_price_ngn);
      if (price === null) {
        return errorResponse(
          `Default price must be a whole number of naira above zero (at most ${MAX_FORMAT_PRICE_NGN.toLocaleString('en-NG')})`,
          400,
        );
      }
      patch.default_price_ngn = price;
      changes.default_price_ngn = price;
    }
    if (body.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active);
      changes.is_active = patch.is_active;
    }

    if (Object.keys(patch).length === 0) {
      return errorResponse('Nothing to change: send label, note, default_price_ngn or is_active', 400);
    }

    const current = await readFormatForWrite(key);
    if (!current) return errorResponse('Tuition format not found', 404);

    // Withdrawing the only format on offer would empty the apply form: the
    // helpers would fall back to the launch structure and the applicant would be
    // shown formats the operator has retired. Better a refusal than a silent
    // revert.
    if (patch.is_active === false && current.is_active) {
      const { formats } = await tryGetTrainingFormats();
      if (formats.filter((f) => f.is_active).length <= 1) {
        return errorResponse(
          'This is the only tuition format on offer. Add another before withdrawing this one.',
          409,
        );
      }
    }

    // A save that changes nothing is not a change, and must not fan a re-sync
    // across every training or book an audit row.
    const changed = (Object.keys(patch) as Array<keyof typeof patch>).some(
      (field) => current[field] !== patch[field],
    );
    if (!changed) {
      return successResponse({ success: true, format: current });
    }

    await updateFormat(key, patch);

    // A label, note or order change lives on the price rows too — that is what
    // a past application renders — so the copies are re-synced here rather than
    // left to drift from the catalogue. A price-only or active-only edit touches
    // no wording, so it fans nothing out: withdrawing a format must NOT rewrite
    // history.
    if (patch.label !== undefined || patch.note !== undefined) {
      const updated: AcademyPricingFormat = { ...current, ...patch, key };
      try {
        await syncFormatCopies(updated);
      } catch (error) {
        console.error('[admin/academy/pricing-formats] PUT label sync failed', error);
        return errorResponse(
          `The format was renamed but its wording on the trainings could not be updated. Try saving again.`,
          500,
        );
      }
    }

    addAuditEvent({
      adminUser: admin.actorId || 'admin',
      role: admin.role,
      action: patch.is_active !== undefined && Object.keys(patch).length === 1
        ? 'academy.pricing_format.retire'
        : 'academy.pricing_format.update',
      module: 'academy',
      entityType: 'academy_pricing_formats',
      entityId: key,
      reason: patch.is_active === false
        ? 'Withdrew a tuition format from new applications'
        : patch.is_active === true && !current.is_active
          ? 'Returned a tuition format to the offer'
          : 'Updated a tuition format',
      oldValue: {
        label: current.label,
        note: current.note,
        default_price_ngn: current.default_price_ngn,
        is_active: current.is_active,
      },
      newValue: changes,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    const { formats } = await tryGetTrainingFormats({ includeInactive: true });
    return successResponse({ success: true, formats: orderFormats(formats) });
  } catch (error) {
    if (isFormatReadFailure(error)) {
      return errorResponse('Could not read the format list, so nothing was changed. Try again.', 500);
    }
    return handleApiError(error, 'Failed to update the tuition format');
  }
}

/**
 * DELETE removes a format only when no learner has ever been priced in it.
 * Anything with history must be withdrawn (PUT is_active=false) instead: that is
 * what keeps a paid application's wording intact.
 */
export async function DELETE(request: Request) {
  try {
    const admin = await assertAdminPermission(request, PERMISSION);
    const key = formatKeyFrom(new URL(request.url).pathname);
    if (!key) return errorResponse('Unknown format key', 400);

    const current = await readFormatForWrite(key);
    if (!current) return errorResponse('Tuition format not found', 404);

    // The read that decides an irreversible delete. A null means "unchecked",
    // which is a refusal, not a pass.
    const usedBy = await countApplicationsUsingFormat(key);
    if (usedBy === null) {
      return errorResponse(
        'Could not check whether any application uses this format, so nothing was deleted. Withdraw it instead.',
        500,
      );
    }
    if (usedBy > 0) {
      return errorResponse(
        `${usedBy} application${usedBy === 1 ? '' : 's'} were priced in this format. Withdraw it instead of deleting — withdrawing hides it from new applicants and keeps those records readable.`,
        409,
      );
    }

    const priced = await countPricedTrainings(key);
    if (priced > 0) {
      // The FK would refuse this anyway; saying it first keeps the message
      // useful instead of a 500 off Postgres.
      return errorResponse(
        `${priced} trainin${priced === 1 ? 'y' : 'ies'} still carry a price for this format. Withdraw it, or reprice those trainings in the areas table first.`,
        409,
      );
    }

    await deleteFormatRow(key);

    addAuditEvent({
      adminUser: admin.actorId || 'admin',
      role: admin.role,
      action: 'academy.pricing_format.delete',
      module: 'academy',
      entityType: 'academy_pricing_formats',
      entityId: key,
      reason: 'Deleted an unused tuition format',
      oldValue: current,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    const { formats } = await tryGetTrainingFormats({ includeInactive: true });
    return successResponse({ success: true, formats: orderFormats(formats) });
  } catch (error) {
    if (isFormatReadFailure(error)) {
      return errorResponse('Could not read the format list, so nothing was changed. Try again.', 500);
    }
    return handleApiError(error, 'Failed to delete the tuition format');
  }
}
