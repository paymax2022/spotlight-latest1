/**
 * The blend engine (spec §4).
 *
 * Seven calls in the order §4's data flow numbers them, and nothing else: each
 * stage keeps its own maths in its own file, and this module owns only the
 * sequence, the values handed between them, and the record §6.4 asks the job to
 * store.
 *
 * Three decisions no stage could make for itself:
 *
 * - **What "this render clips" means for the shadow pass.** §7's `auto` rule
 *   fires on a photo-area window *and* on the slot's `border_radius`, and only
 *   here are both the placement and the slot row in hand at the same time.
 * - **Which rectangle the light reference is.** §6.2 wants the placement dilated
 *   and the placement itself subtracted — a ring the subject is not inside.
 *   Deriving it here is what lets `measureRegion` stay a plain statistician.
 * - **What happens when a stage throws.** §10 wants the contestant to keep a
 *   portrait, so the whole sequence sits inside one `try` with the stage name
 *   beside it, and the answer on that path is the bytes that came in, untouched,
 *   plus `{applied: false, stage, error}`. A half-blended subject is the one
 *   outcome an operator cannot attribute, so nothing downstream is allowed to
 *   see one.
 *
 * The output is deliberately not "a finished image": compositing is the
 * renderer's job (Task 8). What leaves here is the subject the renderer should
 * draw, the geometry it must draw it with, the underlays that go beneath it, and
 * the box nothing on top may cover.
 */
import { refineEdges } from './edge-refine';
import { matchLight, measureRegion, measureSubjectLight } from './light-match';
import { isBlendDisabled, type BlendParams } from './params';
import { planPlacement, resolvePhotoMode, type CanvasSize, type PhotoMode, type Placement } from './placement';
import { buildShadowLayers, type Underlay } from './shadow';
import { measureSubject, type Rect, type SubjectMetrics } from './subject-metrics';
import type { SlotConfig } from '../imageCompositor';

/** §6.2: how far outside the placement the reference reaches, across the whole rect. */
const REFERENCE_DILATION = 0.25;

/** §4's steps 1–7, in the order they run and can be named in a failure record. */
type Stage = 'measure' | 'mode' | 'placement' | 'edge' | 'light' | 'shadow';

export interface BlendRequest {
  /** the vendor's cutout, read once by the runner and never written back */
  subjectPng: Buffer;
  /** the template canvas, read once per job for the mode probe and the light ring */
  templatePng: Buffer;
  /** passed in rather than decoded here: the resolver already knows the size */
  canvas: CanvasSize;
  slot: SlotConfig;
  params: BlendParams;
  /** Reuse the runner's measurement instead of decoding the subject a second time. */
  metrics?: SubjectMetrics;
  /** `contest_templates.photo_mode`: 'auto' | 'background' | 'photo_area'. */
  photoMode?: string;
  /** The contestant editor's nudges (P4), applied on top of the planned geometry. */
  overrides?: { xOffset?: number; yOffset?: number; scale?: number };
}

export interface BlendOutput {
  /** the cutout as it should be drawn: refined, matched, re-encoded */
  subjectPng: Buffer;
  /** null whenever nothing was applied, because no geometry was then decided */
  placement: Placement | null;
  underlays: Underlay[];
  /** the §8.2 protected region, or null when the design is allowed over the face */
  faceSafe: { face: Rect; strength: number } | null;
  /** §9's encoder quality, or null to tell the runner to encode exactly as P1 did */
  jpegQuality: number | null;
  /** what lands in `render_params.blend` (§6.4, §10) */
  decisions: Record<string, unknown>;
}

