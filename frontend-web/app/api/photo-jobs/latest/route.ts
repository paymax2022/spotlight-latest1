/**
 * The newest photo job for one of the caller's own registrations.
 *
 * This exists because the id `POST /api/registration/applications` hands back is
 * not durable: a contestant who closes the app, or reopens the edit screen a week
 * later, has the registration and nothing else. Without this read a surface would
 * have to guess from `registrations.form_data.media` whether a portrait is
 * pending — which is exactly the ambiguity the job table was added to remove.
 *
 * `registrationId` is a query parameter and is treated as untrusted: the row's
 * own registration owner is compared to the caller before anything is answered,
 * so aiming this at somebody else's registration returns 403, not their progress.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { kickDrain, photoJobPayload, isUuidId } from '@/src/server/photo-jobs/status-read';
import { getLatestPhotoJob } from '@/src/server/photo-jobs/job-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request);
    const registrationId = new URL(request.url).searchParams.get('registrationId') ?? '';
    // Same uuid guard as the by-id route: `registration_id` is a uuid column and
    // a non-uuid reaches Postgres as 22P02.
    if (!isUuidId(registrationId)) {
      return errorResponse('registrationId must be a uuid', 400);
    }

    const job = await getLatestPhotoJob(registrationId);
    if (!job) return errorResponse('No photo job for this registration yet', 404);
    if (job.registration_user_id !== user.id) return errorResponse('Not allowed', 403);

    kickDrain();
    return successResponse({ job: await photoJobPayload(job) });
  } catch (error) {
    return handleApiError(error, 'Failed to read the latest photo job');
  }
}
