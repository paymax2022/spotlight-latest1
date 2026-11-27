/**
 * Executes one claimed job (spec §6, §7).
 *
 * All-or-nothing by construction: a `final` asset row is written only after the
 * composite has been built and stored, and the job is only marked `ready` after
 * that row exists. So a reader that finds a ready job is guaranteed a complete
 * portrait, and any failure leaves the original exactly where the registry put
 * it and publishes nothing under the template's name.
 *
 * The order of the checks is a cost order, not a convenience one. Read the row,
 * prove the photograph is still there, get the vendor a URL it can fetch,
 * moderate, confirm the template is still the one the job was queued for, and
 * only then spend the paid calls (extraction, compositing). Two of those steps
 * exist purely to avoid a misleading later failure: an unreadable original comes
 * back from the vendor as a moderation-shaped rejection, and a template that was
 * republished mid-queue would otherwise render the contestant onto the wrong
 * frame and record it against the job's stale template id.
 *
 * Content safety keeps the fail-closed semantics already documented in
 * `registration/photo-pipeline.ts`: `notConfigured` — literally absent
 * credentials — is the only non-approval that may pass, and an ambiguous answer
 * from a configured vendor never reaches the compositor.
 *
 * Nothing here catches an exception to keep going. Variants are the single
 * exception, and only because a thumbnail is decoration on a portrait that is
 * already finished and stored; losing them must not un-publish a result.
 */
import { resolveFetchableSource } from '@/src/lib/media/asset-source';
import { getPhotoProvider } from '@/src/lib/media/provider';
import { compositeImage } from '@/src/lib/rendering/imageCompositor';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';
import { readAssetBytes } from './assets';
import {
  cancelPhotoJob,
  completePhotoJob,
  failPhotoJob,
  getPhotoAsset,
  setPhotoJobProgress,
  upsertPhotoAsset,
  type PhotoJob,
} from './job-store';
import { storePhoto } from './persist';
import { renderVariant, type VariantName } from './variants';

export type RunOutcome = 'ready' | 'failed' | 'cancelled';

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function runPhotoJob(job: PhotoJob): Promise<RunOutcome> {
  const provider = getPhotoProvider();

  // The mobile sequence starts at `extracting` here: from this point the job is
  // ours (claimed with a lock) and every later write is either a progress value,
  // a terminal `ready`, or a terminal `failed`/`cancelled`.
  await setPhotoJobProgress(job.id, 'extracting', 5);

  const source = await getPhotoAsset(job.source_asset_id);
  if (!source) return fail(job, `Could not read the source asset ${job.source_asset_id} for this job`);

  // A deleted or unreachable original must not reach the vendor: the answer that
  // comes back is a moderation-shaped refusal that describes neither the fault
  // nor the fix. In P2 this same read becomes the pixel source.
  if (!(await readAssetBytes(source))) {
    return fail(job, 'The stored original photograph is unreadable — its bytes could not be fetched');
  }

  const stored = source.storage_key ?? source.provider_url ?? '';
  const fetchable = await resolveFetchableSource(stored);
  if (!fetchable.ok) {
    return fail(job, `Original photo is not fetchable for the provider: ${fetchable.reason}`);
  }

  const verdict = await provider.moderate(fetchable.url);
  if (!verdict.approved && !verdict.notConfigured) {
    await cancelPhotoJob(job.id, verdict.reason || 'Photo failed content moderation');
    return 'cancelled';
  }

  // Resolve before the paid calls, and against the identity the job carries: a
  // job queued for template A must not render onto template B because an admin
  // published a new one while the queue was backed up.
  const template = job.contest_id ? await resolveActiveTemplateForContest(job.contest_id) : null;
  if (!template) {
    return fail(job, 'The contest has no active template to composite onto');
  }
  if (job.template_id && template.templateId !== job.template_id) {
    return fail(
      job,
      `The active template changed since this job was queued (queued for ${job.template_id}, contest now resolves ${template.templateId})`,
    );
  }

  await setPhotoJobProgress(job.id, 'extracting', 35);
  const cutout = await provider.extractBackground(fetchable.url);
  if (!cutout.ok) {
    return fail(job, `Background removal failed via the ${provider.name} provider: ${cutout.reason || 'no reason given'}`);
  }

  const transparentId = await upsertPhotoAsset({
    registrationId: job.registration_id,
    kind: 'transparent',
    providerUrl: cutout.resultUrl,
    contentType: 'image/png',
    contestId: job.contest_id,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    renderParams: job.render_params,
  });
  if (!transparentId) return fail(job, 'Could not record the transparent cutout asset');

  await setPhotoJobProgress(job.id, 'compositing', 70);

  let composited: { key: string; buffer: Buffer; mimeType: string; width: number; height: number };
  try {
    // The cutout, never the original, is what goes into the slot — otherwise the
    // feature is a rectangle pasted onto a rectangle. Falling back to the
    // original only when there is no cutout URL is `photo-pipeline.ts:122`'s
    // existing preference, kept identical so both code paths agree.
    const rendered = await compositeImage({
      templateUrl: template.templateUrl,
      templateWidth: template.templateWidth,
      templateHeight: template.templateHeight,
      slots: [{ ...template.slot, photo_url: cutout.resultUrl || fetchable.url }],
    });
    composited = { ...rendered, key: await storePhoto(rendered.buffer, rendered.mimeType, 'composited') };
  } catch (err) {
    return fail(job, `Compositing failed: ${messageOf(err)}`);
  }

  const finalId = await upsertPhotoAsset({
    registrationId: job.registration_id,
    kind: 'final',
    storageKey: composited.key,
    contentType: composited.mimeType,
    width: composited.width,
    height: composited.height,
    bytes: composited.buffer.byteLength,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    renderParams: job.render_params,
    contestId: job.contest_id,
  });
  if (!finalId) {
    return fail(job, 'The composite was stored but its asset row could not be recorded');
  }

  await writeVariants(job, composited.buffer, template);

  if (!(await completePhotoJob(job.id, finalId))) {
    // The bytes exist and the row exists, so this is a job-table fault, and an
    // operator has to be able to tell that apart from "the portrait failed".
    return fail(job, 'The composite is stored but the job could not be marked ready');
  }
  return 'ready';
}

/** Preview and thumbnail. A failure here is logged and skipped: the portrait is
 *  already stored and recorded, and the surfaces that want a variant fall back
 *  to the `final` asset rather than showing nothing. */
async function writeVariants(
  job: PhotoJob,
  finalBuffer: Buffer,
  template: { templateId: string; templateVersion: number },
): Promise<void> {
  for (const name of ['preview', 'thumbnail'] as VariantName[]) {
    try {
      const variant = await renderVariant(finalBuffer, name);
      const key = await storePhoto(variant.buffer, variant.mimeType, name);
      await upsertPhotoAsset({
        registrationId: job.registration_id,
        kind: name,
        storageKey: key,
        contentType: variant.mimeType,
        width: variant.width,
        height: variant.height,
        bytes: variant.buffer.byteLength,
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        renderParams: job.render_params,
        contestId: job.contest_id,
      });
    } catch (err) {
      console.warn(`[photo-jobs] ${name} variant failed for job ${job.id}:`, messageOf(err));
    }
  }
}

async function fail(job: PhotoJob, reason: string): Promise<'failed'> {
  await failPhotoJob(job.id, reason);
  return 'failed';
}
