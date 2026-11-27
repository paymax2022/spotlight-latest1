// One rule for every contestant picture this app draws.
//
// The stored `contestants.photo_url` is not an address a phone can open: it is the
// registration upload response, that response's private preview route, or a pasted
// external URL. Resolving those three shapes is the API's job, and since #1172
// `backend/internal/connect/voting/contestant_photo.go` does it by naming
// frontend-web's reader (`/api/v1/contestants/<id>/photo`) — the plane that holds the
// bytes, bucket or its own disk. What reaches the phone is therefore one of:
//
//   https://<web origin>/api/v1/contestants/<id>/photo   deployment has a media base
//   /api/v1/contestants/<id>/photo                       …and has not
//   https://external.example/a.jpg                       admin pasted one
//   ''                                                   nothing renderable
//
// The second shape is the one that silently produces a blank hero: handed to
// `<Image source={{uri}}>` as-is it resolves against the bundle's own origin, which
// serves JS, not JPEGs. Same defect class the song URL beside it already avoids by
// going through `mediaUrl()`, and the same fix — the reader adds its origin, and so
// does whoever reads a path.
//
// `''` and a value that is neither a URL nor a root-relative path (a raw
// `registration/<id>/…` key, a half-written upload blob) resolve to `undefined`, and
// `undefined` is the screen's signal to draw its initials placeholder. A broken image
// is not a valid answer to "what does this contestant look like"; the placeholder is.

import { absolutise, isAbsoluteUrl, isPlayableHttpUrl } from '@/features/openmic/absolute-url';

/**
 * A wire photo value → a URL `<Image>` can load, or `undefined` for the placeholder.
 *
 * `origin` is the web app origin this device can reach — `appOrigin()` from
 * `@/features/openmic/media`, which already rewrites loopback to the Metro host so a
 * handset is not sent to its own `localhost`. Passed in rather than read here keeps
 * the rule pure, so `node --test` can pin it: `@/features/openmic/media` needs
 * expo-constants and cannot load under the unit runner.
 */
export function contestantPhotoUri(
  value: string | null | undefined,
  origin: string,
): string | undefined {
  const stored = String(value ?? '').trim();
  if (!stored) return undefined;
  // An object key or an upload blob is not a location. Gluing the origin onto a
  // `registration/…` key would invent a route no plane serves and hide the reason
  // the row has no picture.
  if (!isAbsoluteUrl(stored) && !stored.startsWith('/')) return undefined;
  const uri = absolutise(origin, stored);
  return uri && isPlayableHttpUrl(uri) ? uri : undefined;
}
