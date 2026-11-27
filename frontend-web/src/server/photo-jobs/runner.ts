/**
 * Executes one claimed job (spec §4 steps 1–9, §6, §7, §10, §14.11).
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
 * Nothing here catches an exception to keep going, with two exceptions, both of
 * them about losing polish rather than losing the portrait. Variants are one: a
 * thumbnail is decoration on a result that is already finished and stored, so
 * losing it must not un-publish anything. The other is the blend pass, and
 * `chooseRender` below is where it lives — an engine that throws, or whose
 * pixels could not be read, answers with P1's paste and a record saying so,
 * because §10's promise is that the contestant still gets a framed photograph.
 * Neither exception reaches the composite-and-store pair, whose failure is still
 * fatal by design: there is no portrait to publish without those two calls.
 */
import { resolveFetchableSource } from '@/src/lib/media/asset-source';
import { getPhotoProvider } from '@/src/lib/media/provider';
import { blendSubject } from '@/src/lib/rendering/blend';
import { isBlendDisabled, resolveBlendParams, type BlendParams } from '@/src/lib/rendering/blend/params';
import { compositeImage, type CompositorInput } from '@/src/lib/rendering/imageCompositor';
import { resolveActiveTemplateForContest, type ResolvedTemplate } from '@/src/server/registration/template-resolver';
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
  // nor the fix. It stays a liveness probe and nothing more after P2 — the
  // pixels the blend works on are the vendor's cutout and the template, read in
  // `chooseRender`, because the original is the one asset this pipeline is
  // forbidden to draw from (§14.12).
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

  // §12's numbers, resolved once, from the two columns the template author set.
  // Everything downstream takes `params` rather than a preset string, so the
  // question "what did this render actually use?" has one answer and it is
  // computable from this row plus `blend/params.ts`.
  const params = resolveBlendParams(template.blendPreset, template.blendSettings);

  await setPhotoJobProgress(job.id, 'compositing', 70);

  const { input: renderInput, record: blendRecord } = await chooseRender({
    template,
    params,
    cutoutUrl: cutout.resultUrl,
    pasteUrl: cutout.resultUrl || fetchable.url,
    overrides: overridesFrom(job.render_params),
  });

  let composited: { key: string; buffer: Buffer; mimeType: string; width: number; height: number };
  try {
    const rendered = await compositeImage(renderInput);
    composited = { ...rendered, key: await storePhoto(rendered.buffer, rendered.mimeType, 'composited') };
  } catch (err) {
    // §10: this is the one throw allowed to fail the job after the blend's own
    // degrade. Nothing was stored, so nothing can be published, and the reason
    // is the compositor's or the store's rather than an invented one.
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
    // §4 step 9: the job's own parameters plus what the blend layer decided.
    // P1's row shape stays a subset of this one — a reader that only knows
    // `offsetX` still reads it — and the `blend` key is present on the no-op
    // paths too, because "not attempted, because `off`" and "attempted, matched
    // by 8 %" have to be tellable apart from the row alone.
    renderParams: { ...job.render_params, blend: blendRecord },
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

/** The contestant editor's nudges (P4), in the shape `planPlacement` expects. */
interface BlendOverrides {
  xOffset?: number;
  yOffset?: number;
  scale?: number;
}

/**
 * Pick the three keys the engine understands out of `render_params`.
 *
 * Picked rather than spread because that column is arbitrary JSON: a cast of
 * the whole blob would let whatever a later writer stores there change this
 * render's geometry, and the job row would look clean while it did.
 */
function overridesFrom(renderParams: Record<string, unknown>): BlendOverrides {
  const nudge = (key: string): number | undefined => {
    const value = renderParams[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  return { xOffset: nudge('xOffset'), yOffset: nudge('yOffset'), scale: nudge('scale') };
}

/**
 * Decide what the compositor is asked to draw, and what the job records about
 * that decision.
 *
 * Three answers, and §14.11 is the reason all three exist as separate paths
 * rather than as one call with neutral parameters:
 *
 * - **`off`** returns P1's call verbatim — no byte reads, no placement, no
 *   quality — so the byte-identity proof is about a code path an operator can
 *   select, not about arithmetic that happens to be an identity.
 * - **the blend** returns the engine's own render: the template as the bytes it
 *   was already measured from, the *refined cutout* as the slot's pixels (never
 *   the original photograph, which is what §14.12's three separate assets are
 *   for), the foreground art appended, and the underlays, face box and quality
 *   the engine decided.
 * - **either degrade** — the bytes could not be read, or the engine threw —
 *   returns that same P1 call with a named reason, because §10's promise is that
 *   a failed blend costs the blend and not the portrait. The paste re-fetches
 *   both URLs itself, so a byte read that failed on a hiccup still renders.
 *
 * It does not throw. `compositeImage` and `storePhoto` still can, and that is the
 * one failure left allowed to end the job.
 */
async function chooseRender(args: {
  template: ResolvedTemplate;
  params: BlendParams;
  /** the vendor's cutout URL, for the pixel read the blend needs */
  cutoutUrl: string;
  /** what the paste draws: the cutout, or the original when there is no cutout */
  pasteUrl: string;
  overrides: BlendOverrides;
}): Promise<{ input: CompositorInput; record: Record<string, unknown> }> {
  const { template, params } = args;

  // P1's call, with §8.1's foreground art appended. The ribbon belongs over the
  // contestant whether or not the light match ran, so the list is part of the
  // baseline rather than of the blend branch — and because `image_url` is new
  // and NULL on every row authored before P2, the list is empty there and this
  // is exactly the call that ships today.
  const paste = (): CompositorInput => ({
    templateUrl: template.templateUrl,
    templateWidth: template.templateWidth,
    templateHeight: template.templateHeight,
    slots: [{ ...template.slot, photo_url: args.pasteUrl }, ...template.foregroundSlots],
  });

  if (isBlendDisabled(params)) {
    return { input: paste(), record: { applied: false, preset: params.preset } };
  }

  // Two reads, one each: the subject and the frame. The original photograph is
  // not among them — it was read above purely to prove it still exists.
  const [subjectPng, templatePng] = await Promise.all([
    readAssetBytes({ storage_key: null, provider_url: args.cutoutUrl }),
    readAssetBytes({ storage_key: null, provider_url: template.templateUrl }),
  ]);

  if (!subjectPng || !templatePng) {
    return {
      input: paste(),
      record: { applied: false, preset: params.preset, error: 'the cutout or template bytes could not be read' },
    };
  }

  try {
    const blend = await blendSubject({
      subjectPng,
      templatePng,
      canvas: { width: template.templateWidth, height: template.templateHeight },
      slot: template.slot,
      params,
      photoMode: template.photoMode,
      overrides: args.overrides,
    });
    return {
      record: blend.decisions,
      input: {
        // No `templateUrl` beside these bytes: §14.11's "the read is paid for"
        // is only true if nothing downstream fetches the same URL a second time.
        templateBytes: templatePng,
        templateWidth: template.templateWidth,
        templateHeight: template.templateHeight,
        slots: [
          { ...template.slot, photo_bytes: blend.subjectPng, placement: blend.placement },
          ...template.foregroundSlots,
        ],
        underlays: blend.underlays,
        faceSafe: blend.faceSafe,
        jpegQuality: blend.jpegQuality,
      },
    };
  } catch (err) {
    return { input: paste(), record: { applied: false, preset: params.preset, error: messageOf(err) } };
  }
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
