import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import {
  createContestCategory,
  listContestCategories,
  toCategorySlug,
} from '@/src/server/contests/categories';

// Admin CRUD for competition categories. Same guard as the contest routes these
// categories gate — 'programs:manage' — because being able to add a category is
// effectively part of being able to create a contest.

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const categories = await listContestCategories();
    return successResponse({ categories });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest categories.');
  }
}

export async function POST(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const body = (await request.json()) as {
      slug?: unknown;
      label?: unknown;
      description?: unknown;
      sortOrder?: unknown;
    };

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) return errorResponse('Category label is required.', 400);

    // The slug is what gets written into contests.category, so it is derived
    // from the label when not given rather than left to the caller to invent.
    const rawSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : label;
    const slug = toCategorySlug(rawSlug);
    if (!slug) return errorResponse('Category slug could not be derived from the label.', 400);

    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;
    const sortOrder = typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)
      ? Math.trunc(body.sortOrder)
      : 0;

    const category = await createContestCategory({ slug, label, description, sortOrder });
    return successResponse({ category }, 201);
  } catch (error) {
    // Postgres unique_violation on the slug primary key. Reported as a 409 with
    // the slug named, because the caller usually typed a label that slugifies
    // onto an existing one ("Open Mic" vs "open mic") and needs to see why.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate key') || message.includes('23505')) {
      return errorResponse('A category with that slug already exists.', 409);
    }
    return handleApiError(error, 'Failed to create contest category.');
  }
}
