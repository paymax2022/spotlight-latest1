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

/**
 * Admin contest-template frames — `app/api/admin/voting/contest-templates`.
 *
 * NOT a number this route invented: it is the `file_size_limit` the bucket was
 * created with in supabase/migrations/20260405700000_contest_image_templates.sql
 * (52 428 800 bytes = exactly 50 MiB). Without checking it here, an over-limit
 * frame still travelled the whole way — browser → admin web-proxy → this route →
 * storage — and only then came back as one indistinguishable sentence.
 * tests/unit/voting/contest-template-bucket-policy.spec.ts fails if the two
 * drift apart.
 */
export const MAX_CONTEST_TEMPLATE_UPLOAD_MB = 50;

export const MAX_CONTEST_TEMPLATE_UPLOAD_BYTES = MAX_CONTEST_TEMPLATE_UPLOAD_MB * 1024 * 1024;
