/**
 * Turn the admin song route's answer into an address this browser can play.
 *
 * `GET /api/admin/open-mic/submissions/<id>/song` returns one field, `signedUrl`,
 * and it is one of two shapes depending on how the web app is deployed
 * (frontend-web/app/api/admin/open-mic/submissions/[id]/song/route.ts:17-37):
 *
 *  • an ABSOLUTE URL — an R2 presigned GET when a bucket is configured, or the
 *    legacy absolute `songUrl` stored on the entry. The browser fetches the
 *    bucket directly; nothing passes through admin, so seeking works and no
 *    proxy is involved.
 *  • a ROOT-RELATIVE path — `/api/open-mic/songs/<id>`, which is what local
 *    development gets, because there is no bucket to sign against and the
 *    public reader serves the file off disk.
 *
 * The second shape is the one this module exists for. A root-relative path is
 * relative to *frontend-web's* origin; frontend-admin runs on its own port
 * (:3001), so handing `/api/open-mic/songs/x` straight to an <audio> element
 * asks the admin console for a route it does not have and the player dies with
 * a 404. Prefixing the web proxy base — the same Path A transport every Open Mic
 * read in openMicAdminService.ts already uses — sends it to the web app, whose
 * reader answers with the bytes.
 *
 * Anything that is neither absolute nor root-relative is refused rather than
 * guessed at. The value comes from our own server, but a `<audio src>` is still
 * a fetch the browser will make, and `blob:`, `data:` or a bare relative
 * `songs/x` are not addresses this console can mean.
 */

/** True for `http://` and `https://` only — the schemes a media element may load. */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * @param signedUrl the route's raw `signedUrl`, any shape or empty.
 * @param proxyBase `webProxyBase()`, e.g. `http://localhost:3001/api/web-proxy`.
 * @returns a URL to put in `src`/`href`, or null when there is nothing playable.
 */
export function playableSongSrc(
  signedUrl: string | null | undefined,
  proxyBase: string,
): string | null {
  const value = String(signedUrl ?? '').trim();
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  if (!value.startsWith('/')) return null;
  const base = String(proxyBase ?? '').trim().replace(/\/+$/, '');
  if (!isHttpUrl(base)) return null;
  return `${base}${value}`;
}
