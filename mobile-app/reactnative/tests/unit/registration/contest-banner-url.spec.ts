import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContestBannerUrl } from '@/features/registration/utils/contest-banner-url';

describe('resolveContestBannerUrl', () => {
  it('resolves a root-relative banner URL against the configured API origin', () => {
    assert.equal(
      resolveContestBannerUrl('/api/admin/contests/banner/key', 'http://localhost:3000/api/v1'),
      'http://localhost:3000/api/admin/contests/banner/key',
    );
  });

  it('keeps already absolute banner URLs unchanged', () => {
    const url = 'https://cdn.example.com/contest-banner.png';
    assert.equal(resolveContestBannerUrl(url, 'http://localhost:3000'), url);
  });

  it('returns null for an absent banner URL', () => {
    assert.equal(resolveContestBannerUrl(null, 'http://localhost:3000'), null);
  });
});
