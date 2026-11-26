/**
 * Task 6 — reading an asset's bytes back from whichever store holds them.
 *
 * Two properties matter more than coverage here. The first is that the function
 * answers `null` instead of throwing: it runs inside a claimed job, and a throw
 * would look like a runner bug rather than a storage answer. The second is that
 * a `provider_url` is never fetched just because a row contains it — a
 * background job with no user in the loop reading an arbitrary URL from the
 * database is an SSRF primitive, so the host allowlist the compositor already
 * uses guards this door too, and the test that pins it asserts `fetch` was not
 * called rather than only that the result was null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  hasR2Config: vi.fn(),
  readR2Object: vi.fn(),
  readLocalUpload: vi.fn(),
  isAllowedRemoteImageUrl: vi.fn(),
}));

vi.mock('@/src/lib/storage/r2', () => ({ hasR2Config: deps.hasR2Config, readR2Object: deps.readR2Object }));
vi.mock('@/src/lib/storage/local-uploads', () => ({ readLocalUpload: deps.readLocalUpload }));
vi.mock('@/lib/config', () => ({ isAllowedRemoteImageUrl: deps.isAllowedRemoteImageUrl }));

import { readAssetBytes } from '@/src/server/photo-jobs/assets';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  deps.hasR2Config.mockReturnValue(true);
  deps.isAllowedRemoteImageUrl.mockReturnValue(true);
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  vi.stubGlobal('fetch', fetchMock);
});

describe('readAssetBytes', () => {
  it('reads a storage key straight from the bucket without a signed-URL round trip', async () => {
    deps.readR2Object.mockResolvedValue(Buffer.from('bytes'));
    expect(await readAssetBytes({ storage_key: 'contestants/composited/a.png', provider_url: null })).toEqual(
      Buffer.from('bytes'),
    );
    expect(deps.readR2Object).toHaveBeenCalledWith('contestants/composited/a.png');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the local upload store when the machine has no R2 credentials', async () => {
    deps.hasR2Config.mockReturnValue(false);
    deps.readLocalUpload.mockResolvedValue(Buffer.from('local'));
    const bytes = await readAssetBytes({ storage_key: 'registration/u1/photo.jpg', provider_url: null });
    expect(bytes).toEqual(Buffer.from('local'));
    expect(deps.readR2Object).not.toHaveBeenCalled();
  });

  it('fetches a provider URL whose host is allowlisted', async () => {
    const bytes = await readAssetBytes({ storage_key: null, provider_url: 'https://res.cloudinary.com/x.png' });
    expect(bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith('https://res.cloudinary.com/x.png', { cache: 'no-store' });
  });

  it('refuses an off-allowlist provider URL without fetching it', async () => {
    deps.isAllowedRemoteImageUrl.mockReturnValue(false);
    expect(await readAssetBytes({ storage_key: null, provider_url: 'http://169.254.169.254/latest/meta-data' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers null for a missing object, an error status and a thrown storage fault', async () => {
    deps.readR2Object.mockResolvedValue(null);
    expect(await readAssetBytes({ storage_key: 'gone.png', provider_url: null })).toBeNull();

    deps.readR2Object.mockRejectedValue(new Error('credentials rejected'));
    expect(await readAssetBytes({ storage_key: 'a.png', provider_url: null })).toBeNull();

    fetchMock.mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    expect(await readAssetBytes({ storage_key: null, provider_url: 'https://res.cloudinary.com/x.png' })).toBeNull();
  });

  it('answers null, not a crash, when the row names no location at all', async () => {
    expect(await readAssetBytes({ storage_key: null, provider_url: null })).toBeNull();
  });

  it('prefers the storage key when a row carries both', async () => {
    deps.readR2Object.mockResolvedValue(Buffer.from('from-key'));
    expect(await readAssetBytes({ storage_key: 'a.png', provider_url: 'https://cdn.test/a.png' })).toEqual(
      Buffer.from('from-key'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
