// ── Store logo / banner images — pure rules ──────────────────────────────────
// What a store image may be, and how a picked photo gets the file name the server needs.
// Kept free of react-native / expo imports so it runs under `node --test`, and kept in
// step with the Go side (backend/internal/restaurant/store_images.go,
// storeImageContentTypeByExt): the backend only signs an upload whose Content-Type
// matches its file extension, so the type is DERIVED from the extension here and never
// taken from the picker's reported mime type. SVG is deliberately absent — it can carry
// script, and these images are shown to customers.

export type StoreImageKind = 'logo' | 'banner';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Largest image we will try to send. The presigned PUT cannot bind a size, so this is a
 * courtesy check that spares the owner a slow upload of something huge, not a security
 * boundary.
 */
export const STORE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Lower-cased extension without the dot, or '' when there is none. */
function extensionOf(name: string): string {
  const base = (name.split('?')[0] ?? '').trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

/** The Content-Type the backend will sign for this file name, or null if it won't. */
export function storeImageContentType(fileName: string): string | null {
  return CONTENT_TYPE_BY_EXT[extensionOf(fileName)] ?? null;
}

/** Why a picked image can't be uploaded, in words for the owner — or null when it can. */
export function storeImageProblem(file: { name: string; size?: number | null }): string | null {
  if (!storeImageContentType(file.name)) return 'Choose a PNG, JPG or WEBP picture.';
  if (typeof file.size === 'number' && file.size <= 0) return 'That picture looks empty. Choose a different one.';
  if (typeof file.size === 'number' && file.size > STORE_IMAGE_MAX_BYTES) {
    return `That picture is too large. Keep it under ${STORE_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

/**
 * A usable file name for a picked photo, or null when none can be made.
 *
 * The photo picker often reports no file name (Android, web), and the backend needs an
 * extension to choose the content type. So: use the reported name if it is an allowed
 * type; otherwise build `<kind>.<ext>` from the mime type; otherwise from the uri. Never
 * a guess — an image type we don't accept (HEIC, GIF…) yields null so the owner is told.
 */
export function storeImageFileName(
  asset: { uri: string; fileName?: string | null; mimeType?: string | null },
  kind: StoreImageKind,
): string | null {
  if (asset.fileName && storeImageContentType(asset.fileName)) return asset.fileName;
  const fromMime = EXT_BY_MIME[(asset.mimeType ?? '').toLowerCase()];
  if (fromMime) return `${kind}.${fromMime}`;
  const fromUri = extensionOf(asset.uri);
  if (CONTENT_TYPE_BY_EXT[fromUri]) return `${kind}.${fromUri}`;
  return null;
}
