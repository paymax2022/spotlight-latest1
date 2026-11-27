/**
 * `GET /api/admin/photo-config-status` — what an operator needs to know before
 * the first job can succeed, in the shape spec §7 fixes.
 *
 * This payload is names and verdicts. It never contains an environment value:
 * `provider.missingEnv` is a list of variable NAMES from the same array the
 * Cloudinary client checks, the queue figures come from counts, and every blocker
 * is a derived sentence rather than free text. An admin-role caller reading this
 * must not be able to use it as a secret dump.
 *
 * The reason it exists at all is defect-shaped: "the add-on is enabled on this
 * account" is not something an env var can prove, and until the feature was built
 * a missing prerequisite surfaced as a job that failed six times. So the surface
 * says which of the four things it can actually see are missing, and says
 * plainly which two it cannot see.
 *
 * `applications:review` is the permission this console already uses for the
 * registration review surface — the same operator who approves a contestant is
 * the one who needs to know why their portrait is not appearing. A narrower
 * permission would be a new entry in the RBAC seed and a grant on three roles,
 * which is a decision for the owner, not for this route.
 */
import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { photoProviderConfig } from '@/src/lib/media/provider';
import { hasR2Config } from '@/src/lib/storage/r2';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { photoJobSummary } from '@/src/server/photo-jobs/job-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');

    const provider = photoProviderConfig();
    const summary = await photoJobSummary();
    const r2Configured = hasR2Config();
    const publicBaseUrlConfigured = Boolean(process.env.R2_PUBLIC_BASE_URL);
    const paused = summary.paused ?? 0;

    const blockers: string[] = [];
    if (!provider.configured) {
      blockers.push(`Photo provider credentials missing: ${provider.missing.join(', ')}`);
    }
    if (!r2Configured) {
      // The one blocker that stops the feature rather than degrading it: the
      // runner refuses to write a composite with no bucket, so every job would
      // fail at the store step and land on the retry ladder.
      blockers.push('R2 is not configured — composited output cannot be stored or presigned for the provider');
    }
    if (r2Configured && !publicBaseUrlConfigured) {
      blockers.push(
        'R2_PUBLIC_BASE_URL is empty — composited output is published through a signed URL that expires, so a cached page can outlive it',
      );
    }
    if (paused > 0) {
      blockers.push(`${paused} paused job(s) exhausted their retries and need operator review`);
    }

    return successResponse({
      provider: {
        configured: provider.configured,
        name: provider.name,
        // A cloud name is a public identifier: it is inside every delivery URL
        // the app already hands to anonymous voters. Naming it here tells an
        // operator which account the feature will actually call.
        cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? null,
        cloudNamePresent: !provider.missing.includes('CLOUDINARY_CLOUD_NAME'),
        missingEnv: provider.missing,
        extractionProbe: 'not_attempted',
        moderationProbe: 'not_attempted',
        probeNote:
          "The two vendor probes need a test asset the operator chooses. They are not run from this page: a diagnostic must not spend a paid call on a photograph nobody queued, and an add-on that is not enabled answers unknown rather than ok.",
      },
      storage: {
        r2Configured,
        publicBaseUrlConfigured,
        // What the runner's own first step needs: a URL the vendor can fetch for
        // an object that lives in a private bucket.
        presignForProvider: r2Configured ? 'available' : 'unavailable',
      },
      jobs: {
        queued: summary.queued ?? 0,
        processing: summary.processing ?? 0,
        paused,
        // Rows currently sitting on the retry ladder, not a time window: the
        // migration's summary function counts statuses, and inventing
        // `failedRecently` here would mean a number nothing computes.
        failed: summary.failed ?? 0,
      },
      blockers,
    });
  } catch (error) {
    // No special cases here: `handleApiError` already turns the FORBIDDEN and
    // UNAUTHORIZED sentinel errors from the admin gate into 403 and 401, and a
    // local branch for one of them would be a second policy for the same answer.
    return handleApiError(error, 'Failed to read photo configuration');
  }
}
