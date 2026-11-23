import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getLocalUploadRoot, readLocalUpload, readLocalUploadRange, saveLocalUpload, statLocalUpload } from '../../../src/lib/storage/local-uploads';

const tempRoots: string[] = [];
const tempFiles: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotlight-local-uploads-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([
    ...tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    ...tempFiles.splice(0).map((file) => rm(file, { force: true })),
  ]);
});

describe('local upload storage', () => {
  it('uses a persistent home directory outside the OS temp directory by default', () => {
    vi.stubEnv('LOCAL_UPLOAD_DIR', '');
    expect(getLocalUploadRoot()).toBe(path.join(os.homedir(), '.spotlight', 'registration-uploads'));
  });

  it('writes local files with private permissions', async () => {
    const root = path.join(await makeTempRoot(), 'uploads');
    const key = 'registration/user-1/photo.jpg';
    vi.stubEnv('LOCAL_UPLOAD_DIR', root);

    await saveLocalUpload(key, Buffer.from('photo'));

    expect(await readLocalUpload(key)).toEqual(Buffer.from('photo'));
    expect((await stat(path.join(root, 'registration', 'user-1'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, key))).mode & 0o777).toBe(0o600);
  });

  it('migrates existing temporary uploads into persistent storage on read', async () => {
    const temp = await makeTempRoot();
    const home = path.join(temp, 'home');
    const tempDir = path.join(temp, 'old-temp');
    const key = 'registration/user-2/photo.jpg';
    vi.stubEnv('HOME', home);
    vi.stubEnv('TMPDIR', tempDir);
    vi.stubEnv('LOCAL_UPLOAD_DIR', '');

    const legacyFile = path.join(os.tmpdir(), 'spotlight-registration-uploads', key);
    tempFiles.push(legacyFile);
    await mkdir(path.dirname(legacyFile), { recursive: true, mode: 0o700 });
    await writeFile(legacyFile, Buffer.from('legacy photo'), { mode: 0o600 });

    await expect(readLocalUpload(key)).resolves.toEqual(Buffer.from('legacy photo'));
    await expect(readFile(path.join(home, '.spotlight', 'registration-uploads', key)))
      .resolves.toEqual(Buffer.from('legacy photo'));
  });

  // WHY THIS IS SEPARATE FROM THE TEST ABOVE. `readLocalUpload` learned the old
  // temp root; the beat and song readers never did. They go through
  // `statLocalUpload` (does the object exist, and how big is it?) and
  // `readLocalUploadRange` (which slice to stream), so an edition whose beat was
  // written before the default moved stayed invisible to exactly the one surface
  // that hands the file to an applicant — the download answered 404 "Audio not
  // available" for bytes that were sitting on the disk a few directories away.
  // All three entry points have to agree on where an object lives.
  it('the ranged audio readers see an object left in the old temp root', async () => {
    const temp = await makeTempRoot();
    const home = path.join(temp, 'home');
    const tempDir = path.join(temp, 'old-temp');
    const key = 'openmic-beats/contest-1/beat-1.mp3';
    vi.stubEnv('HOME', home);
    vi.stubEnv('TMPDIR', tempDir);
    vi.stubEnv('LOCAL_UPLOAD_DIR', '');

    const legacyFile = path.join(os.tmpdir(), 'spotlight-registration-uploads', key);
    tempFiles.push(legacyFile);
    await mkdir(path.dirname(legacyFile), { recursive: true, mode: 0o700 });
    await writeFile(legacyFile, Buffer.alloc(1234, 9), { mode: 0o600 });

    await expect(statLocalUpload(key)).resolves.toEqual({ sizeBytes: 1234 });

    const slice = await readLocalUploadRange(key, { start: 0, end: 99 });
    expect(slice?.buffer.byteLength).toBe(100);
    expect(slice?.totalBytes).toBe(1234);

    // Serving the bytes is only half of it. The temp directory is the location
    // that already failed once, so a ranged read has to promote the object the
    // same way `readLocalUpload` does — otherwise the beat plays today and 404s
    // again the next time the OS or the container cleans up.
    await expect(readFile(path.join(home, '.spotlight', 'registration-uploads', key)))
      .resolves.toEqual(Buffer.alloc(1234, 9));
  });
});
