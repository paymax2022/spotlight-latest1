// What an <audio src> may hold in this console. The song route answers with one
// of two shapes depending on how frontend-web is deployed, and only one of them
// works when pasted raw into a page served from :3001 — a root-relative path is
// relative to the *web app's* origin, so the admin console would answer its own
// request with a 404 and the operator would hear nothing at all.
import { describe, expect, it } from 'vitest';
import { playableSongSrc } from '@/features/openmic/song-src';

const PROXY = 'http://localhost:3001/api/web-proxy';

describe('playableSongSrc', () => {
  it('prefixes the proxy base onto the local reader path', () => {
    expect(playableSongSrc('/api/open-mic/songs/sub-1', PROXY)).toBe(`${PROXY}/api/open-mic/songs/sub-1`);
  });

  it('keeps a download query attached to the prefixed path', () => {
    expect(playableSongSrc('/api/open-mic/songs/sub-1?download=1', PROXY)).toBe(`${PROXY}/api/open-mic/songs/sub-1?download=1`);
  });

  it('passes a presigned bucket URL through untouched', () => {
    // Prefixing this would build a doubled, unreachable address — and the bucket
    // URL is the one shape that supports seeking, since it bypasses the proxy.
    const signed = 'https://bucket.r2.cloudflarestorage.com/openmic-songs/sub-1.mp3?X-Amz-Signature=abc';
    expect(playableSongSrc(signed, PROXY)).toBe(signed);
  });

  it('refuses anything that is not an http(s) URL or a root-relative path', () => {
    expect(playableSongSrc('songs/sub-1.mp3', PROXY)).toBeNull();
    expect(playableSongSrc('blob:http://localhost:3001/x', PROXY)).toBeNull();
    expect(playableSongSrc('data:audio/mpeg;base64,AAAA', PROXY)).toBeNull();
    expect(playableSongSrc('javascript:alert(1)', PROXY)).toBeNull();
  });

  it('answers null for nothing to play', () => {
    expect(playableSongSrc('', PROXY)).toBeNull();
    expect(playableSongSrc('   ', PROXY)).toBeNull();
    expect(playableSongSrc(null, PROXY)).toBeNull();
    expect(playableSongSrc(undefined, PROXY)).toBeNull();
  });

  it('refuses a relative path when it has no absolute base to hang it on', () => {
    // Server-side render and misconfiguration both land here; guessing the
    // scheme would hand the browser a src it cannot resolve.
    expect(playableSongSrc('/api/open-mic/songs/sub-1', '')).toBeNull();
    expect(playableSongSrc('/api/open-mic/songs/sub-1', 'localhost:3001/api/web-proxy')).toBeNull();
  });

  it('trims a trailing slash off the base so paths do not double up', () => {
    expect(playableSongSrc('/api/open-mic/songs/sub-1', `${PROXY}/`)).toBe(`${PROXY}/api/open-mic/songs/sub-1`);
  });
});
