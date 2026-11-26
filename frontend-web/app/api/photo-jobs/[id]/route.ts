/**
 * `GET`  — the poll target for one photo job (spec §6).
 * `POST` — the contestant's own cancel, which the mobile status screen needs
 *          because background removal can take longer than someone's patience.
 *
 * Design §5 puts both verbs on this one path; there is no `/cancel` sub-route.
 * `re-render with new params` is the same file in P4 and is deliberately not
 * here yet.
 *
 * Both verbs do the same three things in the same order: identify the user, read
 * the row as the service role, and compare the row's registration owner to that
 * user before a single field of it is described. That order is the whole
 * authorisation model of this feature — see status-read.ts for why a client
 * cannot read these rows by itself.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import {
  TERMINAL_FOR_CANCEL,
  isUuidId,
  kickDrain,
  photoJobPayload,
} from '@/src/server/photo-jobs/status-read';
import { cancelPhotoJob, getPhotoJob, type PhotoJob } from '@/src/server/photo-jobs/job-store';

export const dynamic = 'force-dynamic';

type Owned = { ok: true; job: PhotoJob } | { ok: false; res: Response };

async function ownedJob(request: Request, id: string, notFound: string): Promise<Owned> {
  if (!isUuidId(id)) return { ok: false, res: errorResponse('Photo job id must be a uuid', 400) };
  const { user } = await requireUser(request);
  const job = await getPhotoJob(id);
  if (!job) return { ok: false, res: errorResponse(notFound, 404) };
  if (job.registration_user_id !== user.id) {
    return { ok: false, res: errorResponse('Not allowed', 403) };
  }
  return { ok: true, job };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const read = await ownedJob(request, id, 'Photo job not found');
    if (!read.ok) return read.res;

    kickDrain();
    return successResponse({ job: await photoJobPayload(read.job) });
  } catch (error) {
    return handleApiError(error, 'Failed to read photo job');
  }
}

/**
 * Cancel is refused rather than faked. `cancel_photo_job` is `returns void` and
 * updates nothing once a row is `ready` or `cancelled`, so a route that ignored
 * the current status would answer `{cancelled: true}` for an action with no
 * effect — and a contestant who just got their portrait would be told the
 * portrait they can see is gone.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const read = await ownedJob(request, id, 'Photo job not found');
    if (!read.ok) return read.res;

    if ((TERMINAL_FOR_CANCEL as readonly string[]).includes(read.job.status)) {
      return errorResponse(
        read.job.status === 'ready'
          ? 'This portrait is already finished — cancelling would throw away a result you can use'
          : 'This job is already cancelled',
        409,
      );
    }

    // A fixed reason, not a client string: `last_error` is read by operators and
    // the migration truncates it to 300 characters, so free text from a phone
    // would be the only place a contestant could write into the admin's queue.
    await cancelPhotoJob(read.job.id, 'Cancelled by the contestant');
    return successResponse({ cancelled: true, id: read.job.id });
  } catch (error) {
    return handleApiError(error, 'Failed to cancel photo job');
  }
}
