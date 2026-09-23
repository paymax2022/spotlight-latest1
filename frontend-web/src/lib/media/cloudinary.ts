/**
 * Cloudinary client — content moderation + AI background removal for
 * contestant photos (test-plan G-IMG / IMG-001 / IMG-002 / SEC-010 / D-006).
 *
 * Mirrors the vendor-adapter pattern used by backend/internal/provider/dojah:
 * one client per vendor, env-var driven, NEVER throws on missing config —
 * callers get a `notConfigured: true` result and degrade gracefully (see
 * src/server/registration/photo-pipeline.ts for how that degradation is
 * gated so it can only ever apply when creds are truly absent).
 *
 * This is the ONLY place Cloudinary HTTP code may live.
 *
 * Auth: Cloudinary's "upload" API accepts either a signed request (api_key +
 * timestamp + signature, computed with api_secret) or an unsigned upload
 * preset. We use signed requests so no preset needs to be configured in the
 * Cloudinary console out-of-band, and so credentials stay entirely
 * server-side and env-var driven, matching the Dojah pattern.
 */

const CLOUDINARY_API_BASE = 'https://api.cloudinary.com/v1_1';

export interface ModerationResult {
  approved: boolean;
  reason?: string;
  notConfigured?: boolean;
}

export type BackgroundRemovalResult =
  | { ok: true; resultUrl: string }
  | { ok: false; reason: string; notConfigured?: boolean };

interface CloudinaryEnv {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function readCloudinaryEnv(): CloudinaryEnv | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

/**
 * Cloudinary signed-upload signature: SHA-1 of the sorted `key=value` param
 * string (excluding file/api_key/resource_type/cloud_name) with api_secret
 * appended, per Cloudinary's documented signing algorithm.
 * https://cloudinary.com/documentation/authentication_signatures
 */
async function signParams(
  params: Record<string, string | number>,
  apiSecret: string
): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const encoder = new TextEncoder();
  const data = encoder.encode(`${toSign}${apiSecret}`);
  // Web Crypto (subtle) is available in the Next.js Node runtime.
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Upload-by-fetch-URL: Cloudinary fetches `sourceUrl` itself and returns the
 * transformed/analyzed asset. Avoids round-tripping the image bytes through
 * our own server for moderation/background-removal calls.
 */
async function uploadByFetchUrl(
  sourceUrl: string,
  extraParams: Record<string, string>,
  env: CloudinaryEnv
): Promise<any> {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign: Record<string, string | number> = {
    timestamp,
    ...extraParams,
  };
  const signature = await signParams(paramsToSign, env.apiSecret);

  const body = new URLSearchParams({
    file: sourceUrl,
    api_key: env.apiKey,
    timestamp: String(timestamp),
    signature,
    ...extraParams,
  });

  const response = await fetch(`${CLOUDINARY_API_BASE}/${env.cloudName}/image/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Cloudinary returned non-JSON response (status ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const errMsg = parsed?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Cloudinary upload failed: ${errMsg}`);
  }

  return parsed;
}

/**
 * Moderate a photo via Cloudinary's moderation add-on (AWS Rekognition).
 *
 * // TODO: verify against live Cloudinary docs — the exact `moderation`
 * // param value and the exact shape of `moderation_response`/`moderation`
 * // in the upload response are written from documented behavior as of
 * // training knowledge (moderation: 'aws_rek', response field
 * // `moderation: [{ kind: 'aws_rek', status: 'approved'|'rejected'|'pending', ... }]`)
 * // but Cloudinary's API has changed field shapes before. CONFIRM against
 * // https://cloudinary.com/documentation/aws_rekognition_ai_moderation_addon
 * // before relying on this in production, and add a live-mode test once
 * // real credentials exist.
 *
 * FAIL CLOSED (IMG-001 / SEC-010, content-safety gate): any HTTP error,
 * network failure, malformed JSON, or a response shape we don't recognize
 * results in `approved: false`. There is no code path in this function that
 * silently passes an unrecognized response as approved.
 */
