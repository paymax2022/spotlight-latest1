// Local filesystem fallback for uploads.
// Cloudflare R2 is the durable store in production. In local development (and
// any environment where the R2_* env vars are not set) `hasR2Config()` is false
// and the registration upload routes fall back to this helper so uploads still
// work end-to-end without any cloud credentials. Files live outside the repo in
// `~/.spotlight/registration-uploads/<key>` by default so OS temp cleanup cannot
// invalidate persisted upload URLs. `LOCAL_UPLOAD_DIR` can override that root.
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
  return process.env.LOCAL_UPLOAD_DIR || path.join(os.homedir(), '.spotlight', 'registration-uploads');
}

// Resolve a key to an absolute path, refusing anything that escapes the root.
function resolveLocalPath(key: string, root = getLocalUploadRoot()): string {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, key);
  const rootWithSep = absoluteRoot.endsWith(path.sep) ? absoluteRoot : absoluteRoot + path.sep;
  if (target !== absoluteRoot && !target.startsWith(rootWithSep)) {
    throw new Error('Invalid upload key');
  }
  return target;
}

export function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

export async function saveLocalUpload(key: string, buffer: Buffer): Promise<void> {
  const root = path.resolve(getLocalUploadRoot());
  const target = resolveLocalPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!process.env.LOCAL_UPLOAD_DIR) {
    await fs.chmod(root, 0o700);
    await fs.chmod(path.dirname(target), 0o700);
  }
  await fs.writeFile(target, buffer, { mode: 0o600 });
  await fs.chmod(target, 0o600);
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

/**
 * The roots an object may live in, most authoritative first.
 *
 * The default moved out of the OS temp directory because that directory is
 * swept — macOS clears it, and a container loses it on every restart — so an
 * edition can keep its beat row while its bytes disappear underneath it, and the
 * applicant is told the beat does not exist. The old location stays readable so
 * those objects are recovered rather than orphaned. An explicit
 * `LOCAL_UPLOAD_DIR` is a promise about where the bytes are, so it stays
 * isolated and no legacy root is consulted.
 */
function candidateRoots(): string[] {
  const root = path.resolve(getLocalUploadRoot());
  if (process.env.LOCAL_UPLOAD_DIR) return [root];
  const legacy = path.resolve(path.join(os.tmpdir(), 'spotlight-registration-uploads'));
  return legacy === root ? [root] : [root, legacy];
}

/**
 * Copy a retired-location object into the durable root, so the next request (and
 * the next OS clean) does not depend on it still being there.
 *
 * Best-effort by design: losing the promotion leaves the object exactly where it
 * is today, whereas failing the request because a copy could not be made turns a
 * storage detail into a broken download.
 */
async function promoteToDurableRoot(key: string, source: string): Promise<void> {
  const target = resolveLocalPath(key);
  try {
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(path.resolve(getLocalUploadRoot()), 0o700);
    await fs.chmod(dir, 0o700);
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    await fs.chmod(target, 0o600);
  } catch {
    /* already promoted, raced with another request, or not writable — the read below still works */
  }
}

/**
 * Where a stored object actually is, or null when no root holds it.
 *
 * One resolution shared by every reader. That agreement is the point: a whole-file
 * read, a size probe and a byte-range read that each compute their own path are
 * free to disagree about whether the same object exists — and the surface that
 * uses the weaker one is the surface the user watches fail. The beat download is
 * exactly such a reader (`statLocalUpload` then `readLocalUploadRange`), which is
 * how an object `readLocalUpload` could already find still answered 404.
 */
async function resolveStoredPath(key: string): Promise<{ file: string } | null> {
  const root = path.resolve(getLocalUploadRoot());
  for (const candidate of candidateRoots()) {
    let target: string;
    try {
      target = resolveLocalPath(key, candidate);
    } catch {
      return null; // a key that escapes the root is invalid, not misplaced
    }
    if (await isFile(target)) {
      if (candidate !== root) await promoteToDurableRoot(key, target);
      return { file: target };
    }
  }
  return null;
}

export async function readLocalUpload(key: string): Promise<Buffer | null> {
  const found = await resolveStoredPath(key);
  if (!found) return null;
  try {
    return await fs.readFile(found.file);
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
  const found = await resolveStoredPath(key);
  if (!found) return null;
  try {
    return { sizeBytes: (await fs.stat(found.file)).size };
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
  const found = await resolveStoredPath(key);
  if (!found) return null;
  let handle;
  try {
    handle = await fs.open(found.file, 'r');
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
