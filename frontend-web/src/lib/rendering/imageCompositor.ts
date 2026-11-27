/**
 * Server-side Image Compositor
 * Uses Sharp to merge contestant photos into template slot positions
 * and generate final composite images stored in Supabase storage.
 */

import sharp, { OverlayOptions, FitEnum } from 'sharp';
import { isAllowedRemoteImageUrl } from '@/lib/config';
import { protectFace } from './blend/face-safe';
import type { Underlay } from './blend/shadow';
import type { Placement } from './blend/placement';
import type { Rect } from './blend/subject-metrics';

export interface SlotConfig {
  id: string;
  slot_name: string;
  slot_type: string;
  slot_order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  scale: number;
  crop_mode: 'cover' | 'contain' | 'fill' | 'none';
  border_radius: number;
  opacity: number;
  photo_url?: string | null;
  /**
   * Blend-layer columns from migration 20272200000000 (spec §13.4). Four more
   * fields than the renderer P1 knew about, and this compositor still does no
   * blend maths with them: `planPlacement` (in blend/placement.ts) reads
   * `anchor` and `bleed` and hands back the geometry as `placement` below, the
   * blend orchestrator reads `face_protect` to decide which rendered overlays
   * get the §8.2 face clip, and `image_url` is a slot's own foreground art —
   * the laurel or ribbon a template author uploads. They are optional so every
   * slot row and every caller that predates P2 keeps type-checking and keeps
   * rendering exactly as before.
   */
  image_url?: string | null;
  anchor?: 'auto' | 'top' | 'centre' | 'bottom';
  bleed?: boolean;
  face_protect?: boolean;
  /**
   * P2 Task 8. Naming follows the object it lives on rather than one house
   * style: `SlotConfig` mirrors a `template_slots` row, so its blend fields are
   * snake_case, while `CompositorInput` is TypeScript and camelCase like the
   * `templateUrl` beside it.
   *
   * `photo_bytes` short-circuits `fetchImageBuffer` when the caller has already
   * paid for the read — the runner downloads the cutout to build the metrics,
   * and a signed Cloudinary URL re-fetched inside a claimed job can expire
   * between those two reads. `placement` is the engine's geometry decision
   * (§13) handed to the one component that can execute it: crop the source
   * rect, resize it to the target rect, clip to the window. Both are absent
   * for every caller that predates P2, and when they are the render below is
   * the render that ships today (§14.11).
   */
  photo_bytes?: Buffer | null;
  placement?: Placement | null;
}

export interface TextOverlayConfig {
  id: string;
  label: string;
  field_type: string;
  content: string;
  x: number;
  y: number;
  font_size: number;
  font_weight: string;
  color: string;
  z_index: number;
}

export interface CompositorInput {
  /**
   * Either source works; a caller that already holds the template passes
   * `templateBytes` and leaves `templateUrl` out. When only a URL is passed the
   * fetch below is the one P1 made, at the same point in the sequence, so the
   * output stays byte-identical (§14.11).
   */
  templateUrl?: string;
  templateBytes?: Buffer | null;
  templateWidth: number;
  templateHeight: number;
  slots: SlotConfig[];
  textOverlays?: TextOverlayConfig[];
  /**
   * Layers that belong under every slot — §7's drop and contact shadows. They
   * arrive already positioned in canvas coordinates, so they are pasted first
   * and given no z_index of their own: a shadow is not a competitor for depth,
   * it is the floor the subject stands on.
   */
  underlays?: Underlay[];
  /**
   * The face the §8.2 clip protects, in canvas coordinates, plus the preset's
   * strength. Null (or absent) means no foreground art is being softened, and
   * no overlay is touched.
   */
  faceSafe?: { face: Rect; strength: number } | null;
  /**
   * §9's encode choice, opt-in by presence. Absent means "PNG, exactly as
   * today": `blend_preset: 'off'` has no quality to pass, and §14.11 requires
   * that configuration to render identically to main — which a default of 90
   * would break for every opaque photographic composite.
   */
  jpegQuality?: number | null;
}

