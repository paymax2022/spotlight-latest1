/**
 * Reading the bytes behind a template's stored image URL (spec §5).
 *
 * The URL in `contest_templates.template_url` is written by the admin create route
 * as a public Storage object on this project's own origin, and before this module
 * every reader of it either degraded silently or threw. The trust rule is NOT
 * duplicated here — `isAllowedRemoteImageUrl` owns it, so the job runner, the
 * compositor and this reader cannot drift about what a template URL may be. What
 * this file adds is the part a boolean cannot express: which shape a value was,
 * and therefore what an operator should do about it.
 *
 * The reason strings are load-bearing rather than cosmetic. They land in
 * `photo_jobs.render_params.blend.error` and in the studio preview's response
 * body, where "the bytes could not be read" told nobody whether the row, the
 * bucket, or the network was at fault — and those three have completely different
 * fixes (edit the template, re-upload it, wait).
 */
import {
  PUBLIC_OBJECT_PATH_PREFIX,
  TEMPLATE_STORAGE_BUCKETS,
  configuredSupabaseOrigin,
  isAllowedRemoteImageUrl,
} from '@/lib/config';

export type TemplateReadFailure =
  | 'empty'
  | 'not-a-url'
  | 'credentials-in-url'
  | 'host-not-allowed'
  | 'bucket-not-allowed'
  | 'not-a-storage-object'
  | 'not-fetchable'
  | 'http-status'
  | 'redirected-off-origin';

export type TemplateImagePlan =
  | { kind: 'storage'; bucket: string; key: string }
  | { kind: 'remote' }
  | { kind: 'refused'; reason: TemplateReadFailure };

export type TemplateImageRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: TemplateReadFailure; status?: number };

/** Split `/storage/v1/object/public/<bucket>/<key>` into its two parts. */
function publicObject(pathname: string): { bucket: string; key: string } | null {
  if (!pathname.startsWith(PUBLIC_OBJECT_PATH_PREFIX)) return null;
  const rest = pathname.slice(PUBLIC_OBJECT_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

const allowlistedBucket = (bucket: string): boolean =>
  (TEMPLATE_STORAGE_BUCKETS as readonly string[]).includes(bucket);

/**
 * No network: what would happen if this value were read, and why it would not.
 * The admin configuration surface calls this to census the templates it already
 * has without waiting on the storage service.
 */
export function templateImagePlan(value: string | null | undefined): TemplateImagePlan {
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'refused', reason: 'empty' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { kind: 'refused', reason: 'not-a-url' };
  }

  const trusted = configuredSupabaseOrigin();
  const sameOrigin = trusted !== null && parsed.origin === trusted;
  const object = publicObject(parsed.pathname);

  if (!isAllowedRemoteImageUrl(value)) {
    // Name the closest true cause, in the order an operator can act on it.
    if (parsed.username || parsed.password) return { kind: 'refused', reason: 'credentials-in-url' };
    if (sameOrigin && object && !allowlistedBucket(object.bucket)) {
      return { kind: 'refused', reason: 'bucket-not-allowed' };
    }
    if (sameOrigin && !object) return { kind: 'refused', reason: 'not-a-storage-object' };
    return { kind: 'refused', reason: 'host-not-allowed' };
  }

  if (sameOrigin && object && allowlistedBucket(object.bucket)) {
    return { kind: 'storage', bucket: object.bucket, key: object.key };
  }
  return { kind: 'remote' };
}

/**
 * Fetch the bytes a template row names, or explain why it will not.
 *
 * A caller that only needs "did it work" can collapse the reason into its own
 * degrade record; a caller writing that record should include it, because
 * §10's degrade is otherwise indistinguishable from a misconfigured row.
 */
export async function readTemplateImage(value: string | null | undefined): Promise<TemplateImageRead> {
  const plan = templateImagePlan(value);
  if (plan.kind === 'refused') return { ok: false, reason: plan.reason };

  let response: Response;
  try {
    response = await fetch(value as string, { cache: 'no-store', redirect: 'follow' });
  } catch (err) {
    console.warn(`[template-image] fetch threw: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'not-fetchable' };
  }
  if (!response.ok) return { ok: false, reason: 'http-status', status: response.status };
  // `follow` means the guard ran against the URL we asked for, not the one we
  // landed on. Re-checking the final URL is what stops an editable row from
  // becoming a redirect primitive into a host this app has decided not to trust.
  if (response.url && !isAllowedRemoteImageUrl(response.url)) return { ok: false, reason: 'redirected-off-origin' };

  return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
}
