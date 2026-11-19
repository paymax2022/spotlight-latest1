/**
 * The song reader every surface plays through: the web voting card, the admin
 * review panel, the contestant's own profile and the mobile app.
 *
 * It is public by design — a voter must be able to play a song without an account
 * — with one deliberate exception: a `draft` row (uploaded, not yet submitted) is
 * served only to the artist who owns it, so an applicant can listen back to what
 * they just handed in before pressing submit. A signed-out caller gets 404 rather
 * than 403, because "this song exists but you may not hear it" is information.
 *
 * Byte serving, range handling and the R2-versus-local-disk decision live in
 * `src/server/openmic/song-stream.ts` so the admin route cannot drift from it.
 */
import { isPubliclyPlayableSongStatus, isSongKeyForSubmission } from '@/src/features/openmic/song-storage';
import { createAdminClient } from '@/lib/supabase/server';
import { validateRequest } from '@/src/lib/auth/request';
import { SONG_CORS_HEADERS, buildSongResponse } from '@/src/server/openmic/song-stream';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const supabase = createAdminClient();

    // No status filter here: the owner-needs-auth case has to be distinguishable
    // from "no such song", which the filtered query used to collapse into one 404.
    const { data: row, error } = await supabase
      .from('competition_entries')
      .select('id, status, user_id, lyrical_concept_summary')
      .eq('id', id)
      .maybeSingle();

    if (error || !row) {
      return new Response('Not found', { status: 404, headers: SONG_CORS_HEADERS });
    }

    const status = String((row as { status?: string }).status || '').toLowerCase();
    const requester = await validateRequest(request);
    const isOwner = Boolean(requester.user && requester.user.id === (row as { user_id?: string }).user_id);
    if (!isPubliclyPlayableSongStatus(status) && !isOwner) {
      return new Response('Not found', { status: 404, headers: SONG_CORS_HEADERS });
    }

    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String((row as { lyrical_concept_summary?: string }).lyrical_concept_summary || '{}'));
    } catch {
      meta = {};
    }

    const objectKey = (meta.songObjectKey || meta.r2ObjectKey) as string | undefined;
    if (!objectKey || !isSongKeyForSubmission(objectKey, id)) {
      return new Response('Audio not available', { status: 404, headers: SONG_CORS_HEADERS });
    }

    return await buildSongResponse({
      objectKey,
      fileName: (meta.songFileName as string | undefined) || 'song.mp3',
      rangeHeader: request.headers.get('range'),
      // The admin panel's "Download" button and any share surface that offers a
      // save-file action use the same reader with `?download=1`.
      disposition: new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline',
    });
  } catch {
    return new Response('Internal error', { status: 500, headers: SONG_CORS_HEADERS });
  }
}
