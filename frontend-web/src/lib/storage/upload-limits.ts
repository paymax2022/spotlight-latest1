/**
 * Upload size caps that the SERVER has to be able to receive.
 *
 * Each upload route decides what it accepts, but the bytes still have to reach
 * the route intact: Next clones every request body for the middleware layer and
 * truncates the clone at `experimental.proxyClientMaxBodySize`
 * (10 MiB by default). A cap declared in a route handler above that limit is
 * therefore a lie — the body arrives cut off, `request.formData()` throws, and
 * the applicant sees a failed upload. `upload-limits.config.mjs` (read by
 * next.config.mjs, which cannot import TypeScript) sets the server-wide limit,
 * and tests/unit/registration/upload-body-limit.spec.ts fails if the two drift
 * apart again.
 */

/** Registration attachments: photos, CAC documents, pitch decks, audition media. */
export const MAX_REGISTRATION_UPLOAD_MB = 100;

export const MAX_REGISTRATION_UPLOAD_BYTES = MAX_REGISTRATION_UPLOAD_MB * 1024 * 1024;
