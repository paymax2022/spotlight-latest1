/**
 * One blended-composite path for two callers (spec §5, §10, §14.11).
 *
 * The job runner needs it because a claimed job has already paid for the cutout
 * and the frame, and the studio preview will need it in Task 10 because an author
 * who previews one render and publishes another has been told a lie. That is the
 * whole reason this file exists: two implementations of "blend, then draw" is how
 * the two drift, and the drift is only visible in the published portrait.
 *
 * What it deliberately does *not* own:
 *
 * - **reading bytes.** The caller passes buffers. Deciding which URL may be
 *   fetched is `template-image.ts`'s job, and a render helper that could reach
 *   the network would make §14.11's "the read is paid for" unprovable again.
 * - **storing.** `storePhoto` belongs to the pipeline; the preview writes nothing
 *   (D3), which is only expressible if this function does not.
 *
 * What it does own, and the reason the runner can hand its render decision to
 * this file: §10's promise that "a failed blend costs the blend and not the
 * portrait." An engine that *declines* answers `blendSubject` with the unrefined
 * subject and a declined decision set, and a byte read that came back null never
 * reaches here at all. An engine that *throws* is the remaining case, and when a
 * `fallback` is supplied it is caught here — one implementation of the rule, so
 * the preview cannot silently be the surface where a throw becomes a 500. The
 * composite and store calls stay un-caught: those two failures must still end a
 * job, because there is no portrait to publish without them.
 *
 * `off` is the case to read carefully. When the preset declines, the input built
 * below is exactly the P1-shaped call — same keys, no `underlays`, no
 * `faceSafe`, no `jpegQuality`, no `placement` on the slot — so §14.11's promise
 * that a disabled blend renders identically to the shipped pipeline is a property
 * of this branch rather than of arithmetic that happens to cancel out.
 */
import { compositeImage, type CompositorInput, type CompositorResult, type SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { blendSubject, type BlendOutput } from '@/src/lib/rendering/blend';
import type { CanvasSize } from '@/src/lib/rendering/blend/placement';
import type { BlendParams } from '@/src/lib/rendering/blend/params';
import type { SubjectMetrics } from '@/src/lib/rendering/blend/subject-metrics';

/** The contestant editor's nudges (P4), in the shape `planPlacement` expects. */
export interface BlendOverrides {
  xOffset?: number;
  yOffset?: number;
  scale?: number;
}

export interface BlendCompositingArgs {
  /** the template canvas, already read by the caller */
  templatePng: Buffer;
  canvas: CanvasSize;
  /** the contestant window */
  slot: SlotConfig;
  /** §8.1's decorative slots, drawn after the subject in `z_index` order */
  foregroundSlots?: SlotConfig[];
  /** the vendor's cutout (or the original, where there is no cutout) */
  subjectPng: Buffer;
  params: BlendParams;
  /** `contest_templates.photo_mode` */
  photoMode?: string;
  overrides?: BlendOverrides;
  /** Reuse a measurement the caller already made, rather than decoding twice. */
  metrics?: SubjectMetrics;
  /**
   * What to draw if the engine itself throws — §10's unblended render, built by
   * the caller because only the caller knows whether the paste is a URL it must
   * hand back (the runner's, which re-fetches and so survives a byte read that
   * failed on a hiccup) or bytes it already holds (the preview's).
   *
   * Absent means "let it throw": a caller with nothing to fall back to would
   * otherwise receive a silent portrait that looks like a blend and is not one.
   */
  fallback?: CompositorInput;
}

export interface BlendCompositingResult extends CompositorResult {
  /** what lands in `photo_jobs.render_params.blend`, and in the preview's header */
  decisions: Record<string, unknown>;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function compositeWithBlend(args: BlendCompositingArgs): Promise<BlendCompositingResult> {
  const fallback = args.fallback;
  let blend: BlendOutput;
  try {
    blend = await blendSubject({
      subjectPng: args.subjectPng,
      templatePng: args.templatePng,
      canvas: args.canvas,
      slot: args.slot,
      params: args.params,
      metrics: args.metrics,
      photoMode: args.photoMode,
      overrides: args.overrides,
    });
  } catch (err) {
    // The engine's own failure costs the blend, never the render — and the record
    // has to carry the message, because "these pixels are unblended" and "we do
    // not know why" are different things to an author staring at the studio.
    if (!fallback) throw err;
    const degraded = await compositeImage(fallback);
    return { ...degraded, decisions: { applied: false, preset: args.params.preset, error: messageOf(err) } };
  }

  const foreground = args.foregroundSlots ?? [];

  const input: CompositorInput = blend.placement
    ? {
        // No `templateUrl` beside these bytes: §14.11's "the read is paid for"
        // is only true if nothing downstream fetches the same URL a second time.
        templateBytes: args.templatePng,
        templateWidth: args.canvas.width,
        templateHeight: args.canvas.height,
        slots: [{ ...args.slot, photo_bytes: blend.subjectPng, placement: blend.placement }, ...foreground],
        underlays: blend.underlays,
        faceSafe: blend.faceSafe,
        jpegQuality: blend.jpegQuality,
      }
    : {
        templateBytes: args.templatePng,
        templateWidth: args.canvas.width,
        templateHeight: args.canvas.height,
        slots: [{ ...args.slot, photo_bytes: blend.subjectPng }, ...foreground],
      };

  return { ...(await compositeImage(input)), decisions: blend.decisions };
}
