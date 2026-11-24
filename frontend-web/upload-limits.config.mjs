/**
 * The one server-wide multipart body limit, kept out of next.config.mjs so it
 * can be unit-tested without pulling in @sentry/nextjs/config (the same reason
 * security-headers.config.mjs exists).
 *
 * Next clones every request body so middleware can read it, and caps that clone
 * at `experimental.proxyClientMaxBodySize` — 10 MiB (`config-shared.js`
 * `proxyClientMaxBodySize: 10485760`) if this is not set. Above the cap Next
 * does not answer 413: it ends the stream early, the handler receives a
 * truncated body, and `request.formData()` fails as if the request had never
 * been multipart at all. That is how a 20 MB registration attachment turned
 * into `415 Expected multipart/form-data`.
 *
 * The value has to clear the LARGEST cap any upload route declares, plus
 * multipart framing:
 *
 *   registration/uploads   100 MiB  src/lib/storage/upload-limits.ts
 *   open-mic songs/beats    50 MiB  src/features/openmic/song-storage.ts
 *   crowdfunding uploads   8/15 MiB app/api/crowdfunding/uploads/**
 *   contest banner          8 MiB   app/api/admin/contests/banner/route.ts
 *
 * tests/unit/registration/upload-body-limit.spec.ts asserts that relationship,
 * so raising a route cap without raising this one goes red in CI.
 */

export const MAX_MULTIPART_BODY_MB = 110;

/** Bytes, for the spec that compares it against the route caps. */
export const MAX_MULTIPART_BODY_BYTES = MAX_MULTIPART_BODY_MB * 1024 * 1024;

/** The form Next parses (`bytes()`); a bare number is accepted too, a string is self-documenting. */
export const MAX_MULTIPART_BODY_SIZE = `${MAX_MULTIPART_BODY_MB}mb`;
