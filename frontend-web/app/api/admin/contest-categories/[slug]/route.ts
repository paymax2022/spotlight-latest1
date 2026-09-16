import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import {
  contestCountForCategory,
  deleteContestCategory,
  getContestCategory,
  updateContestCategory,
} from '@/src/server/contests/categories';

interface Ctx {
  params: Promise<{ slug: string }>;
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const { slug } = await ctx.params;

    const existing = await getContestCategory(slug);
    if (!existing) return errorResponse('Category not found.', 404);

    const body = (await request.json()) as {
      label?: unknown;
      description?: unknown;
      active?: unknown;
      sortOrder?: unknown;
    };

    const patch: { label?: string; description?: string | null; active?: boolean; sortOrder?: number } = {};

    if (body.label !== undefined) {
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (!label) return errorResponse('Category label cannot be empty.', 400);
      patch.label = label;
    }
    if (body.description !== undefined) {
      patch.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') return errorResponse('active must be a boolean.', 400);
      patch.active = body.active;
    }
    if (body.sortOrder !== undefined) {
      if (typeof body.sortOrder !== 'number' || !Number.isFinite(body.sortOrder)) {
        return errorResponse('sortOrder must be a number.', 400);
      }
      patch.sortOrder = Math.trunc(body.sortOrder);
    }

    // The slug is deliberately NOT patchable: it is what lives in
    // contests.category, so renaming it would orphan every contest filed under
    // it. The label is the display name and is free to change.
    const category = await updateContestCategory(slug, patch);
    return successResponse({ category });
  } catch (error) {
    return handleApiError(error, 'Failed to update contest category.');
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const { slug } = await ctx.params;

    const existing = await getContestCategory(slug);
    if (!existing) return errorResponse('Category not found.', 404);

    // Refuse to strand contests. Their category column would still hold this
    // slug, which would then fail validation on the next edit — a delete here
    // would quietly make those contests uneditable.
    const inUse = await contestCountForCategory(slug);
    if (inUse > 0) {
      return errorResponse(
        `${inUse} contest${inUse === 1 ? ' is' : 's are'} filed under this category. ` +
          'Deactivate it instead — that hides it from new contests and leaves the existing ones intact.',
        409,
      );
    }

    await deleteContestCategory(slug);
    return successResponse({ deleted: slug });
  } catch (error) {
    return handleApiError(error, 'Failed to delete contest category.');
  }
}
