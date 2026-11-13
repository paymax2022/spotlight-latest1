// Both admin surfaces used to upload the beat through POST /api/registration/uploads
// and store the owner-only URL it returned, which is exactly how every artist
// ended up with a beat they could not play. The guard: they target the dedicated
// beat route, store what it returns, and say so when a row predates the fix.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const BUILDER = read('components/openmic/OpenMicAdminContestBuilder.tsx');
const EDITOR = read('components/openmic/OpenMicAdminContestEditor.tsx');

describe('admin beat upload wiring', () => {
  it('sends both forms to the public beat route', () => {
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toContain('/api/admin/open-mic/beats');
      expect(source).not.toContain('/api/registration/uploads');
    }
  });

  it('stores the reader paths the route returns, and refuses to store nothing', () => {
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/payload\?\.beat\?\.previewUrl|beat\.previewUrl/);
      expect(source).toMatch(/beat\.downloadUrl|payload\?\.beat\?\.downloadUrl/);
      // Without this, a 201 whose payload lost the URL writes an empty
      // beatDownloadUrl, submit() then complains about a field the admin just
      // filled with a successful upload.
      expect(source).toMatch(/if \(!downloadUrl\) throw/);
    }
  });

  it('warns an admin re-opening a legacy edition instead of leaving it silent', () => {
    // Call sites, not identifiers: an import that is never called would satisfy
    // toContain('isLegacyBeatUrl') while rendering no warning at all.
    expect(BUILDER).toContain('isLegacyBeatUrl(form.beatDownloadUrl)');
    expect(EDITOR).toContain('isLegacyBeatUrl(form.downloadUrl)');
    expect(EDITOR).toMatch(/re-upload/i);
  });

  it('offers only the format the route actually accepts', () => {
    // Task 2's route answers 400 for any extension that is not .mp3 and any
    // declared type outside {'', audio/mp3, audio/mpeg}. Both pickers still
    // advertise .wav and .m4a, which invites an admin to upload a file the
    // server refuses — and the legacy-URL warning cannot explain that, because
    // the field stays empty, so isLegacyBeatUrl('') is false.
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/accept="\.mp3"/);
      expect(source).not.toMatch(/accept="[^"]*\.(wav|m4a)/);
      expect(source).not.toContain('(MP3/WAV)');
    }
  });

  it('flags any pasted URL an artist cannot open, not only a legacy one', () => {
    // isLegacyBeatUrl is an admin diagnostic for the pre-fix upload path; it
    // deliberately does not answer "will this play for an artist?". The public
    // reader allowlists /api/open-mic/beats/, so an absolute third-party URL —
    // exactly what placeholder="https://..." advertises — is unusable while
    // looking perfectly fillable. Both forms must ask publicBeatUrl.
    //
    // Each call site names the field it guards, so a preview URL cannot be
    // swapped into the download field (or vice versa) and still pass.
    expect(BUILDER).toContain('publicBeatUrl(form.beatDownloadUrl) === null');
    expect(BUILDER).toContain('publicBeatUrl(form.beatPreviewUrl) === null');
    expect(EDITOR).toContain('publicBeatUrl(form.downloadUrl) === null');
    for (const source of [BUILDER, EDITOR]) {
      expect(source).not.toContain('placeholder="https://..."');
      expect(source).toMatch(/Upload the mp3\s+instead/i);
    }
    // The help copy that made pasting an off-site URL look like a supported path.
    expect(BUILDER).not.toContain('You can paste a direct URL');
  });

  it('authorises the upload without declaring a content type', () => {
    // The two regressions that actually break a beat upload, and neither is a
    // type error: no header at all is a 401, and adminAuthHeaders(true) adds
    // Content-Type: application/json, which overrides the FormData's multipart
    // boundary and makes the route answer 400 "Expected a multipart upload".
    // The submit calls use (true) — those are JSON — so match the (false) form
    // of the header line itself, not just the identifier.
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/headers:\s*await adminAuthHeaders\(false\)/);
    }
    expect(EDITOR).toContain('contestId=${encodeURIComponent(contest.id)}');
  });
});
