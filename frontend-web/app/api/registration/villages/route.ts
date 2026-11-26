// GET /api/registration/villages?state=<state>&lga=<lga>
//
// The village tier of the state -> local government -> village cascade, for the
// web registration wizard (and for any contest screen that wants to show where
// an applicant is from).
//
// Public by design. These rows are reference data the same way the LGA list is:
// `public.villages` grants anon/authenticated SELECT on active rows, an
// uncurated LGA answers 200 + mode=free_text, and nothing here leaks an applicant's
// personal data. Admin edits go through /api/admin/villages, which is RBAC-gated.
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { readVillages } from '@/src/server/registration-v2/locality';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await readVillages(searchParams.get('state'), searchParams.get('lga'));

    if (!result.ok) return errorResponse(result.error, result.status);

    return successResponse({ success: true, ...result.payload });
  } catch (error) {
    return handleApiError(error, 'village list unavailable.');
  }
}
