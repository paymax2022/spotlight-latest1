// The upload works because of what the request does NOT carry: no Content-Type (the browser has to
// add the multipart boundary itself) and no Authorization (the web-proxy attaches the bearer from
// the HttpOnly cookie). Both are one-token refactors away from being "tidied up", and neither would
// fail beat-upload.test.tsx — which mocks this service — type-check, or CI. This file is the only
// guard, so it must not mock the module under test.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadOpenMicBeat } from '@/services/openMicAdminService';

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(body: unknown, ok = true, status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return { ok, status, json: async () => body } as unknown as Response;
  }));
  return calls;
}

const mp3 = () => new File([new Uint8Array([1, 2, 3])], 'beat.mp3', { type: 'audio/mp3' });
const OK = { success: true, beat: { previewUrl: '/api/open-mic/beats/k', downloadUrl: '/api/open-mic/beats/k?download=1' } };

afterEach(() => vi.unstubAllGlobals());

describe('uploadOpenMicBeat request shape', () => {
  it('posts the mp3 as multipart to the beat route through the web proxy', async () => {
    const calls = stubFetch(OK);
    await uploadOpenMicBeat(mp3());
    expect(calls).toHaveLength(1);
    // Origin-agnostic: jsdom's location is not the deployment origin.
    expect(calls[0].url).toMatch(/\/api\/web-proxy\/api\/admin\/open-mic\/beats$/);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect((calls[0].init?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('declares no headers, so the boundary and the proxy bearer both survive', async () => {
    const calls = stubFetch(OK);
    await uploadOpenMicBeat(mp3());
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    for (const name of ['Content-Type', 'content-type', 'Authorization', 'authorization']) {
      expect(headers, name).not.toHaveProperty(name);
    }
  });

  it('scopes the object key to a contest only when one is given', async () => {
    const bare = stubFetch(OK);
    await uploadOpenMicBeat(mp3());
    expect(bare[0].url).not.toContain('contestId');
    const scoped = stubFetch(OK);
    await uploadOpenMicBeat(mp3(), 'c/1');
    expect(scoped[0].url).toContain('contestId=c%2F1');
  });

  it('returns the two reader paths and refuses to hand back an empty beat', async () => {
    stubFetch(OK);
    await expect(uploadOpenMicBeat(mp3())).resolves.toEqual({
      previewUrl: '/api/open-mic/beats/k',
      downloadUrl: '/api/open-mic/beats/k?download=1',
    });

    stubFetch({ success: false, error: 'Beat must be an MP3 file' }, false, 400);
    await expect(uploadOpenMicBeat(mp3())).rejects.toThrow(/Beat must be an MP3 file/);

    // A success envelope with no URL is the shape that used to file an empty beat.
    stubFetch({ success: true, beat: { previewUrl: '/api/open-mic/beats/k' } });
    await expect(uploadOpenMicBeat(mp3())).rejects.toThrow(/no beat URL/);
  });
});
