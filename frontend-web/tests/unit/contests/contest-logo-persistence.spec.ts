// The admin-set contest logo must be written on create AND edit, and read back
// on the admin list. It lives in contests.logo_url, which the mirror trigger
// copies to connect_contests for the mobile app.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  insert: null as Record<string, unknown> | null,
  update: null as Record<string, unknown> | null,
  select: null as string | null,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        calls.insert = payload;
        return { select: () => ({ single: async () => ({ data: { id: 'c-1' }, error: null }) }) };
      },
      update: (payload: Record<string, unknown>) => {
        calls.update = payload;
        return { eq: async () => ({ error: null, count: 1 }) };
      },
      select: (cols: string) => {
        calls.select = cols;
        return { order: async () => ({ data: calls.rows, error: null }) };
      },
    }),
  }),
}));

vi.mock('@/src/server/contests/categories', () => ({
  resolveCategoryLabel: async () => 'Music',
}));

import {
  listPersistedContests,
  persistContestDefinition,
  updateContestDefinition,
} from '@/src/server/registration-v2/contest-store';
import type { ContestRegistrationDefinition } from '@/src/features/registration/types';

const def = (over: Partial<ContestRegistrationDefinition> = {}) =>
  ({
    slug: 'star-search',
    title: 'Star Search',
    contestCategory: 'music',
    contestType: 'online_contest',
    seasonOrEdition: '2026',
    regionScope: 'national',
    isPaid: false,
    legalAdultAge: 18,
    supportsVoting: true,
    ...over,
  }) as ContestRegistrationDefinition;

beforeEach(() => {
  calls.insert = null;
  calls.update = null;
  calls.select = null;
  calls.rows = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x');
});

describe('contest logo persistence', () => {
  it('writes logo_url (trimmed) alongside banner_image_url on create', async () => {
    await persistContestDefinition(def({ logoUrl: '  https://cdn.test/logo.png ', bannerImageUrl: 'https://cdn.test/b.jpg' }));
    expect(calls.insert).toMatchObject({ logo_url: 'https://cdn.test/logo.png', banner_image_url: 'https://cdn.test/b.jpg' });
  });

  it('writes an empty logo_url when none is set (so an edit can clear it)', async () => {
    await persistContestDefinition(def());
    expect(calls.insert).toMatchObject({ logo_url: '' });
  });

  it('writes logo_url on edit, including clearing it', async () => {
    await updateContestDefinition('star-search', def({ logoUrl: 'https://cdn.test/new.png' }));
    expect(calls.update).toMatchObject({ logo_url: 'https://cdn.test/new.png' });
    await updateContestDefinition('star-search', def({ logoUrl: '' }));
    expect(calls.update).toMatchObject({ logo_url: '' });
  });

  it('selects logo_url on the admin list and maps it onto a column-only row', async () => {
    calls.rows = [{ id: 'c-2', slug: 'a', name: 'A', status: 'active', logo_url: 'https://cdn.test/a.png', banner_image_url: '' }];
    const [row] = await listPersistedContests();
    expect(calls.select).toContain('logo_url');
    expect(row.logoUrl).toBe('https://cdn.test/a.png');
  });

  it('falls back to the column when a stored config snapshot predates the logo', async () => {
    calls.rows = [{
      id: 'c-3', slug: 'b', name: 'B', status: 'active', logo_url: 'https://cdn.test/b.png',
      contest_config: { slug: 'b', title: 'B' }, // an older snapshot with no logoUrl
    }];
    const [row] = await listPersistedContests();
    expect(row.logoUrl).toBe('https://cdn.test/b.png');
  });

  it('keeps a logo that is in the config snapshot', async () => {
    calls.rows = [{
      id: 'c-4', slug: 'c', name: 'C', status: 'active', logo_url: '',
      contest_config: { slug: 'c', title: 'C', logoUrl: 'https://cdn.test/cfg.png' },
    }];
    const [row] = await listPersistedContests();
    expect(row.logoUrl).toBe('https://cdn.test/cfg.png');
  });
});
