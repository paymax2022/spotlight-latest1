/**
 * `describeStorageFailure` — the classifier behind "Failed to upload template
 * image" being a dead end (report 2026-11-25, /admin/voting/templates).
 *
 * The shapes below are MEASURED, not imagined: each is the exact object
 * `supabase.storage.from('contest-templates').upload()` rejected with against a
 * local Supabase (CLI 2.98.1), produced by /tmp/probe-storage-errors.mjs —
 * 52 MB against the bucket's 52 428 800-byte limit, `image/gif` against its
 * mime allowlist, a bucket name that does not exist, the same key twice with
 * `upsert: false`, and the storage container stopped (`docker stop
 * supabase_storage_spotlight`) so Kong had no upstream.
 *
 * The trap this pins: supabase-js reports `status: 400` for four of those five
 * while the real HTTP code sits in `statusCode` as a STRING. A classifier that
 * read `error.status` would call an oversize file, a refused mime type, a
 * missing bucket and a duplicate key the same undifferentiated 400 — which is
 * how a 50 MB PNG and an unapplied migration both ended up as one useless
 * sentence in the console.
 */
import { describe, it, expect } from 'vitest';
import { describeStorageFailure } from '@/src/lib/storage/storage-error';
import { MAX_CONTEST_TEMPLATE_UPLOAD_MB } from '@/src/lib/storage/upload-limits';

/** Exactly what supabase-js threw for a 52 MB upload into a 50 MB bucket. */
const TOO_LARGE = {
  name: 'StorageApiError',
  message: 'The object exceeded the maximum allowed size',
  status: 400,
  statusCode: '413',
  code: 'EntityTooLarge',
};
/** `image/gif`, which the contest-templates bucket policy does not list. */
const BAD_MIME = {
  name: 'StorageApiError',
  message: 'mime type image/gif is not supported',
  status: 400,
  statusCode: '415',
  code: 'InvalidMimeType',
};
/** A bucket this environment has no migration for. */
const NO_BUCKET = {
  name: 'StorageApiError',
  message: 'Bucket not found',
  status: 400,
  statusCode: '404',
  code: 'NoSuchBucket',
};
/** Same key twice with `upsert: false`. */
const DUPLICATE = {
  name: 'StorageApiError',
  message: 'The resource already exists',
  status: 400,
  statusCode: '409',
  code: 'KeyAlreadyExists',
};
/** The storage container stopped: Kong has no upstream to proxy to. */
const UPSTREAM_DEAD = {
  name: 'StorageApiError',
  message: 'An invalid response was received from the upstream server',
  status: 502,
  statusCode: '502',
};
/** The storage service removed entirely: Kong cannot resolve its hostname. */
const DNS_DEAD = {
  name: 'StorageApiError',
  message: 'name resolution failed',
  status: 503,
  statusCode: '503',
};

const opts = { bucket: 'contest-templates', subject: 'template image', maxMb: MAX_CONTEST_TEMPLATE_UPLOAD_MB };

describe('describeStorageFailure', () => {
  it('classifies by statusCode, not by the status field that says 400 for everything', () => {
    const oversize = describeStorageFailure(TOO_LARGE, opts);
    const mime = describeStorageFailure(BAD_MIME, opts);
    const missing = describeStorageFailure(NO_BUCKET, opts);
    const dupe = describeStorageFailure(DUPLICATE, opts);

    // All four arrive with `status: 400`. Four different verdicts go out.
    expect([TOO_LARGE, BAD_MIME, NO_BUCKET, DUPLICATE].every((e) => e.status === 400)).toBe(true);
    expect(oversize.status).toBe(413);
    expect(mime.status).toBe(400);
    expect(missing.status).toBe(500);
    expect(dupe.status).toBe(409);
    expect(new Set([oversize.code, mime.code, missing.code, dupe.code]).size).toBe(4);
  });

  it('names the size limit in the number, so the admin knows what to do', () => {
    expect(describeStorageFailure(TOO_LARGE, opts).message).toMatch(/50MB/);
    expect(describeStorageFailure(TOO_LARGE, opts).code).toBe('storage_too_large');
  });

  it('accepts the string statusCode a real StorageApiError carries, not only a number', () => {
    expect(describeStorageFailure({ ...TOO_LARGE, statusCode: '413' }, opts).status).toBe(413);
    expect(describeStorageFailure({ ...TOO_LARGE, statusCode: 413 }, opts).status).toBe(413);
  });

  it('tells a dead storage service apart from a bad file — the report this came from', () => {
    for (const dead of [UPSTREAM_DEAD, DNS_DEAD]) {
      const verdict = describeStorageFailure(dead, opts);
      expect(verdict.status).toBe(502);
      expect(verdict.code).toBe('storage_unreachable');
      // Must not blame the admin's file, and must name what is actually wrong.
      expect(verdict.message).toMatch(/storage service/i);
      expect(verdict.message).not.toMatch(/file type|too large|limit/i);
    }
  });

  it('says the bucket is missing rather than “upload failed” when the migration has not run', () => {
    const verdict = describeStorageFailure(NO_BUCKET, opts);
    expect(verdict.code).toBe('storage_bucket_missing');
    expect(verdict.message).toMatch(/contest-templates/);
  });

  it('refuses to echo an upstream message it does not understand', () => {
    const surprise = { message: 's3://internal-bucket-91/tenants/acme rejected multipart part 4' };
    const verdict = describeStorageFailure(surprise, opts);
    expect(verdict.status).toBe(500);
    expect(verdict.code).toBe('storage_upload_failed');
    expect(verdict.message).not.toMatch(/s3|acme|multipart part/);
  });

  it('survives the errors that are not objects at all', () => {
    for (const junk of [undefined, null, 'boom', new Error('fetch failed')]) {
      const verdict = describeStorageFailure(junk, opts);
      expect(verdict.status).toBeGreaterThanOrEqual(400);
      expect(typeof verdict.message).toBe('string');
      expect(typeof verdict.code).toBe('string');
    }
    // A bare fetch rejection is the network, not the file.
    expect(describeStorageFailure(new Error('fetch failed'), opts).code).toBe('storage_unreachable');
  });
});
