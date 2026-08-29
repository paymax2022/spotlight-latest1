// Turning a YouTube watch URL into something embeddable.
//
// The curriculum stores ordinary watch URLs because that is what a human pastes.
// Playing one inline needs the /embed/ form, so the id is extracted here rather
// than at each call site.
//
// Every URL in the seeded pathway was verified through YouTube's oEmbed endpoint,
// which resolves ONLY for videos that are live AND embeddable — so an oEmbed pass
// is also a guarantee that the inline player will work, not just that the link
// exists.

/** The 11-character video id, or null when this is not a recognisable YouTube URL. */
export function youtubeVideoId(url: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0];
    return isVideoId(id) ? id : null;
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;

  // /watch?v=<id>
  const v = u.searchParams.get('v');
  if (isVideoId(v)) return v;

  // /embed/<id>, /v/<id>, /shorts/<id>, /live/<id>
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['embed', 'v', 'shorts', 'live'].includes(parts[0])) {
    return isVideoId(parts[1]) ? parts[1] : null;
  }

  return null;
}

/** A playlist id, for URLs that address a playlist rather than one video. */
export function youtubePlaylistId(url: string): string | null {
  try {
    const list = new URL(url.trim()).searchParams.get('list');
    return list && /^[A-Za-z0-9_-]{10,}$/.test(list) ? list : null;
  } catch {
    return null;
  }
}

function isVideoId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * The URL to load in the inline player, or null when the link cannot be embedded.
 *
 * Uses youtube-nocookie.com: it serves the same player without setting tracking
 * cookies until playback starts, which is the right default for a learner who is
 * only reading the lesson.
 *
 * `playsinline=1` matters on iOS — without it a tap hands the video to the system
 * full-screen player, which is exactly the "leaves the app" behaviour being fixed.
 */
export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeVideoId(url);
  if (id) {
    return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1`;
  }
  const list = youtubePlaylistId(url);
  if (list) {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&playsinline=1&rel=0`;
  }
  return null;
}
