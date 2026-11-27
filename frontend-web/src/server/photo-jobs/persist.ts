/**
 * Storing a rendered image — the write half of the pipeline (spec §11).
 *
 * Deliberately returns the object KEY, not a URL. The existing
 * `photo-pipeline.ts` helper returns a public URL because that is all a
 * synchronous response needs; an asset row that has to outlive the request
 * needs the key, from which a URL (public or signed) is derived at read time.
 * Recording a derived value as the reference is what makes references rot, so
 * the two are kept as separate functions with different names rather than one
 * function with a flag.
 *
 * Throws on any failure. In P1 the only caller is the job runner, where a
 * storage fault is a retryable job failure on the normal backoff ladder — and
 * swallowing it into a `null` would mean a job that looks finished while the
 * bytes it points at were never written.
 */
import { randomUUID } from 'crypto';
import { hasR2Config, uploadR2Object } from '@/src/lib/storage/r2';

/**
 * Every prefix under which this feature writes a *rendered* portrait.
 *
 * Naming them here — beside the one function that builds the key — is what
 * lets `presentation.ts` recognise output when it finds it stored as if it
 * were input. `composited` is what the superseded synchronous pipeline and
 * the job runner both write; `preview` and `thumbnail` are the variant names
 * `runner.ts` renders from the final; `transparent` is reserved for the
 * cutout asset kind in spec §11.
 */
export const RENDERED_PHOTO_PREFIXES = ['composited', 'preview', 'thumbnail', 'transparent'] as const;

/** Same layout `photo-pipeline.ts` has always used, so composites from both
 *  code paths land in one place instead of two near-identical prefixes. */
export function photoObjectKey(mimeType: string, prefix: string): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  return `contestants/${prefix}/${randomUUID()}.${ext}`;
}

export async function storePhoto(buffer: Buffer, mimeType: string, prefix: string): Promise<string> {
  if (!hasR2Config()) throw new Error('R2 storage is not configured');
  const key = photoObjectKey(mimeType, prefix);
  await uploadR2Object({ key, body: buffer, contentType: mimeType });
  return key;
}
