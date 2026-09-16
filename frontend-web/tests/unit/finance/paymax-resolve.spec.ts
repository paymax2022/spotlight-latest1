import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Wallet-to-wallet recipient resolution (frontend-web implementation).
//
// This is the resolver the mobile app actually reaches: EXPO_PUBLIC_API_BASE_URL
// points at frontend-web, and app/api/v1/transfers/paymax/resolve/route.ts calls
// resolvePaymaxUser() here rather than proxying to the Go service.
//
// Stored phones were never normalised — user_profiles holds "8159491618",
// "08159491618" and "+2348159491618" for different accounts. These tests pin:
//   1. every spelling of one number resolves to one account (including the BARE
//      NSN form, which the old variant list never generated),
//   2. two accounts on one number REFUSE rather than silently picking one, and
//   3. the caller's raw input is never interpolated into a PostgREST filter.
// ---------------------------------------------------------------------------

const capture: { filters: Array<Record<string, unknown>> } = { filters: [] };
let rows: Array<Record<string, unknown>> = [];
let queryError: unknown = null;

function makeQuery() {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.in = (col: string, vals: string[]) => { capture.filters.push({ type: 'in', col, vals }); return q; };
  q.eq = (col: string, val: string) => { capture.filters.push({ type: 'eq', col, val }); return q; };
  q.or = (expr: string) => { capture.filters.push({ type: 'or', expr }); return q; };
  q.limit = () => Promise.resolve({ data: rows, error: queryError });
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => makeQuery() }),
}));
vi.mock('@/src/server/wallet/service', () => ({ getOrCreateAccount: vi.fn() }));
vi.mock('@/src/server/tiers/service', () => ({ enforceWalletLimit: vi.fn() }));

import { resolvePaymaxUser, normalizeNsn } from '@/src/server/transfers/wallet-to-wallet';

const NSN = '8159491618';
const ME = 'requester-id';

beforeEach(() => {
  capture.filters = [];
  rows = [];
  queryError = null;
});

describe('normalizeNsn', () => {
  it('collapses every spelling of one number to the same NSN', () => {
    for (const input of [
      '8159491618', '08159491618', '+2348159491618', '2348159491618',
      '+234 815 949 1618', '0815-949-1618',
    ]) {
      expect(normalizeNsn(input), input).toBe(NSN);
    }
  });

  it('rejects anything that cannot be a Nigerian mobile', () => {
    for (const input of ['', 'abc', '12345', '815949161', '99998159491618', '+14155550100']) {
      expect(normalizeNsn(input), input).toBe('');
    }
  });
});

describe('resolvePaymaxUser', () => {
  it('resolves a recipient stored in the BARE NSN format', async () => {
    // The old buildPhoneVariants() never emitted the bare NSN, so a sender
    // typing "08159491618" could not find this row at all.
    rows = [{ id: 'u-1', full_name: 'Ada Obi', phone: NSN, avatar_url: null }];
    const got = await resolvePaymaxUser('08159491618', ME);
    expect(got.userId).toBe('u-1');

    const inFilter = capture.filters.find(f => f.type === 'in') as { vals: string[] } | undefined;
    expect(inFilter, 'phone lookup must use a bounded IN filter').toBeDefined();
    expect(inFilter!.vals).toContain(NSN);
    expect(inFilter!.vals).toContain(`0${NSN}`);
    expect(inFilter!.vals).toContain(`+234${NSN}`);
    expect(inFilter!.vals).toContain(`234${NSN}`);
  });

  it('resolves the same account whatever the sender types', async () => {
    rows = [{ id: 'u-1', full_name: 'Ada Obi', phone: `+234${NSN}`, avatar_url: null }];
    for (const typed of ['08159491618', '8159491618', '+2348159491618', '0815-949-1618']) {
      const got = await resolvePaymaxUser(typed, ME);
      expect(got.userId, typed).toBe('u-1');
    }
  });

  it('REFUSES when two accounts carry the same number', async () => {
    rows = [
      { id: 'u-1', full_name: 'Ada Obi', phone: `0${NSN}`, avatar_url: null },
      { id: 'u-2', full_name: 'Bola Eze', phone: `+234${NSN}`, avatar_url: null },
    ];
    // Silently picking one could pay a stranger, and a wallet credit is final.
    await expect(resolvePaymaxUser('08159491618', ME)).rejects.toMatchObject({ status: 409 });
  });

  it('discards rows the database matched but that do not normalise to the NSN', async () => {
    rows = [{ id: 'u-junk', full_name: 'Wrong Person', phone: '99998159491618', avatar_url: null }];
    await expect(resolvePaymaxUser('08159491618', ME)).rejects.toMatchObject({ status: 404 });
  });

  it('never interpolates raw caller input into a PostgREST filter', async () => {
    // `.or()` took a hand-built string containing the raw identifier, so a comma
    // let a caller append their own condition (e.g. "phone.not.is.null" matches
    // every profile) and resolve to an arbitrary account.
    rows = [];
    await expect(
      resolvePaymaxUser('1,phone.not.is.null', ME),
    ).rejects.toMatchObject({ status: 404 });

    for (const f of capture.filters) {
      expect(JSON.stringify(f)).not.toContain('phone.not.is.null');
    }
  });

  it('excludes the requesting user', async () => {
    rows = [{ id: ME, full_name: 'Me', phone: `0${NSN}`, avatar_url: null }];
    await expect(resolvePaymaxUser('08159491618', ME)).rejects.toMatchObject({ status: 404 });
  });

  it('still resolves by email', async () => {
    rows = [{ id: 'u-9', full_name: 'Ada Obi', phone: `0${NSN}`, avatar_url: null }];
    const got = await resolvePaymaxUser('ada@example.com', ME);
    expect(got.userId).toBe('u-9');
    const eqFilter = capture.filters.find(f => f.type === 'eq' && f.col === 'email');
    expect(eqFilter).toBeDefined();
  });
});