/** The one answer shape every no-op path shares: the input bytes and a reason. */
function declined(subjectPng: Buffer, preset: string, extra: Record<string, unknown>): BlendOutput {
  return { subjectPng, placement: null, underlays: [], faceSafe: null, jpegQuality: null,
    decisions: { preset, applied: false, ...extra } };
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/**
 * Placement rectangles are `{left, top}` because that is what the compositor and
 * sharp's `extract` speak; measurement rectangles are `{x, y}` because that is
 * what `Rect` has meant since Task 2. The two vocabularies meet only here.
 */
const toRect = (t: { left: number; top: number; width: number; height: number }): Rect =>
  ({ x: t.left, y: t.top, width: t.width, height: t.height });

/**
 * §6.2's rect, grown by 25 % of its own size — half of that on each side, and
 * clamped to the canvas. A band that thick is what keeps the reference *near*
 * the figure: growing 25 % per side would reach far enough to average in art the
 * subject is not standing next to, which is the frame average this section
 * exists to avoid. The placement rect is passed back out as the exclusion, not
 * subtracted here, so `measureRegion` still sees one rect and one alpha rule.
 */
function referenceRing(placement: Placement, canvas: CanvasSize): Rect {
  const t = placement.target;
  const padX = Math.round(t.width * REFERENCE_DILATION) / 2;
  const padY = Math.round(t.height * REFERENCE_DILATION) / 2;
  const left = Math.max(0, Math.floor(t.left - padX));
  const top = Math.max(0, Math.floor(t.top - padY));
  const right = Math.min(canvas.width, Math.ceil(t.left + t.width + padX));
  const bottom = Math.min(canvas.height, Math.ceil(t.top + t.height + padY));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export async function blendSubject(req: BlendRequest): Promise<BlendOutput> {
  const { params, slot } = req;
  if (isBlendDisabled(params)) return declined(req.subjectPng, params.preset, {});

  let stage: Stage = 'measure';
  try {
    // 1 — measure. An empty matte is not an error, it is the case the runner
    // needs named: a vendor that returned nothing, or a subject entirely outside
    // the frame. Placement math divides by the bbox, so it stops here.
    stage = 'measure';
    const metrics = req.metrics ?? await measureSubject(req.subjectPng);
    if (metrics.bbox.width <= 0 || metrics.bbox.height <= 0) {
      return declined(req.subjectPng, params.preset, { reason: 'empty-subject' });
    }

    // 2 — mode. §13's probe is the only way a template with no new columns set
    // still renders as its author meant.
    stage = 'mode';
    const declared = req.photoMode ?? 'auto';
    const mode: PhotoMode = await resolvePhotoMode(req.templatePng, slot, declared);

    // 3 — placement. From here every stage shares this one geometry.
    stage = 'placement';
    const placement = planPlacement({ mode, slot, metrics, params, canvas: req.canvas, overrides: req.overrides });

    // 4 — edges. §5.3 caps the feather against *the slot*, so this is the row's
    // width and height rather than the target rect the subject happens to fill:
    // the cap describes how hard an edge may be softened in the space the
    // operator allocated, not how big this contestant's silhouette turned out.
    stage = 'edge';
    const edge = await refineEdges(req.subjectPng, params, { width: slot.width, height: slot.height });

    // 5 and 6 — measure the frame around the placement, then move part way.
    // A ring with too few opaque pixels to trust is not a neutral reference but
    // an absent one, and §6.B's answer to that is "change nothing", recorded as a
    // reason rather than a silent zero.
    stage = 'light';
    const ref = await measureRegion(req.templatePng, referenceRing(placement, req.canvas), toRect(placement.target));
    const lit = ref ? await matchLight(edge.png, await measureSubjectLight(edge.png), ref, params) : null;
    const subjectPng = lit ? lit.png : edge.png;

    // 7 — grounding. Built from the subject as it will actually be drawn, so the
    // `1 − alphaSubject` mask lines up with the bytes the compositor is about to
    // paste, and reported with the two clip signals §7's `auto` rule reads.
    stage = 'shadow';
    const slotClips = Math.round(slot.border_radius) > 0;
    const underlays = await buildShadowLayers(subjectPng, placement, metrics, params, slotClips);

    // §8.2 — the protected box travels to the compositor as canvas geometry;
    // whether an overlay is allowed over it stays the slot author's flag, and
    // `face_protect === false` publishes nothing so there is nothing to cut.
    const faceSafe = params.faceProtectStrength > 0 && slot.face_protect !== false
      ? { face: placement.faceOnCanvas, strength: params.faceProtectStrength }
      : null;

    return {
      subjectPng,
      placement,
      underlays,
      faceSafe,
      jpegQuality: params.jpegQuality,
      decisions: {
        preset: params.preset,
        applied: true,
        mode: { declared, used: mode },
        placement: {
          source: placement.source,
          target: placement.target,
          clip: placement.clip ?? null,
          anchor: placement.anchor,
          scale: round4(placement.scale),
        },
        edge: edge.applied,
        light: lit ? lit.applied : { applied: false, reason: 'no-reference-region' },
        shadow: { mode: params.shadow, layers: underlays.length, clipped: slotClips },
        faceProtected: { on: faceSafe !== null, strength: params.faceProtectStrength, box: faceSafe?.face ?? null },
      },
    };
  } catch (err) {
    // §10: the stage that gave out, the message an operator can read, and P1's
    // paste render. The job still reaches `ready`.
    return declined(req.subjectPng, params.preset, {
      stage,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
