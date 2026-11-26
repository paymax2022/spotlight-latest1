import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { serveContestantPhoto } from '@/src/lib/storage/contestant-photo';

/**
 * The contestant photo, for everyone who is not the uploader.
 *
 * THE DEFECT
 * `contestants.photo_url` holds what the registration upload route returned: a
 * JSON blob, that blob's private `previewUrl`, or a pasted external URL. The Go
 * voting API used to resolve the first two by signing the object key against R2
 * and handing voters that signature (`internal/connect/voting/contestant_photo.go`).
 * That works only when the bucket actually has the bytes — and the upload route
 * writes to R2 only when THIS app has credentials, otherwise to its own disk
 * (`src/lib/storage/local-uploads.ts`). So on any deployment without R2 secrets
 * the API produced a valid signature for an object that never arrived: 404
 * NoSuchKey, and a contestant profile with no picture. The admin console already
 * fixed this by asking the plane that stores the files
 * (`app/api/admin/voting/contestants/[id]/photo/route.ts`); voters needed the
 * same answer without needing to be an operator.
 *
 * THE RULE
 * The photo's bytes come from this app, through its reader, and the API names the
 * reader — the arrangement contest banners (`/api/admin/contests/banner/`) and
 * Open Mic songs (`/api/open-mic/songs/`) already use. `serveContestantPhoto`
 * then answers three ways: a redirect to a presigned GET whose object it has
 * confirmed, the local bytes, or a 404 the caller renders as its initials
 * placeholder.
 *
 * Why this one is open while the console route is gated: the roster is public, so
 * the picture a voter is being asked to vote on is public product content — and
 * it is already handed to every anonymous caller of the public roster today.
 * What stays protected is the key: it comes from the row read by this route, never
 * from the request, so nobody can aim this reader at the identity documents that
 * share the `registration/<userId>/` prefix. A contestant that is not on a public
 * roster answers 404, not 403, so the route does not confirm that an application
 * exists.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestantId } = await context.params;
    // contestants.id is uuid: a malformed value reaches Postgres as 22P02 and
    // comes back a 500, so it is refused here (same guard as the detail route).
    if (!UUID_RE.test(contestantId)) {
      return errorResponse('Invalid contestant ID', 400);
    }

    const { data, error } = await createAdminClient()
      .from('contestants')
      .select('photo_url, status')
      .eq('id', contestantId)
      // The same visibility gate app/api/v1/contestants/[id] applies: only a
      // contestant on the public roster has a public picture.
      .in('status', ['approved', 'active'])
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorResponse('Contestant not found', 404);

    return await serveContestantPhoto((data as { photo_url?: string } | null)?.photo_url);
  } catch (error) {
    return handleApiError(error, 'Failed to load contestant photo');
  }
}
