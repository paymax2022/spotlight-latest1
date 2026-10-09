import { describe, it, expect, vi, beforeEach } from 'vitest';

// Wallet-to-wallet recipient resolution (frontend-web implementation).
// This is the resolver the mobile app actually reaches: EXPO_PUBLIC_API_BASE_URL
// points at frontend-web, and app/api/v1/transfers/paymax/resolve/route.ts calls
// resolvePaymaxUser() here rather than proxying to the Go service.
// Stored phones were never normalised — user_profiles holds "8159491618",
// "08159491618", "+2348159491618" and formatted spellings like
// "+234 906 884 9124" for different accounts. These tests pin:
//   1. every spelling of one number resolves to one account (including the BARE
//      NSN form, which the old variant list never generated),
//   2. two accounts on one number REFUSE rather than silently picking one —
//      even when the second row is stored in a format a fixed spelling list
//      cannot enumerate (the prod defect: the BFF saw one row where Go saw two,
//      and silently returned account c2e56738 instead of refusing with 409),
//   3. the caller's raw input is never interpolated into a PostgREST filter.

const capture: { filters: Array<Record<string, unknown>> } = { filters: [] };
let rows: Array<Record<string, unknown>> = [];
let queryError: unknown = null;

function makeQuery() {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.in = (col: string, vals: string[]) => { capture.filters.push({ type: 'in', col, vals }); return q; };
  q.eq = (col: string, val: string) => { capture.filters.push({ type: 'eq', col, val }); return q; };
  q.ilike = (col: string, pattern: string) => { capture.filters.push({ type: 'ilike', col, pattern }); return q; };
  q.or = (expr: string) => { capture.filters.push({ type: 'or', expr }); return q; };
  q.limit = () => Promise.resolve({ data: rows, error: queryError });
  return q;
}

/**
 * Simulate SQL LIKE semantics for the emitted ilike pattern, so tests can prove
 * the DB-side filter would return a row stored in ANY spelling — not just that
 * the code-level re-check would accept it. `%` → any run, `_` → one char.
 */
function likeMatches(pattern: string, value: string): boolean {
  const regex = '^' + pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex specials (not % or _)
    .replace(/%/g, '.*')
    .replace(/_/g, '.') + '$';
  return new RegExp(regex, 'i').test(value);
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => makeQuery() }),
}));
vi.mock('@/src/server/wallet/service', () => ({ getOrCreateAccount: vi.fn() }));
vi.mock('@/src/server/tiers/service', () => ({ enforceWalletLimit: vi.fn() }));

import { resolvePaymaxUser, normalizeNsn, nsnDigitPattern } from '@/src/server/transfers/wallet-to-wallet';

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

describe('nsnDigitPattern', () => {
  it('builds an ilike pattern that matches every stored spelling of the NSN', () => {
    const pattern = nsnDigitPattern(NSN);
    expect(pattern).toBe(`%${NSN.split('').join('%')}%`);

    // Canonical spellings …
    for (const stored of [
      NSN, `0${NSN}`, `+234${NSN}`, `234${NSN}`,
      // … and formatted spellings a fixed IN list can never enumerate — the
      // shapes that made the second prod account invisible to the BFF.
      `+234 ${NSN.slice(0, 3)} ${NSN.slice(3, 6)} ${NSN.slice(6)}`,
      `0${NSN.slice(0, 3)}-${NSN.slice(3, 6)}-${NSN.slice(6)}`,
      `(234)${NSN.slice(0, 3)}-${NSN.slice(3, 6)}-${NSN.slice(6)}`,
      `+234 906 884 9124`.replace(/906 884 9124/, `${NSN.slice(0, 3)} ${NSN.slice(3, 6)} ${NSN.slice(6)}`),
    ]) {
      expect(likeMatches(pattern, stored), stored).toBe(true);
    }
  });

  it('does not LIKE-match a different number', () => {
    const pattern = nsnDigitPattern(NSN);
    expect(likeMatches(pattern, '+2348068849124')).toBe(false);
    expect(likeMatches(pattern, '+14155550100')).toBe(false);
  });
});

describe('resolvePaymaxUser', () => {
  it('resolves a recipient stored in the BARE NSN format', async () => {
    // The old buildPhoneVariants() never emitted the bare NSN, so a sender
    // typing "08159491618" could not find this row at all.
    rows = [{ id: 'u-1', full_name: 'Ada Obi', phone: NSN, avatar_url: null }];
    const got = await resolvePaymaxUser('08159491618', ME);
    expect(got.userId).toBe('u-1');
  });

  it('queries with a digit-interleaved ilike superset, never a spelling list', async () => {
    // Regression guard for the prod defect: an IN list of stored spellings let
    // a second account in an unlisted format hide, so the BFF resolved to one
    // account where Go refused the number as ambiguous (409).
    rows = [{ id: 'u-1', full_name: 'Ada Obi', phone: NSN, avatar_url: null }];
    await resolvePaymaxUser('08159491618', ME);

    const ilikeFilter = capture.filters.find(f => f.type === 'ilike' && f.col === 'phone') as
      { pattern: string } | undefined;
    expect(ilikeFilter, 'phone lookup must use an ilike superset filter').toBeDefined();
    expect(ilikeFilter!.pattern).toBe(nsnDigitPattern(NSN));
    // The pattern is built from digits we generated — never the caller's text.
    expect(ilikeFilter!.pattern).not.toContain('08159491618');

    expect(
      capture.filters.find(f => f.type === 'in' && f.col === 'phone'),
      'enumerating stored spellings is exactly the blind spot that hid account #2',
    ).toBeUndefined();
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

  it('REFUSES when the duplicate is stored in a formatted spelling', async () => {
    // The prod defect verbatim: the second row for +2349068849124 was stored in
    // a spelling outside the old IN list, so the BFF counted one account where
    // Go counted two — and returned c2e56738 instead of refusing.
    const prodNsn = '9068849124';
    expect(normalizeNsn('+234 906 884 9124')).toBe(prodNsn);
    rows = [
      { id: 'u-canon', full_name: 'Ada Obi', phone: `+234${prodNsn}`, avatar_url: null },
      { id: 'u-twin', full_name: 'Bola Eze', phone: '+234 906 884 9124', avatar_url: null },
    ];
    await expect(resolvePaymaxUser(`+234${prodNsn}`, ME)).rejects.toMatchObject({ status: 409 });
  });

  it('RESOLVES a single-match recipient and 404s on zero matches', async () => {
    // Single match → the recipient.
    rows = [{ id: 'u-1', full_name: 'Ada Obi', phone: `0${NSN}`, avatar_url: null }];
    const got = await resolvePaymaxUser('08159491618', ME);
    expect(got.userId).toBe('u-1');
    expect(got.maskedPhone).not.toBe(`0${NSN}`); // never echoes the full number

    // Zero matches → 404.
    rows = [];
    await expect(resolvePaymaxUser('08159491618', ME)).rejects.toMatchObject({ status: 404 });
  });

  it('discards rows the database matched but that do not normalise to the NSN', async () => {
    rows = [{ id: 'u-junk', full_name: 'Wrong Person', phone: '99998159491618', avatar_url: null }];
    await expect(resolvePaymaxUser('08159491618', ME)).rejects.toMatchObject({ status: 404 });
  });

  it('never interpolates raw caller input into a PostgREST filter', async () => {
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
