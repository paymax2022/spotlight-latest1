// The device-side half of URL resolution.
//
// `absolute-url.ts` holds the rules and stays importable by `node --test`; this
// module supplies the one thing only a running app knows — the origin a *phone*
// can reach. `resolveApiBaseUrl()` hands back the configured web-app origin
// (`http://localhost:3000` in dev), and `getDevUrl()` rewrites that loopback to
// the Metro host so a handset or emulator can resolve it. Resolving a
// root-relative `/api/open-mic/…` path against anything else would either bake
// `localhost` into the player (dead on a device) or point at the Go host, which
// does not serve these routes.

import { getDevUrl } from '@/lib/devUrl';
import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';
import { absolutise, originOf, withDownloadFlag, withoutDownloadFlag } from './absolute-url';

/** Origin of the Next.js web app as this device can reach it, e.g. `http://192.168.1.9:3000`. */
export function appOrigin(): string {
  return originOf(getDevUrl(resolveApiBaseUrl()));
}

/**
 * A server-issued media path → a URL the phone can play or download.
 * Null and empty in, null out, so a caller renders "nothing published yet"
 * instead of a player pointed at the site's own HTML.
 */
export function mediaUrl(value: string | null | undefined): string | null {
  return absolutise(appOrigin(), value);
}

/**
 * The beat reader serves the bytes `inline` (for `<audio>`) unless asked for an
 * attachment, so a download is the same URL plus one flag — the same rule the
 * web applicant page follows.
 */
export function asDownload(value: string | null | undefined): string | null {
  const url = mediaUrl(value);
  return url ? withDownloadFlag(url) : null;
}

/**
 * The same reader URL without the attachment flag — what a player needs.
 *
 * Not the mirror image of `asDownload` for tidiness: the eligibility route falls
 * back to the beat's *download* URL when no preview URL is configured, and an
 * admin can store a flagged value in either column. Handing the player a URL the
 * reader answers with `Content-Disposition: attachment` is how a beat ends up
 * being saved when someone pressed play, so the play path strips the flag and the
 * save path adds it, and neither depends on which column the row filled.
 */
export function asPreview(value: string | null | undefined): string | null {
  const url = mediaUrl(value);
  return url ? withoutDownloadFlag(url) : null;
}
