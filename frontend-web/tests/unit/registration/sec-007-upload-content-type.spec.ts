/**
 * SEC-007: image upload safety spot-fix — reject SVG entirely (no sanitizer
 * exists for it) and never trust the client-supplied `file.type` for the
 * Content-Type served back on retrieval.
 *
 * Route under test: POST /api/registration/uploads (NOT in the
 * protect-legacy.sh blocked list — only registration store.ts / config.ts /
 * applications/*.ts are protected).
 *
 * Fixed as part of this pass: the route used to set
 * `contentType = file.type || 'application/octet-stream'` straight from the
 * client-controlled multipart `file.type` field, then used that value both
 * as the R2 object's stored Content-Type AND as `mimeType` in the response.
 * A file named "photo.png" with a spoofed `file.type: "image/svg+xml"` (or
 * "text/html") would be served back with that Content-Type header — some
 * browsers render the body per Content-Type regardless of URL extension,
 * turning an "image upload" into stored XSS. The fix derives Content-Type
 * from a server-owned extension→MIME map instead of trusting the client.
 *
 * `.svg` was already absent from the extension whitelist before this pass
 * (so raw .svg uploads were already rejected) — this test pins that AND the
 * new content-type-spoofing fix together.
 *
 * No malware scan / re-encode pipeline exists — that remains open (matches
 * the test plan's existing "no malware scan" note).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/auth/server', () => ({ requireUser: vi.fn() }));
vi.mock('@/src/lib/storage/r2', () => ({
  createR2UploadUrl: vi.fn(),
  createR2DownloadUrl: vi.fn(),
  hasR2Config: vi.fn().mockReturnValue(false),
}));
vi.mock('@/src/lib/storage/local-uploads', () => ({ saveLocalUpload: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '../../../app/api/registration/uploads/route';
import { requireUser } from '@/src/lib/auth/server';

function makeUploadRequest(fileName: string, declaredType: string, content = 'x') {
  const form = new FormData();
  const file = new File([content], fileName, { type: declaredType });
  form.set('file', file);
  return new Request('http://localhost/api/registration/uploads', { method: 'POST', body: form });
}

describe('SEC-007: registration upload content-type spoofing + SVG rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: 'user-1' } } as any);
  });

  it('rejects a .svg upload outright (no sanitizer exists for inline SVG)', async () => {
    const res = await POST(makeUploadRequest('avatar.svg', 'image/svg+xml'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported/i);
  });

  it('ignores a spoofed file.type and serves back the extension-derived, server-trusted content type', async () => {
    // Attacker names the file "photo.png" (passes the extension whitelist) but
    // declares file.type as image/svg+xml — trying to get SVG/XSS content
    // served back with an SVG Content-Type.
    const res = await POST(makeUploadRequest('photo.png', 'image/svg+xml', '<svg onload=alert(1)>'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.mimeType).toBe('image/png');
    expect(body.upload.mimeType).not.toBe('image/svg+xml');
  });

  it('ignores a spoofed text/html file.type on a .pdf upload', async () => {
    const res = await POST(makeUploadRequest('resume.pdf', 'text/html', '<script>alert(1)</script>'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.mimeType).toBe('application/pdf');
  });

  it('still rejects an unsupported extension regardless of a well-formed declared type', async () => {
    const res = await POST(makeUploadRequest('script.exe', 'image/png'));
    expect(res.status).toBe(400);
  });

  it('accepts a legitimate .png upload with a matching declared type (no regression)', async () => {
    const res = await POST(makeUploadRequest('avatar.png', 'image/png'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.mimeType).toBe('image/png');
    expect(body.upload.previewUrl).toMatch(/^\/api\/registration\/uploads\//);
  });
});
