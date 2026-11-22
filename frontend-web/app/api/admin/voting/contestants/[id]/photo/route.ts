import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { serveContestantPhoto } from '@/src/lib/storage/contestant-photo';
import { assertAdminPermission } from '@/src/server/admin/auth';

/**
 * The contestant photo, for the admin console.
 *
 * `GET /api/v1/contestants/:id` (Go) hands the console a presigned R2 GET built
 * from `contestants.photo_url`. That is the right answer wherever the uploads
 * actually live in the bucket, and the wrong one everywhere they do not: the
 * registration flow falls back to this app's local disk when no R2 credentials
 * are configured, so the signature is valid, the object is absent, and the
 * console shows a broken image (`backend/internal/connect/voting/contestant_photo.go`
 * has no way to know either way — it cannot see this filesystem).
 *
 * So the console asks the plane that stores the files. It reads the raw column
 * — the blob the upload route returned, its previewUrl, or a pasted external
 * URL — and answers through `serveContestantPhoto`: local bytes, a redirect to a
 * presigned GET whose object it has confirmed exists, a redirect to the external
 * URL, or a 404 the caller can render as its placeholder.
 *
 * Gated, not public: the key lives under `registration/<userId>/`, the same
 * prefix a member's identity documents live under, and `readLocalUpload` would
 * happily return any file in that tree. Only the stored row can name a key here,
 * but the gate is what keeps a contestant's photo — an image they uploaded for a
 * competition, not a marketing asset — behind an operator rather than anyone who
 * has the id. `dashboard:view` is every admin role's read permission, matching
 * `app/api/admin/reality-show/contestants/[id]/route.ts`; the roster page this
 * serves is already gated at the same level.
 *
 * Deliberately no status filter: `app/api/v1/contestants/[id]` 404s a pending
 * contestant because the roster is public, but an operator reviewing an
 * application has to see the picture they are deciding about.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: contestantId } = await context.params;
  try {
    await assertAdminPermission(request, 'dashboard:view');

    // contestants.id is uuid: a malformed value reaches Postgres as 22P02 and
    // comes back a 500, so it is refused here (same guard as the reader above).
    if (!UUID_RE.test(contestantId)) {
      return errorResponse('Invalid contestant ID', 400);
    }

    const { data, error } = await createAdminClient()
      .from('contestants')
      .select('photo_url')
      .eq('id', contestantId)
      .maybeSingle();
    if (error) throw error;

    return await serveContestantPhoto((data as { photo_url?: string } | null)?.photo_url);
  } catch (error) {
    return handleApiError(error, 'Failed to load contestant photo');
  }
}
