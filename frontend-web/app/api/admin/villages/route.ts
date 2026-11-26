// GET  /api/admin/villages?state=&lga=&active=   — the curated rows, retired ones included
// POST /api/admin/villages                        — publish one quarter, or a pasted list
//
// The module that makes the village tier maintainable: until now the only way to add
// quarters was a migration seed plus a deploy, which left every LGA except Onitsha North a
// text box. See src/server/registration-v2/villages-admin.ts for the field rules and why a
// batch is inserted name-by-name.
//
// Order of the two gates is deliberate and matches the rest of the BFF: the feature flag
// answers BEFORE the admin check, so a dark module reads 503 to everyone and never becomes
// an information leak about who is allowed to edit reference data. With the flag off, the
// applicant-facing pickers keep working against whatever rows already exist — an admin
// feature cannot cause a user-facing outage.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { normalizeLocality } from '@/src/server/registration-v2/locality';
import {
  createVillage,
  createVillagesBulk,
  draftVillage,
  listAdminVillages,
} from '@/src/server/registration-v2/villages-admin';

interface VillageBody {
  state?: unknown;
  lga?: unknown;
  name?: unknown;
  names?: unknown;
  notes?: unknown;
}

export async function GET(request: Request) {
  try {
    requireFeature('localityVillages');
    await assertAdminPermission(request, 'programs:manage');

    const { searchParams } = new URL(request.url);
    const state = normalizeLocality(searchParams.get('state'));
    if (!state) return errorResponse('state is required.', 400);

    const result = await listAdminVillages({
      state,
      lga: normalizeLocality(searchParams.get('lga')) || undefined,
      active: searchParams.get('active') === 'true' ? true : undefined,
    });

    if (!result.ok) return errorResponse(result.error, result.status);
    return successResponse({ success: true, state, villages: result.rows });
  } catch (error) {
    return handleApiError(error, 'Failed to load villages.');
  }
}

export async function POST(request: Request) {
  try {
    requireFeature('localityVillages');
    await assertAdminPermission(request, 'programs:manage');

    const body = (await request.json().catch(() => null)) as VillageBody | null;
    if (!body) return errorResponse('Invalid JSON body', 400);

    // A pasted list is the common case — an admin types one LGA's quarters in from a
    // meeting note — so both shapes share this route and both get per-name answers.
    if (Array.isArray(body.names)) {
      const outcome = await createVillagesBulk(body.state, body.lga, body.names, body.notes);
      if (outcome.status !== 201) {
        return errorResponse(outcome.error ?? 'No villages were published.', outcome.status);
      }
      return successResponse({ success: true, created: outcome.created, skipped: outcome.skipped }, 201);
    }

    const drafted = draftVillage(body.state, body.lga, body.name, body.notes);
    if (!drafted.ok) return errorResponse(drafted.error, drafted.status);

    const created = await createVillage(drafted.draft);
    if (!created.ok) return errorResponse(created.error, created.status);

    return successResponse({ success: true, village: created.row }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to save village.');
  }
}
