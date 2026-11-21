// Local filesystem fallback for uploads.
// Cloudflare R2 is the durable store in production. In local development (and
// any environment where the R2_* env vars are not set) `hasR2Config()` is false
// and the registration upload routes fall back to this helper so uploads still
// work end-to-end without any cloud credentials.
// Files are written under `<cwd>/.uploads/<key>` where `<key>` is the same
// slash-namespaced object key R2 would use (e.g.
// `registration/<userId>/<uuid>.png`). Keys are validated by the callers
// (must start with `registration/`, no `..`) before reaching this module.
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function getLocalUploadRoot(): string {
  // Keep uploads OUT of the project directory: writing under the repo makes the
  // Next.js dev file-watcher recompile on every upload (a reload loop that
  // breaks in-flight requests). Use the OS temp dir instead.
  return process.env.LOCAL_UPLOAD_DIR || path.join(os.tmpdir(), 'spotlight-registration-uploads');
}

// Resolve a key to an absolute path, refusing anything that escapes the root.
function resolveLocalPath(key: string): string {
  const root = getLocalUploadRoot();
  const target = path.resolve(root, key);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error('Invalid upload key');
  }
  return target;
}

export function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

export async function saveLocalUpload(key: string, buffer: Buffer): Promise<void> {
  const target = resolveLocalPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
}

export async function readLocalUpload(key: string): Promise<Buffer | null> {
  try {
    const target = resolveLocalPath(key);
    return await fs.readFile(target);
  } catch {
    return null;
  }
}

/**
 * Size of a stored object, or null when it is not there.
 *
 * The upload-complete routes need "did the bytes land?" without reading a
 * 50 MB song into memory the way `readLocalUpload` would.
 */
export async function statLocalUpload(key: string): Promise<{ sizeBytes: number } | null> {
  try {
    const target = resolveLocalPath(key);
    const stats = await fs.stat(target);
    return stats.isFile() ? { sizeBytes: stats.size } : null;
  } catch {
    return null;
  }
}

/**
 * Byte slice of a stored object, for ranged audio/video playback.
 *
 * `end` is inclusive, like the HTTP Range header it serves. Seek works in the
 * browser only when the reader can answer 206 with the right Content-Range, so
 * the local fallback has to support slicing and not just whole-file reads —
 * otherwise development gets a player that plays once and then cannot scrub.
 * Returns `totalBytes` of the whole object so the caller can build the header.
 */
export async function readLocalUploadRange(
  key: string,
  range: { start: number; end?: number },
): Promise<{ buffer: Buffer; start: number; end: number; totalBytes: number } | null> {
  const target = resolveLocalPath(key);
  let handle;
  try {
    handle = await fs.open(target, 'r');
  } catch {
    return null;
  }
  try {
    const { size: totalBytes } = await handle.stat();
    if (totalBytes === 0) return { buffer: Buffer.alloc(0), start: 0, end: -1, totalBytes };
    const start = Math.max(0, range.start);
    if (start >= totalBytes) return { buffer: Buffer.alloc(0), start, end: start, totalBytes };
    const end = range.end === undefined ? totalBytes - 1 : Math.min(range.end, totalBytes - 1);
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return { buffer, start, end, totalBytes };
  } finally {
    await handle.close();
  }
}
