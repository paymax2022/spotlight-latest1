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

const capture: {
  filters: Array<Record<string, unknown>>;
  tables: string[];
} = { filters: [], tables: [] };
let rows: Array<Record<string, unknown>> = [];
let queryError: unknown = null;
// Per-table row sets. Recipient resolution by cashtag reads the cashtag
// directory and THEN the profile, so a test has to be able to seed the two
// tables differently. A table with no entry falls back to `rows`, which is what
// every phone/email case below already sets.
let rowsByTable: Record<string, Array<Record<string, unknown>>> = {};

function makeQuery(table: string) {
  capture.tables.push(table);
  const settle = () => Promise.resolve({ data: rowsByTable[table] ?? rows, error: queryError });
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.in = (col: string, vals: string[]) => { capture.filters.push({ type: 'in', col, vals }); return q; };
  q.eq = (col: string, val: string) => { capture.filters.push({ type: 'eq', col, val }); return q; };
  q.ilike = (col: string, pattern: string) => { capture.filters.push({ type: 'ilike', col, pattern }); return q; };
  q.or = (expr: string) => { capture.filters.push({ type: 'or', expr }); return q; };
  q.limit = () => settle();
  // Directory lookups are single-row by constraint (uq_cashtag_handle), so they
  // resolve through maybeSingle rather than a bounded list.
  q.maybeSingle = () => settle().then(({ data, error }) => ({ data: data[0] ?? null, error }));
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
  createAdminClient: () => ({ from: (table: string) => makeQuery(table) }),
}));
vi.mock('@/src/server/wallet/service', () => ({ getOrCreateAccount: vi.fn() }));
vi.mock('@/src/server/tiers/service', () => ({ enforceWalletLimit: vi.fn() }));

import { resolvePaymaxUser, normalizeNsn, nsnDigitPattern, parseCashtagIdentifier } from '@/src/server/transfers/wallet-to-wallet';

const NSN = '8159491618';
const ME = 'requester-id';

