// ─────────────────────────────────────────────────────────────────────────────
// Local filesystem fallback for uploads.
//
// Cloudflare R2 is the durable store in production. In local development (and
// any environment where the R2_* env vars are not set) `hasR2Config()` is false
// and the registration upload routes fall back to this helper so uploads still
// work end-to-end without any cloud credentials.
//
// Files are written under `<cwd>/.uploads/<key>` where `<key>` is the same
// slash-namespaced object key R2 would use (e.g.
// `registration/<userId>/<uuid>.png`). Keys are validated by the callers
// (must start with `registration/`, no `..`) before reaching this module.
// ─────────────────────────────────────────────────────────────────────────────
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
