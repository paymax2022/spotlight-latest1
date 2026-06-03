// Public song-streaming proxy — no auth required.
// Fetches the MP3 from R2 server-side and streams it to the browser,
// avoiding any CORS issue that would occur with a direct browser → R2 redirect.

import { createAdminClient } from '@/lib/supabase/server';
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD',
};

export async function GET(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;

  try {
    const supabase = createAdminClient();

    const { data: row, error } = await supabase
      .from('competition_entries')
      .select('id, status, lyrical_concept_summary')
      .eq('id', id)
      .in('status', ['submitted', 'published_for_voting', 'finalist', 'winner', 'live_for_voting'])
      .maybeSingle();

    if (error || !row) {
      return new Response('Not found', { status: 404, headers: CORS });
    }

    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse((row as any).lyrical_concept_summary || '{}'); } catch { /* ignore */ }

    const objectKey = (meta.songObjectKey || meta.r2ObjectKey) as string | undefined;
    const songFileName = (meta.songFileName as string | undefined) || 'song.mp3';

    if (!objectKey || !hasR2Config()) {
      return new Response('Audio not available', { status: 404, headers: CORS });
    }

    // Generate a short-lived signed URL, then fetch server-side and proxy the bytes
    const signedUrl = await createR2DownloadUrl({
      key: objectKey,
      fileName: songFileName,
      disposition: 'inline',
      expiresIn: 300,
    });

    // Support Range requests so the browser can seek
    const rangeHeader = request.headers.get('range');
    const r2Res = await fetch(signedUrl, {
      headers: rangeHeader ? { Range: rangeHeader } : {},
    });

    if (!r2Res.ok && r2Res.status !== 206) {
      return new Response('Audio fetch failed', { status: 502, headers: CORS });
    }

    const responseHeaders: Record<string, string> = {
      ...CORS,
      'Content-Type': r2Res.headers.get('content-type') || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
    };

    const contentLength = r2Res.headers.get('content-length');
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    const contentRange = r2Res.headers.get('content-range');
    if (contentRange) responseHeaders['Content-Range'] = contentRange;

    return new Response(r2Res.body, {
      status: r2Res.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response('Internal error', { status: 500, headers: CORS });
  }
}
