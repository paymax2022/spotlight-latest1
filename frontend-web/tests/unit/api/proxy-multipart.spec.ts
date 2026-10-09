/**
 * proxyToGoBackend forced `Content-Type: application/json` and read every body
 * with `request.text()`. For a multipart upload that drops the boundary header
 * and mangles the binary bytes, so the Go handler's `FormFile("file")` failed and
 * POST /api/v1/insurance/uploads answered 400 "file is required" — insurance
 * fields that need a photo (ID image, device photo) could never be submitted.
 *
 * These specs pin that a multipart request reaches Go byte-for-byte with its
 * original Content-Type (boundary included), and that JSON bodies are unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proxyToGoBackend multipart passthrough', () => {
  it('forwards a multipart body byte-for-byte with its original boundary Content-Type', async () => {
    const { proxyToGoBackend } = await import('@/src/lib/go-backend');
    const form = new FormData();
    // Bytes that are not valid UTF-8: reading this as text would corrupt them.
    form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x81])], { type: 'image/jpeg' }), 'id.jpg');
    form.append('purpose', 'id_image_url');
    const request = new Request('https://app.test/api/v1/insurance/uploads', { method: 'POST', body: form });
    const incomingType = request.headers.get('content-type') as string;
    expect(incomingType).toMatch(/^multipart\/form-data; boundary=/);

    await proxyToGoBackend(request, '/api/finance/insurance/uploads');

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe(incomingType);

    // Re-parse what Go would receive: the file part must survive intact.
    const echoed = new Response(init.body as BodyInit, { headers: { 'content-type': headers['Content-Type'] } });
    const parsed = await echoed.formData();
    const file = parsed.get('file') as File;
    expect(file.name).toBe('id.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x81]);
    expect(parsed.get('purpose')).toBe('id_image_url');
  });

  it('still sends application/json for ordinary JSON bodies', async () => {
    const { proxyToGoBackend } = await import('@/src/lib/go-backend');
    const request = new Request('https://app.test/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    await proxyToGoBackend(request, '/api/finance/x');

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });
});
