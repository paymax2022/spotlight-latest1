import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
// ADMIN CONSOLIDATION follow-up to slice 4. This route does not replace
// /contests/[id]/applications — it answers the question that route cannot,
// because that one reads `competition_enrollments` while the public Open Mic
// apply form writes `registrations`. See the adapter's header for the two
// planes and why the merge lives in registration-v2/.
import {
  listOpenMicContestApplicants,
  defaultOpenMicApplicantSources,
} from '@/src/server/registration-v2/open-mic-applicants';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicReadAdmin(request);
    const applications = await listOpenMicContestApplicants(params.id, defaultOpenMicApplicantSources);
    return successResponse({ success: true, applications, total: applications.length });
  } catch (error) {
    return handleApiError(error, 'Failed to list Open Mic applicants');
  }
}
