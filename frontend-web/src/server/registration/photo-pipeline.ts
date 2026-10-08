/**
 * Contestant photo pipeline — moderation + background removal + optional
 * template compositing, orchestrated from Cloudinary (src/lib/media/cloudinary.ts)
 * and the existing Sharp compositor (src/lib/rendering/imageCompositor.ts).
 *
 * Test-plan: G-IMG / TS-3 (docs/qa/voting-contest-test-plan.md).
 *
 * ── Template compositing reachability ───────────────────────────────────────
 * `compositeImage` needs a `CompositorInput` (templateUrl/templateWidth/
 * templateHeight/slot). `contest_templates`/`template_slots`
 * (supabase/migrations/20260405700000_contest_image_templates.sql) is the
 * only template concept in the schema, but `contest_templates.contest_id`
 * references the LEGACY `public.contests` table — not `connect_contests`,
 * which is what registrations resolve via `registrations.contest_slug`
 * (see promote_registration_to_contestant in
 * supabase/migrations/20260812010000_registration_contestant_seam.sql).
 * There is no bridge row/column linking a connect_contests contest to a
 * contest_templates row today, and no admin UI to create one (AD-003/CS-004,
 * explicitly out of scope here). So a real registration approval has no way
 * to resolve which template+slot to composite onto.
 *
 * `processContestantPhoto` (full pipeline, moderation + bg-removal +
 * compositing) is still implemented and unit-tested here for when that link
 * exists, but the registration review wiring
 * (app/api/admin/registration/applications/[id]/review/route.ts) uses
 * `processContestantPhotoNoTemplate` — moderation + optional background-removal
 * cutout only, no compositing — because that's what's actually reachable from
 * today's data model.
 */

import { moderatePhoto, removeBackground } from '@/src/lib/media/cloudinary';
import { compositeImage, type SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { uploadR2Object, getR2PublicUrl, hasR2Config } from '@/src/lib/storage/r2';
import { randomUUID } from 'crypto';

export type PhotoPipelineResult =
  | { status: 'ready'; photoUrl: string }
  | { status: 'rejected'; reason: string }
  | { status: 'fallback'; photoUrl: string; reason: string };

export interface ProcessContestantPhotoInput {
  rawPhotoUrl: string;
  templateUrl: string;
  templateWidth: number;
  templateHeight: number;
  slot: SlotConfig;
}

/**
 * Upload a composited/cutout buffer to R2 and return a stable public URL.
 * Throws if R2 isn't configured or the upload fails — callers decide what
 * that means for their status (ready vs. fallback).
 */
async function persistToR2(buffer: Buffer, mimeType: string, prefix: string): Promise<string> {
  if (!hasR2Config()) {
    throw new Error('R2 storage is not configured');
  }
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const key = `contestants/${prefix}/${randomUUID()}.${ext}`;
  await uploadR2Object({ key, body: buffer, contentType: mimeType });
  const publicUrl = getR2PublicUrl(key);
  if (!publicUrl) {
    throw new Error('R2 upload succeeded but no public base URL is configured (R2_PUBLIC_BASE_URL)');
  }
  return publicUrl;
}

/**
 * Run moderation on a raw photo URL. Returns null if approved (or dev-mode
 * skip), or a rejected PhotoPipelineResult to return immediately.
 *
 * IMPORTANT: the `notConfigured` skip below is a DEV-ONLY relaxation. It must
 * NEVER trigger when Cloudinary creds ARE configured — it only fires when
 * `moderatePhoto` explicitly reports `notConfigured: true` (i.e. env vars are
 * literally absent), never as a default-open fallback for an ambiguous or
 * malformed moderation response. Every other non-approved outcome
 * (including HTTP/parse errors, which `moderatePhoto` itself fails closed on)
 * rejects here.
 */
async function runModerationGate(rawPhotoUrl: string): Promise<PhotoPipelineResult | null> {
  const moderation = await moderatePhoto(rawPhotoUrl);

  if (moderation.approved) return null;

  if (moderation.notConfigured) {
    // eslint-disable-next-line no-console
    console.warn(
      '[photo-pipeline] Cloudinary is not configured — skipping content moderation for this photo. ' +
        'This path must only ever be reached in local/dev environments with no CLOUDINARY_* env vars set. ' +
        'It must never be treated as a default-open fallback for a configured-but-ambiguous moderation result.'
    );
    return null;
  }

  return { status: 'rejected', reason: moderation.reason || 'Photo failed content moderation' };
}

/**
 * Full pipeline: moderate -> background-remove -> composite onto template ->
 * upload to R2. See module doc for why this is not currently reachable from
 * the real registration-review flow (no contest_templates<->connect_contests
 * link), but it is fully implemented + tested for when that link exists.
 */
export async function processContestantPhoto(
  input: ProcessContestantPhotoInput
): Promise<PhotoPipelineResult> {
  const { rawPhotoUrl, templateUrl, templateWidth, templateHeight, slot } = input;

  const gated = await runModerationGate(rawPhotoUrl);
  if (gated) return gated;

  const bgResult = await removeBackground(rawPhotoUrl);

  // Fallback preference: if background removal fails, prefer compositing the
  // RAW photo onto the template over skipping compositing entirely — the
  // template framing/branding is more valuable to preserve than a clean
  // cutout, and the compositor handles a non-transparent source photo fine
  // (it just won't look "cut out"). Only fall back further, to the
  // fully-uncomposited raw URL, if compositing itself also fails (e.g. the
  // template asset is unreachable) — at that point there's nothing left to
  // safely combine, so return the one URL guaranteed to be a real image.
  const photoUrlForSlot = bgResult.ok ? bgResult.resultUrl : rawPhotoUrl;
  const usedCutout = bgResult.ok;

  try {
    const composited = await compositeImage({
      templateUrl,
      templateWidth,
      templateHeight,
      slots: [{ ...slot, photo_url: photoUrlForSlot }],
    });
    const uploadedUrl = await persistToR2(composited.buffer, composited.mimeType, 'composited');

    if (usedCutout) {
      return { status: 'ready', photoUrl: uploadedUrl };
    }
    return {
      status: 'fallback',
      photoUrl: uploadedUrl,
      reason: `Background removal failed (${!bgResult.ok ? bgResult.reason : 'unknown'}); composited with raw photo instead`,
    };
  } catch (compositeErr) {
    const compositeReason = compositeErr instanceof Error ? compositeErr.message : 'Unknown compositing error';
    // Compositing itself failed — fall all the way back to the raw photo URL,
    // which is at least a real, viewable image.
    return {
      status: 'fallback',
      photoUrl: rawPhotoUrl,
      reason: `Compositing failed (${compositeReason}); using raw photo with no template`,
    };
  }
}

/**
 * No-template pipeline: moderate, then (best-effort) background-remove,
 * returning the Cloudinary cutout URL directly with no compositing. This is
 * the function actually wired into registration approval today — see module
 * doc for why full template compositing isn't reachable from real data yet.
 */
export async function processContestantPhotoNoTemplate(rawPhotoUrl: string): Promise<PhotoPipelineResult> {
  const gated = await runModerationGate(rawPhotoUrl);
  if (gated) return gated;

  const bgResult = await removeBackground(rawPhotoUrl);
  if (bgResult.ok) {
    return { status: 'ready', photoUrl: bgResult.resultUrl };
  }

  // No template to fall back to compositing onto here — the only fallback
  // available is the original, unprocessed photo URL.
  return {
    status: 'fallback',
    photoUrl: rawPhotoUrl,
    reason: `Background removal failed (${bgResult.reason}); using raw photo`,
  };
}
