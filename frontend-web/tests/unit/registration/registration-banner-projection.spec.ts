import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';
import { getRegistrationVoting } from '@/src/server/registration-v2/registration-voting';

describe('registration contest banner projection', () => {
  it('includes the contest banner before an application is approved or promoted', async () => {
    const rows = {
      registrations: {
        id: 'registration-1',
        status: 'submitted',
        contest_slug: 'golibe-festival-talent-hunt',
      },
      contests: {
        name: 'Golibe Festival Talent Hunt',
        description: 'Festival talent competition',
        banner_image_url: '/api/admin/contests/banner/banner-key',
      },
    };
    const client = {
      from(table: keyof typeof rows) {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: rows[table], error: null }),
        };
        return query;
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const result = await getRegistrationVoting('registration-1');

    expect(result).toMatchObject({
      reason: 'not_approved',
      contest: null,
      contestBanner: {
        title: 'Golibe Festival Talent Hunt',
        description: 'Festival talent competition',
        bannerImageUrl: '/api/admin/contests/banner/banner-key',
      },
    });
  });
});
