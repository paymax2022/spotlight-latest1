// PATCH  /api/admin/villages/[id] — rename, edit the note, retire or restore one row
// DELETE /api/admin/villages/[id] — remove a row that was never real
//
// Retiring (`{ "active": false }`) is the everyday move: `is_active = false` drops the
// quarter out of both public pickers and Go's /api/v1/connect/villages while leaving the
// name attached to any contestant who already chose it. Hard deletion is for typos and
// duplicate spellings of the same quarter, and it is the one write here that cannot be
// undone — which is why the admin console asks for the name back before it sends it.
//
// A row's state/lga are its identity, so they are not patchable; moving a quarter between
// LGAs means deleting it and creating it under the new pair.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { draftPatch, updateVillage, deleteVillage } from '@/src/server/registration-v2/villages-admin';

interface VillagePatchBody {
  name?: unknown;
  notes?: unknown;
  active?: unknown;
}

type Ctx = { params: Promise<{ id: string }> };

function rowId(raw: string | undefined): string {
  return (raw ?? '').trim();
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    requireFeature('localityVillages');
    await assertAdminPermission(request, 'programs:manage');

    const id = rowId((await ctx.params).id);
    if (!id) return errorResponse('id is required.', 400);

    const body = (await request.json().catch(() => null)) as VillagePatchBody | null;
    if (!body) return errorResponse('Invalid JSON body', 400);

    const patched = draftPatch({
      name: typeof body.name === 'string' ? body.name : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
    });
    if (!patched.ok) return errorResponse(patched.error, patched.status);

    const result = await updateVillage(id, patched.write);
    if (!result.ok) return errorResponse(result.error, result.status);

    return successResponse({ success: true, village: result.row });
  } catch (error) {
    return handleApiError(error, 'Failed to update village.');
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    requireFeature('localityVillages');
    await assertAdminPermission(request, 'programs:manage');

    const id = rowId((await ctx.params).id);
    if (!id) return errorResponse('id is required.', 400);

    const result = await deleteVillage(id);
    if (!result.ok) return errorResponse(result.error, result.status);
    if (!result.removed) return errorResponse('village not found.', 404);

    return successResponse({ success: true, deleted: id });
  } catch (error) {
    return handleApiError(error, 'Failed to delete village.');
  }
}
