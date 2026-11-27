/**
 * Placement and mode (spec §5, §13).
 *
 * The engine's only geometry decision: which rectangle of the subject image is
 * used, where it lands on the template, and what the compositor must clip.
 * Everything downstream (the edge pass, the light reference ring, the grounding,
 * the protected face) reads this record, so getting it right here is what keeps
 * the rest of the pipeline from inventing its own coordinate frames.
 *
 * Mode A ("background"): the subject is placed on the template at its own aspect
 * ratio, standing on the slot's floor. Scale is head-normalised and then capped
 * by the box — `min(headTarget / headHeight, boxFill / silhouetteHeight,
 * boxWidth / bboxWidth)`. The head term is spec §13.5's requirement that a tight
 * crop and a loose crop of the same person show the same head size; the two box
 * terms are §13.2's fill and the obvious "never cut a wide figure".
 *
 * Mode B ("photo_area"): the slot *is* a window. Scale is cover, the source is
 * the window's worth of subject pixels positioned so the head keeps its
 * headroom, and the overflow is clipped at the window — never at the bleed box,
 * because a bleed that reaches past the window is no longer a bleed, it is a
 * broken frame.
 *
 * Nothing here throws. `resolvePhotoMode` degrades to Mode A on any decode
 * problem, since Mode A is what the app did before this file existed.
 */
import sharp from 'sharp';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import type { BlendParams } from '@/src/lib/rendering/blend/params';
import type { Rect, SubjectMetrics } from '@/src/lib/rendering/blend/subject-metrics';

export type PhotoMode = 'background' | 'photo_area';

export interface CanvasSize { width: number; height: number }

export interface Placement {
  /** crop in subject-pixel space (rounded by the compositor) */
  source: Rect;
  target: { left: number; top: number; width: number; height: number };
  clip?: { left: number; top: number; width: number; height: number };
  faceOnCanvas: Rect;
  anchor: 'top' | 'centre' | 'bottom';
  mode: PhotoMode;
  /** the px-per-subject-px factor actually applied, for the decision record */
  scale: number;
}

/** §13.5: a reference portrait shows a head that is 30 % of the visible silhouette. */
export const CANONICAL_HEAD_SHARE = 0.30;
/** §13.3: how far past the window a `bleed` slot reaches, as a fraction of the window. */
export const BLEED_PAD = 0.15;
/** §13.3: headroom kept above the head in both modes. */
export const HEADROOM = 0.06;

type PlacementSlot = SlotConfig & { bleed?: boolean; anchor?: string };

const r = Math.round;

function projectFace(face: Rect, source: Rect, scale: number, left: number, top: number): Rect {
  return {
    x: r(left + (face.x - source.x) * scale),
    y: r(top + (face.y - source.y) * scale),
    width: Math.max(1, r(face.width * scale)),
    height: Math.max(1, r(face.height * scale)),
  };
}

function resolveAnchor(slot: PlacementSlot, m: SubjectMetrics): 'top' | 'centre' | 'bottom' {
  if (slot.anchor === 'top' || slot.anchor === 'centre' || slot.anchor === 'bottom') return slot.anchor;
  // 'auto' (and anything unrecognised) reads the matte: a figure the vendor cut
  // at the feet belongs on the ground line; a bust does not get dragged down.
  return m.bottomY >= m.height * (2 / 3) ? 'bottom' : 'centre';
}

