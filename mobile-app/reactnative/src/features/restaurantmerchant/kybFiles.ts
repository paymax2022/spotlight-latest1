// ── KYB document files — pure rules ──────────────────────────────────────────
// What a KYB document upload may be. Kept free of react-native / expo imports so
// it runs under `node --test` (see __tests__/kybFiles.test.ts), and kept in step
// with the Go side (backend/internal/restaurant/kyb_documents.go,
// kybContentTypeByExt): the backend only signs an upload whose Content-Type
// matches its file extension, so the type here is derived from the extension and
// never taken from the picker's reported mime type.

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The mime types to offer the document picker. */
export const KYB_PICKER_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/**
 * Largest file we will try to send. The presigned PUT cannot bind a size, so this
 * is a courtesy check that spares the owner a slow upload of something huge — the
 * real limits are R2's and the reviewer's patience, not a security boundary.
 */
export const KYB_MAX_BYTES = 10 * 1024 * 1024;

/** Lower-cased extension without the dot, or '' when there is none. */
function extensionOf(fileName: string): string {
  const base = fileName.trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

/** The Content-Type the backend will sign for this file name, or null if it won't. */
export function kybContentType(fileName: string): string | null {
  return CONTENT_TYPE_BY_EXT[extensionOf(fileName)] ?? null;
}

/**
 * Why a picked file can't be uploaded, in words for the owner — or null when it can.
 * `size` is optional because some pickers don't report one; an unknown size is let
 * through and checked again against the real blob before sending.
 */
export function kybFileProblem(file: { name: string; size?: number | null }): string | null {
  if (!kybContentType(file.name)) {
    return 'Choose a PDF, PNG, JPG or WEBP file.';
  }
  if (typeof file.size === 'number' && file.size <= 0) {
    return 'That file looks empty. Choose a different one.';
  }
  if (typeof file.size === 'number' && file.size > KYB_MAX_BYTES) {
    return `That file is too large. Keep it under ${KYB_MAX_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

/** A pasted link is usable only if it is a plain http(s) URL — the backend rejects the rest. */
export function isWebLink(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}
