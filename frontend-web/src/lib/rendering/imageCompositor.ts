/**
 * Server-side Image Compositor
 * Uses Sharp to merge contestant photos into template slot positions
 * and generate final composite images stored in Supabase storage.
 */

import sharp, { OverlayOptions, FitEnum } from 'sharp';
import { isAllowedRemoteImageUrl } from '@/lib/config/media-hosts';

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
  templateUrl: string;
  templateWidth: number;
  templateHeight: number;
  slots: SlotConfig[];
  textOverlays?: TextOverlayConfig[];
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
 */
async function processSlot(
  slot: SlotConfig,
  _templateWidth: number,
  _templateHeight: number
): Promise<OverlayOptions | null> {
  if (!slot.photo_url) return null;

  try {
    const rawBuffer = await fetchImageBuffer(slot.photo_url);

    const slotWidth = Math.round(slot.width * slot.scale);
    const slotHeight = Math.round(slot.height * slot.scale);

    // Determine Sharp fit mode from crop_mode
    const fitMap: Record<string, keyof FitEnum> = {
      cover: 'cover',
      contain: 'contain',
      fill: 'fill',
      none: 'inside',
    };
    const fit = fitMap[slot.crop_mode] ?? 'cover';

    let processed = sharp(rawBuffer).resize(slotWidth, slotHeight, { fit });

    // Apply rotation if needed
    if (slot.rotation !== 0) {
      processed = processed.rotate(slot.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    // Convert to PNG for transparency support
    // Annotated as the general Buffer: sharp 0.35's toBuffer() returns the
    // narrower Buffer<ArrayBuffer>, but applyBorderRadius below returns a plain
    // Buffer (Buffer<ArrayBufferLike>), which will not assign into the narrowed
    // inferred type.
    let processedBuffer: Buffer = await processed.png().toBuffer();

    // Apply border radius (circular frames etc.)
    if (slot.border_radius > 0) {
      processedBuffer = await applyBorderRadius(
        processedBuffer,
        slotWidth,
        slotHeight,
        slot.border_radius
      );
    }

    // Apply opacity via raw pixel manipulation if < 1
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

    // Clamp position to template bounds
    const left = Math.max(0, Math.round(slot.x));
    const top = Math.max(0, Math.round(slot.y));

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
 * Main compositor function.
 * Fetches the template background, processes all photo slots (sorted by z_index),
 * composites them onto the background, adds text overlays, and returns the final PNG buffer.
 */
export async function compositeImage(input: CompositorInput): Promise<CompositorResult> {
  const { templateUrl, templateWidth, templateHeight, slots, textOverlays = [] } = input;

  // 1. Fetch and prepare the background template
  const templateBuffer = await fetchImageBuffer(templateUrl);
  const base = sharp(templateBuffer).resize(templateWidth, templateHeight, { fit: 'fill' });

  // 2. Sort slots by z_index ascending (lower z_index rendered first / behind)
  const sortedSlots = [...slots].sort((a, b) => a.z_index - b.z_index);

  // 3. Process all photo slots in parallel
  const slotOverlays = await Promise.all(
    sortedSlots.map((slot) => processSlot(slot, templateWidth, templateHeight))
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

  // 6. Combine all overlays (photo slots + text)
  const allOverlays: OverlayOptions[] = [
    ...slotOverlays.filter((o): o is OverlayOptions => o !== null),
    ...textComposites,
  ];

  // 7. Composite everything onto the base template
  const finalBuffer = await base.composite(allOverlays).png().toBuffer();

  const meta = await sharp(finalBuffer).metadata();

  return {
    buffer: finalBuffer,
    mimeType: 'image/png',
    width: meta.width ?? templateWidth,
    height: meta.height ?? templateHeight,
  };
}