export interface CompositorResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Fetch a remote image and return its raw buffer.
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (!isAllowedRemoteImageUrl(url)) {
    throw new Error(`Remote image host is not allowed: ${url}`);
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Apply a circular/rounded mask to an image buffer using Sharp.
 * Returns a PNG buffer with transparency.
 */
async function applyBorderRadius(
  imageBuffer: Buffer,
  width: number,
  height: number,
  borderRadius: number
): Promise<Buffer> {
  if (borderRadius <= 0) return imageBuffer;

  const r = Math.min(borderRadius, Math.min(width, height) / 2);
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="white"/>
    </svg>`
  );

  return sharp(imageBuffer)
    .resize(width, height, { fit: 'fill' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * Process a single photo slot: fetch, resize/crop, apply transforms.
 * Returns a Sharp OverlayOptions object ready for compositing.
 *
 * The geometry forks once, at `slot.placement`: without it every number below
 * comes from the slot rect the way it did in P1; with it the placement's
 * source/target/clip triple is executed verbatim, because that triple is the
 * blend engine's answer to "which part of this photograph, how big, and where"
 * and re-deriving it here would put two geometry engines in one pipeline.
 */
async function processSlot(
  slot: SlotConfig,
  _templateWidth: number,
  _templateHeight: number,
  faceSafe: FaceSafeSpec | null
): Promise<OverlayOptions | null> {
  if (!slot.photo_bytes && !slot.photo_url) return null;

  try {
    const rawBuffer = slot.photo_bytes ?? await fetchImageBuffer(slot.photo_url as string);
    const placement = slot.placement ?? null;

    // `boxWidth`/`boxHeight` is the size the overlay is rendered at, which
    // `applyBorderRadius` below re-fits to. It stays the pre-rotation box on
    // both paths: a rotated slot is scaled back into it exactly as P1 scaled
    // it, so changing that is a behaviour change this task is not making.
    let boxWidth: number;
    let boxHeight: number;
    let left: number;
    let top: number;
    let fit: keyof FitEnum;
    // A source rect that reaches past the photograph is clamped rather than
    // rejected: §10 reserves throwing for the composite and store steps, and
    // an absurd window should cost a little framing, not a claimed job.
    let crop: ReturnType<typeof cropWindow> = null;

    if (placement) {
      const sourceMeta = await sharp(rawBuffer).metadata();
      crop = cropWindow(placement.source, sourceMeta.width ?? 0, sourceMeta.height ?? 0);
      boxWidth = Math.max(1, Math.round(placement.target.width));
      boxHeight = Math.max(1, Math.round(placement.target.height));
      left = Math.round(placement.target.left);
      top = Math.round(placement.target.top);
      // `fill`, not `cover` — the source rect was chosen so that scaling it to
      // the target rect is the aspect-correct placement. Cover would crop again
      // and undo the headroom the placement engine just paid for.
      fit = 'fill';
    } else {
      // Determine Sharp fit mode from crop_mode
      const fitMap: Record<string, keyof FitEnum> = {
        cover: 'cover',
        contain: 'contain',
        fill: 'fill',
        none: 'inside',
      };
      fit = fitMap[slot.crop_mode] ?? 'cover';
      boxWidth = Math.round(slot.width * slot.scale);
      boxHeight = Math.round(slot.height * slot.scale);
      // Clamp position to template bounds
      left = Math.max(0, Math.round(slot.x));
      top = Math.max(0, Math.round(slot.y));
    }

    let step: ReturnType<typeof sharp> = sharp(rawBuffer);
    if (crop) step = step.extract(crop);
    step = step.resize(boxWidth, boxHeight, { fit });

    if (slot.rotation !== 0) {
      step = step.rotate(slot.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    // Annotated as the general Buffer: sharp 0.35's toBuffer() returns the
    // narrower Buffer<ArrayBuffer>, but applyBorderRadius below returns a plain
    // Buffer (Buffer<ArrayBufferLike>), which will not assign into the narrowed
    // inferred type.
    let processedBuffer: Buffer = await step.png().toBuffer();

    if (slot.border_radius > 0) {
      processedBuffer = await applyBorderRadius(
        processedBuffer,
        boxWidth,
        boxHeight,
        slot.border_radius
      );
    }

    if (slot.opacity < 1) {
      const opacityValue = Math.round(slot.opacity * 255);
      const meta = await sharp(processedBuffer).metadata();
      const channels = meta.channels ?? 4;

      if (channels === 4) {
        // Multiply alpha channel by opacity
        const rawPixels = await sharp(processedBuffer).raw().toBuffer({ resolveWithObject: true });
        const { data, info } = rawPixels;
        for (let i = 3; i < data.length; i += 4) {
          data[i] = Math.round((data[i] / 255) * opacityValue);
        }
        processedBuffer = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toBuffer();
      }
    }

    // §8.2: foreground art is thinned over the contestant's face. Only a slot
    // that says so — `face_protect` is the template author's flag, and the
    // default-true lives on the column, so a P1 slot that never mentions it is
    // never touched. It runs before the clip below so the cut and the window
    // agree on the same canvas rect.
    //
    // `protectFace` measures pixels inside the overlay buffer, so the
    // canvas-space face it is handed has to come over with the overlay's own
    // origin subtracted. The buffer's extent is then the clip, which is the
    // right bound anyway: an overlay is never asked to protect pixels it does
    // not cover, and the feathered band is meant to spill a little past the
    // face box.
    if (faceSafe && slot.face_protect === true) {
      const meta = await sharp(processedBuffer).metadata();
      processedBuffer = await protectFace(processedBuffer, {
        target: { left: 0, top: 0, width: meta.width ?? 0, height: meta.height ?? 0 },
        face: {
          x: faceSafe.face.x - left,
          y: faceSafe.face.y - top,
          width: faceSafe.face.width,
          height: faceSafe.face.height,
        },
        strength: faceSafe.strength,
      });
    }

    if (placement?.clip) {
      // §13.3: Mode B containment. The bleed reaches past the window on purpose
      // and the window is what cuts it; an overlay the window misses entirely
      // contributes nothing and is dropped rather than pasted off-canvas.
      const meta = await sharp(processedBuffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      const x0 = Math.max(left, placement.clip.left);
      const y0 = Math.max(top, placement.clip.top);
      const x1 = Math.min(left + w, placement.clip.left + placement.clip.width);
      const y1 = Math.min(top + h, placement.clip.top + placement.clip.height);
      if (x1 <= x0 || y1 <= y0) return null;
      processedBuffer = await sharp(processedBuffer)
        .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
        .png()
        .toBuffer();
      left = x0;
      top = y0;
    }

    return {
      input: processedBuffer,
      left,
      top,
      blend: 'over',
    } as OverlayOptions;
  } catch (err) {
    console.error(`[imageCompositor] Failed to process slot "${slot.slot_name}":`, err);
    return null;
  }
}

/**
 * Build an SVG text overlay buffer for a single text element.
 */
function buildTextOverlaySVG(
  overlay: TextOverlayConfig,
  templateWidth: number,
  templateHeight: number
): Buffer {
  const fontWeight = overlay.font_weight === 'bold' ? 'bold' : 'normal';
  const escapedContent = overlay.content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const svg = `<svg width="${templateWidth}" height="${templateHeight}" xmlns="http://www.w3.org/2000/svg">
    <text
      x="${overlay.x}"
      y="${overlay.y}"
      font-size="${overlay.font_size}"
      font-weight="${fontWeight}"
      fill="${overlay.color}"
      font-family="Arial, Helvetica, sans-serif"
    >${escapedContent}</text>
  </svg>`;

  return Buffer.from(svg);
}

/**
 * A placement's source rect, in subject pixels, made legal for sharp.
 *
 * `extract` throws when the window leaves the image, and an out-of-bounds
 * window is a template author dragging a crop too far — a framing problem, not
 * a job-ending one. Clamping to the photograph keeps the aspect and the headroom
 * the placement engine computed for everything a real image can supply.
 */
function cropWindow(
  source: Rect,
  imageWidth: number,
  imageHeight: number
): { left: number; top: number; width: number; height: number } | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const left = Math.max(0, Math.min(Math.round(source.x), imageWidth - 1));
  const top = Math.max(0, Math.min(Math.round(source.y), imageHeight - 1));
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(source.width), imageWidth - left)),
    height: Math.max(1, Math.min(Math.round(source.height), imageHeight - top)),
  };
}

/**
 * §9's encode choice, as a rule rather than a table: when the composite keeps
 * any transparency the answer is PNG (JPEG cannot carry it and would silently
 * fill the plate's own hole with black), and when it is fully opaque both
 * encoders run and the smaller buffer wins, PNG on a tie. Comparing the two
 * real encodings is also what keeps this honest across libvips upgrades — a
 * hardcoded "photographs are JPEG" would be a guess about an encoder's output.
 */
export async function chooseEncode(
  image: Buffer,
  jpegQuality: number
): Promise<{ buffer: Buffer; mimeType: string }> {
  const png = await sharp(image).png().toBuffer();
  if (await hasTransparency(image)) return { buffer: png, mimeType: 'image/png' };

  const jpeg = await sharp(image)
    .flatten()
    .jpeg({ quality: Math.round(jpegQuality) })
    .toBuffer();
  return jpeg.byteLength < png.byteLength
    ? { buffer: jpeg, mimeType: 'image/jpeg' }
    : { buffer: png, mimeType: 'image/png' };
}

/** True when any pixel is not fully opaque. Reads the alpha band, never the encoded bytes (§2). */
async function hasTransparency(image: Buffer): Promise<boolean> {
  const { data } = await sharp(image)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i++) if (data[i] < 255) return true;
  return false;
}

/** The face the §8.2 clip protects, in canvas coordinates, with the preset's strength. */
type FaceSafeSpec = { face: Rect; strength: number };

/**
 * Main compositor function.
 * Takes the template background (bytes or URL), processes all photo slots
 * (sorted by z_index), composites them onto the background under any shadow
 * underlays, adds text overlays, and returns the final image plus the mime type
 * it was encoded as.
 */
export async function compositeImage(input: CompositorInput): Promise<CompositorResult> {
  const { templateUrl, templateBytes, templateWidth, templateHeight, slots, textOverlays = [] } = input;
  if (!templateBytes && !templateUrl) {
    throw new Error('compositeImage needs templateBytes or templateUrl');
  }

  // 1. Prepare the background template. Bytes win: the runner has already paid
  // for this read, and a signed URL fetched a second time inside a claimed job
  // can fail on expiry. With only a URL this is P1's fetch, in P1's position.
  const templateBuffer = templateBytes ?? await fetchImageBuffer(templateUrl as string);
  const base = sharp(templateBuffer).resize(templateWidth, templateHeight, { fit: 'fill' });

  // 2. Sort slots by z_index ascending (lower z_index rendered first / behind)
  const sortedSlots = [...slots].sort((a, b) => a.z_index - b.z_index);

  // 3. Process all photo slots in parallel
  const slotOverlays = await Promise.all(
    sortedSlots.map((slot) => processSlot(slot, templateWidth, templateHeight, input.faceSafe ?? null))
  );

  // 4. Sort text overlays by z_index
  const sortedTextOverlays = [...textOverlays].sort((a, b) => a.z_index - b.z_index);

  // 5. Build text overlay composites
  const textComposites: OverlayOptions[] = sortedTextOverlays
    .filter((o) => o.content?.trim())
    .map((overlay) => ({
      input: buildTextOverlaySVG(overlay, templateWidth, templateHeight),
      top: 0,
      left: 0,
      blend: 'over',
    }));

  // 6. Combine all overlays (§7's underlays first — they sit under every slot,
  // then photo slots in z_index order, then text)
  const allOverlays: OverlayOptions[] = [
    ...(input.underlays ?? []).map((layer) => ({
      input: layer.buffer,
      left: Math.round(layer.left),
      top: Math.round(layer.top),
      blend: 'over',
    }) as OverlayOptions),
    ...slotOverlays.filter((o): o is OverlayOptions => o !== null),
    ...textComposites,
  ];

  // 7. Composite everything onto the base template
  const finalBuffer = await base.composite(allOverlays).png().toBuffer();

  // 8. §9's encode choice, asked for only by a blend caller that has a quality
  // to spend. Absent means step 7's PNG, byte for byte what P1 returned.
  const quality = input.jpegQuality;
  const encoded = typeof quality === 'number' && Number.isFinite(quality) && quality > 0
    ? await chooseEncode(finalBuffer, quality)
    : { buffer: finalBuffer, mimeType: 'image/png' };

  const meta = await sharp(encoded.buffer).metadata();

  return {
    buffer: encoded.buffer,
    mimeType: encoded.mimeType,
    width: meta.width ?? templateWidth,
    height: meta.height ?? templateHeight,
  };
}
