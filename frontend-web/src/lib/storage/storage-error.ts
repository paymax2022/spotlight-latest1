/**
 * Turning a Supabase Storage rejection into something an admin can act on.
 *
 * WHY THIS EXISTS — report 2026-11-25, `/admin/voting/templates`: uploading a
 * frame PNG answered `Failed to upload template image`, a 500 with no reason.
 * The upload had failed because the storage service was not reachable at all
 * (`docker stop supabase_storage_spotlight` reproduces it), and the route knew
 * that — it logged it — then threw the information away. Same shape as #1173:
 * correct decision, unreadable answer.
 *
 * The trap this exists to avoid re-discovering: a `StorageApiError` from the
 * storage API reports `status: 400` for an oversize file, a refused mime type, a
 * missing bucket AND a duplicate key. The HTTP code that actually distinguishes
 * them is `statusCode`, and it is a STRING. `error.status` alone cannot tell you
 * whether the admin picked a 60 MB image or whether nobody applied the bucket
 * migration, which is exactly why all four collapsed into one sentence.
 *
 * Rules, in priority order:
 *   1. `code` (a stable machine value) when storage sent one;
 *   2. `statusCode` / `status` when it sent only numbers;
 *   3. the message, for the transport faults that never got an HTTP answer
 *      (`fetch failed`, Kong's `name resolution failed`);
 *   4. otherwise a generic 500 that does NOT repeat upstream text — the same
 *      reason `app/api/registration/uploads` refuses to echo fs and AWS SDK
 *      errors: those carry bucket names and absolute paths.
 *
 * The raw upstream message is still worth keeping for whoever debugs this, so
 * every caller is expected to `console.error` it; that is what the route does.
 */

import { MAX_CONTEST_TEMPLATE_UPLOAD_MB } from './upload-limits';

export type StorageFailureVerdict = {
  /** The HTTP status the route should answer with. */
  status: number;
  /** Stable machine-readable reason, safe to switch on. */
  code: string;
  /** Client-facing sentence. Never contains upstream text. */
  message: string;
};

export type StorageFailureContext = {
  /** Bucket the upload targeted, used only where the bucket itself is the problem. */
  bucket: string;
  /** What was being uploaded, for the sentence: 'template image'. */
  subject: string;
  /** The bucket's own size limit, in MB, so the advice matches reality. */
  maxMb?: number;
  /** Formats the bucket accepts, named when the bucket rejected the type. */
  formats?: string[];
};

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Fields supabase-js puts on a StorageApiError; an ordinary Error has none. */
function errorShape(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { code: '', statusCode: 0, status: 0, message: typeof error === 'string' ? error : '' };
  }
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === 'string' ? e.code : '',
    statusCode: asNumber(e.statusCode),
    status: asNumber(e.status),
    message: e instanceof Error ? e.message : typeof e.message === 'string' ? e.message : '',
  };
}

const TRANSPORT_RE =
  /(failed to fetch|fetch failed|network|socket hang up|timeout|timed out|econnrefused|econnreset|upstream|name resolution|enotfound)/i;

const POLICY_RE = /(row-level security|permission denied|not authorized|policy)/i;

const SIZE_RE = /(exceed|maximum allowed size|too large|payload too)/i;

const MIME_RE = /(mime|content type|file type|not supported)/i;

const BUCKET_RE = /(bucket not found|bucket .* does not exist|invalid bucket)/i;

const DUPLICATE_RE = /(already exists)/i;

/**
 * Classify one storage failure.
 *
 * Deliberately returns a verdict instead of throwing: the route that catches the
 * error still has to decide between `errorResponse(...)` and `handleApiError`.
 */
export function describeStorageFailure(
  error: unknown,
  ctx: StorageFailureContext,
): StorageFailureVerdict {
  const { code, statusCode, status, message } = errorShape(error);
  const maxMb = ctx.maxMb ?? MAX_CONTEST_TEMPLATE_UPLOAD_MB;
  const formats = ctx.formats?.length ? ` Use ${ctx.formats.join(', ')}.` : '';

  // 1. Machine codes, the only part of the response the storage API guarantees.
  if (code === 'EntityTooLarge') {
    return {
      status: 413,
      code: 'storage_too_large',
      message: `This ${ctx.subject} is larger than the ${maxMb}MB limit for the ${ctx.bucket} bucket.`,
    };
  }
  if (code === 'InvalidMimeType') {
    return {
      status: 400,
      code: 'storage_type_rejected',
      message: `The ${ctx.bucket} bucket does not accept this ${ctx.subject}'s file type.${formats}`,
    };
  }
  if (code === 'NoSuchBucket') {
    return {
      status: 500,
      code: 'storage_bucket_missing',
      message:
        `The ${ctx.bucket} image bucket does not exist in this environment, so nothing could be ` +
        'uploaded. Its storage migration has not been applied.',
    };
  }
  if (code === 'KeyAlreadyExists') {
    return {
      status: 409,
      code: 'storage_duplicate',
      message: `An image with that name is already stored. Try uploading again — each upload gets a new name.`,
    };
  }

  // 2. Numbers only: the service answered, so trust the status it answered with.
  const http = statusCode || status;
  if (http >= 500) {
    return unreachable(ctx);
  }
  if (http === 413) {
    return {
      status: 413,
      code: 'storage_too_large',
      message: `This ${ctx.subject} is larger than the ${maxMb}MB limit for the ${ctx.bucket} bucket.`,
    };
  }
  if (http === 404 && BUCKET_RE.test(message)) {
    return {
      status: 500,
      code: 'storage_bucket_missing',
      message:
        `The ${ctx.bucket} image bucket does not exist in this environment, so nothing could be ` +
        'uploaded. Its storage migration has not been applied.',
    };
  }

  // 3. No usable status: the request never got an HTTP answer, or storage sent a
  //    bare 400 whose meaning is only in the sentence.
  if (TRANSPORT_RE.test(message)) return unreachable(ctx);
  if (POLICY_RE.test(message)) {
    return {
      status: 500,
      code: 'storage_policy_refused',
      message:
        `Image storage refused the server's upload permissions for the ${ctx.bucket} bucket. ` +
        'This is a storage policy or credentials problem, not the file.',
    };
  }
  if (SIZE_RE.test(message)) {
    return {
      status: 413,
      code: 'storage_too_large',
      message: `This ${ctx.subject} is larger than the ${maxMb}MB limit for the ${ctx.bucket} bucket.`,
    };
  }
  if (MIME_RE.test(message)) {
    return {
      status: 400,
      code: 'storage_type_rejected',
      message: `The ${ctx.bucket} bucket does not accept this ${ctx.subject}'s file type.${formats}`,
    };
  }
  if (DUPLICATE_RE.test(message)) {
    return {
      status: 409,
      code: 'storage_duplicate',
      message: `An image with that name is already stored. Try uploading again — each upload gets a new name.`,
    };
  }

  // 4. Unknown. Say so, without repeating what upstream wrote.
  return {
    status: 500,
    code: 'storage_upload_failed',
    message: `Uploading the ${ctx.subject} to image storage failed. Try again; if it keeps failing, image storage is unavailable.`,
  };
}

function unreachable(ctx: StorageFailureContext): StorageFailureVerdict {
  return {
    status: 502,
    code: 'storage_unreachable',
    message:
      `The image storage service could not be reached, so the ${ctx.subject} was not uploaded. ` +
      'Try again in a moment — if it keeps failing, storage for this environment is down.',
  };
}