beforeEach(() => {
  capture.filters = [];
  capture.tables = [];
  rows = [];
  rowsByTable = {};
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

// Cashtag addressing (contracts/openapi.yaml: the recipient identifier is
// "phone, email, or Paymax username"). A `@`/`$`-sigil'd handle is looked up in
// cashtag_handles, which the schema makes unique per handle — so unlike the
// phone leg there is no ambiguity to refuse, and unlike the phone leg the match
// must stay EXACT: the loose digit LIKE pattern that is correct for a phone
// would be a guess for a name.
describe('resolvePaymaxUser by cashtag', () => {
  const OWNER = { id: 'u-7', full_name: 'Bisi Adeyemi', phone: '08012345678', avatar_url: null };

  it('resolves @handle through the directory, then the profile', async () => {
    rowsByTable.cashtag_handles = [{ user_id: 'u-7' }];
    rowsByTable.user_profiles = [OWNER];

    const got = await resolvePaymaxUser('@bisi_2', ME);

    expect(got.userId).toBe('u-7');
    expect(got.displayName).toBe('Bisi Adeyemi');
    expect(got.maskedPhone).toBe('0801****678');
    // The handle comes back so the confirmation screen can echo what the sender
    // typed instead of a number they never used.
    expect(got.handle).toBe('@bisi_2');
    expect(capture.tables).toEqual(['cashtag_handles', 'user_profiles']);
  });

  it('accepts the $ sigil and any case, queried as the normalised handle', async () => {
    rowsByTable.cashtag_handles = [{ user_id: 'u-7' }];
    rowsByTable.user_profiles = [OWNER];

    await resolvePaymaxUser('  $BISI_2 ', ME);

    // The directory is consulted FIRST — that is what distinguishes a cashtag
    // send from the email reading an unsigil'd input used to fall into.
    expect(capture.tables).toEqual(['cashtag_handles', 'user_profiles']);
    const handleFilter = capture.filters.find(f => f.type === 'eq' && f.col === 'handle');
    expect(handleFilter).toMatchObject({ val: 'bisi_2' });
  });

  it('404s an unclaimed handle without probing profiles', async () => {
    rowsByTable.cashtag_handles = [];
    rowsByTable.user_profiles = [OWNER];

    await expect(resolvePaymaxUser('@nobody_here', ME)).rejects.toMatchObject({ status: 404 });
    expect(capture.tables).toEqual(['cashtag_handles']);
  });

  it('answers a directory outage as an outage, not as an unclaimed handle', async () => {
    // The Go rail pins the same split (TestCashtagLookupFailureKeepsOutageApartFromUnclaimed).
    // A 404 here would tell the sender their `@handle` does not exist when the
    // truth is that we could not read the directory — and on a money path that
    // difference decides whether they retry, give up, or send to someone else.
    queryError = { message: 'connection reset by peer' };

    await expect(resolvePaymaxUser('@bisi_2', ME)).rejects.toMatchObject({ status: 500 });
    expect(capture.tables).toEqual(['cashtag_handles']);
  });

  it('never builds the phone LIKE pattern for a handle-shaped input', async () => {
    // '%8%1%5…' is a superset filter on purpose for numbers. For a name it would
    // be a guess, and a guess on this path pays a stranger irreversibly.
    rowsByTable.cashtag_handles = [{ user_id: 'u-7' }];
    rowsByTable.user_profiles = [OWNER];

    await resolvePaymaxUser('@bisi_2', ME);

    expect(capture.filters.some(f => f.type === 'ilike')).toBe(false);
    expect(capture.filters.some(f => f.type === 'or')).toBe(false);
  });

  it('treats a malformed handle as what it is, not as a loose lookup', async () => {
    // '@bi%si' is not handle grammar, so it is not read as a cashtag at all; and
    // because it carries an '@' it is read as an email, which is a bound
    // parameter — never the digit-superset filter.
    rowsByTable.user_profiles = [];

    await expect(resolvePaymaxUser('@bi%si', ME)).rejects.toMatchObject({ status: 404 });
    // Read as an email, so the profile table is what gets queried — the
    // directory is never touched by something that is not handle grammar.
    expect(capture.tables).toEqual(['user_profiles']);
    expect(capture.filters.some(f => f.type === 'ilike')).toBe(false);
    expect(capture.filters.some(f => f.type === 'eq' && f.col === 'handle')).toBe(false);
  });

  it('excludes the requesting user', async () => {
    rowsByTable.cashtag_handles = [{ user_id: ME }];
    rowsByTable.user_profiles = [{ ...OWNER, id: ME }];

    await expect(resolvePaymaxUser('@my_own_handle', ME)).rejects.toMatchObject({ status: 404 });
    // Refused on the directory hit itself — no profile is read for a send to
    // yourself, same as the phone leg drops the requester before anything else.
    expect(capture.tables).toEqual(['cashtag_handles']);
  });

  it('resolves an owner whose profile carries no phone', async () => {
    // user_profiles.phone is nullable — proof: the phone leg filters
    // `phone IS NOT NULL` and its NSN index is partial on that predicate. The Go
    // rail scans the column into a plain string, so without COALESCE a NULL made
    // a claimed handle answer 404 there while this rail paid it: same $handle,
    // two answers, on a money path. See
    // backend/internal/finance/transfers/cashtag_livedb_test.go.
    rowsByTable.cashtag_handles = [{ user_id: 'u-7' }];
    rowsByTable.user_profiles = [{ ...OWNER, phone: null }];

    const got = await resolvePaymaxUser('@bisi_2', ME);

    expect(got.userId).toBe('u-7');
    // The handle is what the sender typed, so an empty masked phone still leaves
    // a named, unambiguous confirmation line.
    expect(got.handle).toBe('@bisi_2');
    expect(got.maskedPhone).toBe('');
    expect(capture.tables).toEqual(['cashtag_handles', 'user_profiles']);
  });

  it('leaves phone and email addressing untouched', async () => {
    rows = [{ id: 'u-1', full_name: 'Ada Obi', phone: `0${NSN}`, avatar_url: null }];

    const got = await resolvePaymaxUser('08159491618', ME);

    expect(got.userId).toBe('u-1');
    expect(got.handle).toBeUndefined();
    expect(capture.tables).toEqual(['user_profiles']);
  });
});

// The two rails must agree about WHAT A CASHTAG IS, not merely about how to
// look one up. The mobile app reaches the BFF and the web app reaches Go, so a
// handle the BFF reads and Go does not (or the reverse) means the same `$ada_9`
// is payable from one client and 404 from the other. This table is the same one
// backend/internal/finance/transfers/cashtag_recipient_test.go asserts against
// ParseCashtagRecipient/IsValidShape; keep the two in step when either changes.
describe('parseCashtagIdentifier shape parity with the Go rail', () => {
  it('accepts a sigil plus handle grammar, normalised to lower case', () => {
    expect(parseCashtagIdentifier('@bisi')).toBe('bisi');
    expect(parseCashtagIdentifier('$bisi')).toBe('bisi');
    expect(parseCashtagIdentifier('@BISI')).toBe('bisi');
    expect(parseCashtagIdentifier('  @bisi_2  ')).toBe('bisi_2');
    expect(parseCashtagIdentifier('@1234567')).toBe('1234567');
    // Length bounds come from the claim-time grammar, 3..30 characters.
    expect(parseCashtagIdentifier('@' + 'a'.repeat(30))).toBe('a'.repeat(30));
  });

  it('refuses what the directory could never hold', () => {
    for (const input of [
      '@' + 'a'.repeat(31),   // too long to have been claimable
      '@bi',                  // too short
      '@_bisi',               // cannot start with the separator
      '@bi!si',               // punctuation is not handle grammar
      '@ada.eze',             // dots belong to emails, not handles
      '@bi%si',               // a LIKE metacharacter is not a handle
    ]) {
      expect(parseCashtagIdentifier(input), input).toBeNull();
    }
  });

  it('never reads an un-sigil’d identifier as a handle', () => {
    // The iron rule of this rail: refuse, do not guess. A bare `bisi` is what a
    // sender types when they mean a name they know, and paying the account that
    // happens to hold a 4-character handle is not a fallback anyone asked for.
    expect(parseCashtagIdentifier('bisi')).toBeNull();
    // A phone must not be swallowed as a handle either — the shape alone would
    // happily accept digits, so the sigil is the only thing that keeps the
    // number on the digit-superset leg.
    expect(parseCashtagIdentifier('8159491618')).toBeNull();
    // An email carries the same sigil a cashtag uses, and the email has to win.
    expect(parseCashtagIdentifier('ada@eze.com')).toBeNull();
    expect(parseCashtagIdentifier('')).toBeNull();
    expect(parseCashtagIdentifier('@')).toBeNull();
  });
});
