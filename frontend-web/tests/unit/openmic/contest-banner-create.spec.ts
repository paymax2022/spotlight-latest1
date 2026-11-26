import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createContest } from '@/src/server/openmic/store';

describe('Open Mic contest creation', () => {
  it('keeps the uploaded banner URL on the created edition', () => {
    const bannerImageUrl = '/api/admin/contests/banner/YmFubmVyLWtleQ';
    const result = createContest({
      title: 'Bannered monthly edition',
      slug: `bannered-monthly-edition-${randomUUID()}`,
      description: 'Monthly Open Mic edition.',
      month: 11,
      year: 2026,
      bannerImageUrl,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.contest.bannerImageUrl).toBe(bannerImageUrl);
  });
});