export function planPlacement(i: {
  mode: PhotoMode; slot: PlacementSlot; metrics: SubjectMetrics; params: BlendParams;
  canvas: CanvasSize; overrides?: { xOffset?: number; yOffset?: number; scale?: number };
}): Placement {
  const { mode, slot, metrics: m, params, canvas, overrides } = i;
  const box = { x: slot.x, y: slot.y, width: slot.width, height: slot.height };
  const offset = { x: Number.isFinite(overrides?.xOffset) ? (overrides?.xOffset as number) : 0,
    y: Number.isFinite(overrides?.yOffset) ? (overrides?.yOffset as number) : 0 };
  const zoom = Number.isFinite(overrides?.scale) && (overrides?.scale as number) > 0 ? (overrides?.scale as number) : 1;
  const anchor = resolveAnchor(slot, m);

  if (mode === 'photo_area') {
    // The window is the slot, clamped to the canvas: a slot that runs past the
    // template edge cannot show more than the template has, and an unclipped
    // extract is what makes sharp throw inside a claimed job.
    const cw = Math.max(1, canvas.width), ch = Math.max(1, canvas.height);
    const winLeft = Math.max(0, Math.min(box.x, cw - 1));
    const winTop = Math.max(0, Math.min(box.y, ch - 1));
    const window = {
      left: winLeft,
      top: winTop,
      width: Math.max(1, Math.min(box.width, cw - winLeft)),
      height: Math.max(1, Math.min(box.height, ch - winTop)),
    };
    // The bleed box is the placement box; the clip stays the window (§13.3).
    const grow = slot.bleed ? BLEED_PAD : 0;
    const padW = r(window.width * grow), padH = r(window.height * grow);
    const place = { left: window.left - r(padW / 2), top: window.top - r(padH / 2),
      width: window.width + padW, height: window.height + padH };

    const cover = Math.max(place.width / Math.max(1, m.bbox.width), place.height / Math.max(1, m.bbox.height));
    const scale = cover * zoom;
    const srcW = Math.max(1, r(place.width / scale)), srcH = Math.max(1, r(place.height / scale));

    // Headroom first: put headTop 6 % of the *window* below its top.
    const faceCentreX = m.face.x + m.face.width / 2;
    const bboxCentreX = m.bbox.x + m.bbox.width / 2;
    const centreX = m.face.width > 0 ? faceCentreX : bboxCentreX;
    let srcX = r(centreX - srcW / 2);
    let srcY = r(m.headTop - (window.height * HEADROOM) / scale);
    // If that would reach above the subject image — a bust crop in a square
    // window — anchor on the face box instead and let the feet clip (§13.3).
    srcX = Math.max(0, Math.min(srcX, Math.max(0, m.width - srcW)));
    srcY = Math.max(0, Math.min(srcY, Math.max(0, m.height - srcH)));
    const source = { x: srcX, y: srcY, width: srcW, height: srcH };
    const left = place.left + r(offset.x), top = place.top + r(offset.y);

    return {
      source,
      target: { left, top, width: place.width, height: place.height },
      clip: window,
      faceOnCanvas: projectFace(m.face, source, scale, left, top),
      anchor,
      mode,
      scale,
    };
  }

  // Mode A — the whole silhouette is used, nothing is cropped.
  const boxFillPx = box.height * params.subjectFill;
  const headHeightPx = Math.max(1, m.headBottom - m.headTop);
  const headTargetPx = boxFillPx * CANONICAL_HEAD_SHARE;
  const scale = Math.min(
    headTargetPx / headHeightPx,
    boxFillPx / Math.max(1, m.silhouetteHeight),
    box.width / Math.max(1, m.bbox.width),
  ) * zoom;

  const width = Math.max(1, r(m.bbox.width * scale));
  const height = Math.max(1, r(m.bbox.height * scale));
  const left = box.x + r((box.width - width) / 2);
  let top: number;
  if (anchor === 'bottom') top = box.y + box.height - height;
  else if (anchor === 'top') top = box.y + r(box.height * HEADROOM - (m.headTop - m.bbox.y) * scale);
  else top = box.y + r((box.height - height) / 2);

  const source = { ...m.bbox };
  const placed = { left: left + r(offset.x), top: top + r(offset.y) };

  return {
    source,
    target: { left: placed.left, top: placed.top, width, height },
    faceOnCanvas: projectFace(m.face, source, scale, placed.left, placed.top),
    anchor,
    mode,
    scale,
  };
}

/**
 * Decide the mode from the template itself when the row says `auto`.
 *
 * A window is a window when it is mostly transparent: the alpha probe over the
 * slot rect answers "is the template waiting for a photograph here?" without
 * any convention about naming, and a template that is opaque under the slot is a
 * background plate where the subject belongs behind the frame.
 */
export async function resolvePhotoMode(templatePng: Buffer, slot: PlacementSlot, declared: string): Promise<PhotoMode> {
  if (declared === 'background' || declared === 'photo_area') return declared;
  if (declared !== 'auto') {
    console.warn(`[blend] unknown photo_mode "${declared}", falling back to background`);
    return 'background';
  }
  try {
    const meta = await sharp(templatePng).metadata();
    const cw = meta.width ?? 0, ch = meta.height ?? 0;
    const x = Math.max(0, Math.min(slot.x, Math.max(0, cw - 1)));
    const y = Math.max(0, Math.min(slot.y, Math.max(0, ch - 1)));
    const width = Math.max(1, Math.min(slot.width, cw - x));
    const height = Math.max(1, Math.min(slot.height, ch - y));
    if (x + width > cw || y + height > ch || cw === 0 || ch === 0) return 'background';

    const { data } = await sharp(templatePng)
      .extract({ left: x, top: y, width, height })
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let transparent = 0;
    for (let i = 0; i < data.length; i++) if (data[i] < 128) transparent++;
    return transparent / data.length >= 0.5 ? 'photo_area' : 'background';
  } catch (err) {
    console.warn('[blend] photo_mode probe failed, using background:', err instanceof Error ? err.message : err);
    return 'background';
  }
}
