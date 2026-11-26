// GET /api/registration/lgas?state=<state>
//
// The middle tier of the state -> local government -> village cascade, served from
// the static reference table in src/features/registration/reference-data.ts.
//
// Who calls it: the admin console (frontend-admin/app/admin/competitions/create),
// which has to offer the same LGA list the contest's own applicants see. The web
// wizard reads the table directly — it lives in this bundle — so this route is a
// distribution point, not a second source of truth. Copying the whole table into the
// console would be the alternative, and the third copy in the repo after the mobile
// app's own table.
//
// Public, and read-only: an unknown state answers 200 + mode=free_text rather than
// 404, so a reference-data gap degrades a control to a text box instead of erroring.
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { readLgas } from '@/src/server/registration-v2/locality';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await readLgas(searchParams.get('state'));

    if (!result.ok) return errorResponse(result.error, result.status);

    return successResponse({ success: true, ...result.payload });
  } catch (error) {
    return handleApiError(error, 'local government list unavailable.');
  }
}