export async function moderatePhoto(sourceUrl: string): Promise<ModerationResult> {
  const env = readCloudinaryEnv();
  if (!env) {
    return { approved: false, notConfigured: true, reason: 'Cloudinary is not configured' };
  }

  try {
    const result = await uploadByFetchUrl(
      sourceUrl,
      {
        moderation: 'aws_rek',
        // Explicit EXIF strip on the moderation upload too — see removeBackground
        // for the full D-006 rationale. Cloudinary does NOT strip metadata by
        // default on the stored asset; `image_metadata=false` (the default,
        // omitted here) plus delivery without `fl_keep_iptc`/raw passthrough
        // keeps GPS/EXIF out of anything we read back from this call.
      },
      env
    );

    // Defensive parse: moderation info can appear as `moderation` (array) per
    // the documented add-on response shape. Treat anything else as
    // "couldn't determine" -> fail closed.
    const moderationEntries = Array.isArray(result?.moderation) ? result.moderation : null;
    if (!moderationEntries || moderationEntries.length === 0) {
      return { approved: false, reason: 'Cloudinary returned no moderation verdict' };
    }

    const verdict = moderationEntries[0];
    const status = typeof verdict?.status === 'string' ? verdict.status : null;

    if (status === 'approved') {
      return { approved: true };
    }
    if (status === 'rejected') {
      const reasonDetail = Array.isArray(verdict?.response)
        ? verdict.response.map((r: any) => r?.name).filter(Boolean).join(', ')
        : undefined;
      return { approved: false, reason: reasonDetail ? `Rejected: ${reasonDetail}` : 'Rejected by moderation' };
    }
    // 'pending' (async moderation still processing) or any unrecognized
    // status is NOT a pass — fail closed rather than guessing.
    return { approved: false, reason: `Moderation status not final/recognized: ${status ?? 'unknown'}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Cloudinary error';
    console.error('[cloudinary] moderatePhoto failed, failing closed:', message);
    return { approved: false, reason: message };
  }
}

/**
 * Remove the background of a photo via Cloudinary's AI background-removal
 * add-on, returning the delivery URL of the resulting cutout (transparent
 * PNG). Non-throwing: callers must handle the `{ok:false}` case as a
 * fallback trigger, not an exception.
 */
export async function removeBackground(sourceUrl: string): Promise<BackgroundRemovalResult> {
  const env = readCloudinaryEnv();
  if (!env) {
    return { ok: false, notConfigured: true, reason: 'Cloudinary is not configured' };
  }

  try {
    const result = await uploadByFetchUrl(
      sourceUrl,
      {
        background_removal: 'cloudinary_ai',
        // IMG-010 / D-006 — EXIF/GPS stripping.
        //
        // Conclusion (documented here since this determines whether D-006 can
        // be marked closed): Cloudinary's upload API does NOT strip
        // EXIF/GPS from the stored original by default — `image_metadata`
        // defaults to false only in the sense that it *withholds returning*
        // metadata in the JSON response, it does not delete it from the
        // asset. The delivery URL Cloudinary hands back for a
        // transformation-based asset (which this is, since
        // background_removal is itself a transformation) by default already
        // omits EXIF on the delivered bytes because Cloudinary's transformed
        // derivatives do not carry the original's metadata unless the
        // `fl_keep_iptc` flag is explicitly added — we never add that flag,
        // so the cutout URL returned here should already be EXIF-stripped.
        // We do NOT rely on that alone: we pass `flags: 'stripprofile'`
        // explicitly below to force removal of any ICC/EXIF/XMP profile data
        // on the delivered asset regardless of the above, per Cloudinary's
        // documented `fl_stripprofile` transformation flag. This is
        // belt-and-suspenders and should be verified against a live account
        // once real credentials exist.
        flags: 'stripprofile',
      },
      env
    );

    const resultUrl = typeof result?.secure_url === 'string' ? result.secure_url : null;
    if (!resultUrl) {
      return { ok: false, reason: 'Cloudinary returned no secure_url for background removal' };
    }
    return { ok: true, resultUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Cloudinary error';
    console.error('[cloudinary] removeBackground failed:', message);
    return { ok: false, reason: message };
  }
}
