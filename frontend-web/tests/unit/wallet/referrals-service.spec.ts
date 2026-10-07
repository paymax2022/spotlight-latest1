/**
 * Referral reward service tests — Supabase mocked, no DB, no HTTP. (REF-005)
 *
 * Covers the two functions in `frontend-web/src/server/referrals/` that move
 * real money / permanent attribution and had zero unit coverage before this:
 *
 *   - service.ts: processReferralReward (credits the referrer ₦500 via
 *     creditWallet, idempotency-keyed on `referral-reward:<referrer>:<referred>`)
 *   - attribution.ts: attributeSignup (resolves a signup's referral code to a
 *     referrer, or falls back to the house account; self-referral is NOT
 *     rejected outright — it is redirected to the house account with a
 *     `risk_flag`, per the code read below)
 *
 * creditWallet itself is unit-tested in tests/unit/wallet/service.spec.ts, so
 * here it is mocked directly — these tests assert *what* referrals/service.ts
 * calls it with (amount, idempotency key shape, counter account), not how
 * creditWallet posts its journal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(),
}));

import {
  resolveCodeToReferrer,
  processReferralReward,
  generateCode,
  getOrCreateCode,
} from '@/src/server/referrals/service';
import { attributeSignup } from '@/src/server/referrals/attribution';
import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet } from '@/src/server/wallet/service';

const REFERRER_ID = 'referrer-user-001';
const REFERRED_ID = 'referred-user-002';
const SHARE_CODE = 'SPOT-ABC123';

function setupMock() {
  const { mock, maybySingle, insertFn } = makeSupabaseMock();
  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return { mock, maybySingle, insertFn };
}

// processReferralReward

describe('processReferralReward', () => {
  beforeEach(() => vi.clearAllMocks());

  it('credits the referrer ₦500 (50,000 kobo) with the documented idempotency key shape', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // referral_links miss (links-first probe)
      .mockResolvedValueOnce({ data: { user_id: REFERRER_ID }, error: null }); // finance_referral_codes hit
    vi.mocked(creditWallet).mockResolvedValueOnce({ alreadyProcessed: false, amountKobo: 50_000 });
    insertFn.mockResolvedValueOnce({ error: null }); // referral_events insert

    const result = await processReferralReward({ shareCode: SHARE_CODE, referredUserId: REFERRED_ID });

    expect(result).toEqual({
      rewarded: true,
      alreadyRewarded: false,
      skipped: false,
      amountKobo: 50_000,
    });

    expect(creditWallet).toHaveBeenCalledOnce();
    const [creditedUserId, input] = vi.mocked(creditWallet).mock.calls[0];
    expect(creditedUserId).toBe(REFERRER_ID);
    expect(input.amountKobo).toBe(50_000);
    // Idempotency key is keyed on (referrer, referred) only — not on the vote
    // event or share code — so a "first vote" reward is truly at-most-once
    // per pair regardless of how many times the code is replayed.
    expect(input.idempotencyKey).toBe(`referral-reward:${REFERRER_ID}:${REFERRED_ID}`);
    // ADR-040: platform-funded bonus, not provider money.
    expect(input.counterAccount).toBe('referral_reward_expense');

    // The at-most-once event row is recorded after a successful (non-duplicate) credit.
    expect(insertFn).toHaveBeenCalledOnce();
    expect(insertFn.mock.calls[0][0]).toMatchObject({
      referrer_id: REFERRER_ID,
      referred_id: REFERRED_ID,
      idempotency_key: `referral-reward:${REFERRER_ID}:${REFERRED_ID}`,
      amount_kobo: 50_000,
    });
  });

  it('calling twice for the same referrer/referred pair credits exactly once (idempotent)', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // 1st links probe
      .mockResolvedValueOnce({ data: { user_id: REFERRER_ID }, error: null }) // 1st legacy resolve
      .mockResolvedValueOnce({ data: null, error: null }) // 2nd links probe
      .mockResolvedValueOnce({ data: { user_id: REFERRER_ID }, error: null }); // 2nd legacy resolve
    vi.mocked(creditWallet)
      .mockResolvedValueOnce({ alreadyProcessed: false, amountKobo: 50_000 }) // 1st call: fresh credit
      .mockResolvedValueOnce({ alreadyProcessed: true, amountKobo: 50_000 }); // 2nd call: dedup hit
    insertFn.mockResolvedValueOnce({ error: null });

    const first = await processReferralReward({ shareCode: SHARE_CODE, referredUserId: REFERRED_ID });
    const second = await processReferralReward({ shareCode: SHARE_CODE, referredUserId: REFERRED_ID });

    expect(first.rewarded).toBe(true);
    expect(first.alreadyRewarded).toBe(false);

    expect(second.rewarded).toBe(false);
    expect(second.alreadyRewarded).toBe(true);
    expect(second.amountKobo).toBe(50_000);

    // Both calls hit creditWallet with the SAME idempotency key — that key is
    // what makes the second call a no-op inside creditWallet itself.
    expect(creditWallet).toHaveBeenCalledTimes(2);
    const key1 = vi.mocked(creditWallet).mock.calls[0][1].idempotencyKey;
    const key2 = vi.mocked(creditWallet).mock.calls[1][1].idempotencyKey;
    expect(key1).toBe(key2);

    // The referral_events row is only inserted on the fresh-credit path.
    expect(insertFn).toHaveBeenCalledOnce();
  });

  it('skips with reason=code_not_found when the share code does not resolve', async () => {
    const { maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // links probe miss
      .mockResolvedValueOnce({ data: null, error: null }); // legacy lookup miss

    const result = await processReferralReward({ shareCode: 'SPOT-NOPE00', referredUserId: REFERRED_ID });

    expect(result).toEqual({ rewarded: false, alreadyRewarded: false, skipped: true, reason: 'code_not_found' });
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('skips with reason=self_referral and never calls creditWallet when the code resolves to the referred user', async () => {
    const { maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // links probe miss
      .mockResolvedValueOnce({ data: { user_id: REFERRED_ID }, error: null }); // legacy resolves to self

    const result = await processReferralReward({ shareCode: SHARE_CODE, referredUserId: REFERRED_ID });

    expect(result).toEqual({ rewarded: false, alreadyRewarded: false, skipped: true, reason: 'self_referral' });
    expect(creditWallet).not.toHaveBeenCalled();
  });
});

// resolveCodeToReferrer

describe('resolveCodeToReferrer', () => {
  beforeEach(() => vi.clearAllMocks());

  // in before the two generators writing into finance_referral_codes were
  // unified onto one uppercase-only format (REF-004). Only whitespace is
  // trimmed client-side; case folding happens in Postgres via ILIKE.
  it('trims whitespace and looks up case-insensitively via ilike on the legacy fallback', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // referral_links probe miss
      .mockResolvedValueOnce({ data: { user_id: REFERRER_ID }, error: null }); // legacy hit

    const result = await resolveCodeToReferrer('  spot-abc123  ');

    expect(result).toBe(REFERRER_ID);
    // REF-002: referral_links is probed first with an EXACT-case eq —
    // the engine's generators only mint uppercase codes.
    expect(mock.eq).toHaveBeenCalledWith('code', 'spot-abc123');
    // REF-008: the legacy fallback stays case-insensitive via ILIKE.
    expect(mock.ilike).toHaveBeenCalledWith('code', 'spot-abc123');
  });

  // The rewards-engine code lives in referral_links, NOT finance_referral_codes —
  // a code shared from the Go dashboard surface must resolve here too
  // (was code_not_found → outbox reward skipped before this probe existed).
  it('resolves a referral_links code via the links-first probe (exact case)', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: { referrer_id: REFERRER_ID }, error: null });

    const result = await resolveCodeToReferrer('HCUPF');

    expect(result).toBe(REFERRER_ID);
    expect(mock.eq).toHaveBeenCalledWith('code', 'HCUPF');
    // The legacy table is never consulted when the link resolves.
    expect(mock.ilike).not.toHaveBeenCalled();
  });

  // A code generated in a DIFFERENT case than what the user types must still
  // resolve — this is the exact REF-008 scenario (a legacy lowercase-hex code
  // typed back in uppercase, or vice versa).
  it('resolves a code regardless of case mismatch between stored and typed casing', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // links probe miss
      .mockResolvedValueOnce({ data: { user_id: REFERRER_ID }, error: null });

    const result = await resolveCodeToReferrer('AbCd3');

    expect(result).toBe(REFERRER_ID);
    expect(mock.ilike).toHaveBeenCalledWith('code', 'AbCd3');
  });

  // one must be escaped so the lookup stays an exact match, not a pattern scan
  // that could hit unrelated rows.
  it('escapes ILIKE wildcard characters so lookup behaves as an exact match', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await resolveCodeToReferrer('AB_CD%EF\\GH');

    expect(mock.ilike).toHaveBeenCalledWith('code', 'AB\\_CD\\%EF\\\\GH');
  });

  it('returns null when no code matches in either table', async () => {
    const { maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await resolveCodeToReferrer('SPOT-ZZZZZZ');
    expect(result).toBeNull();
  });

  it('returns null for an empty code without touching the database', async () => {
    const { maybySingle } = setupMock();

    const result = await resolveCodeToReferrer('   ');
    expect(result).toBeNull();
    expect(maybySingle).not.toHaveBeenCalled();
  });
});

// generateCode (REF-004)
// Must produce the EXACT same shape as backend/internal/finance/referrals/
// code.go's GenerateCode(): 5 characters, uppercase, drawn only from
// 'ABCDEFGHJKMNPQRTUVWXY346789' (A-Z + digits, minus every confusable
// generator's half of the REF-004 format mismatch.

describe('generateCode', () => {
  const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

  it('produces a 5-character code drawn only from the shared alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(5);
      for (const ch of code) {
        expect(ALPHABET).toContain(ch);
      }
    }
  });

  it('never emits the old SPOT- prefix or a confusable character', () => {
    const disallowed = 'OIL SZ012-'; // confusables + space + the old prefix separator
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code.startsWith('SPOT')).toBe(false);
      for (const ch of disallowed) {
        expect(code).not.toContain(ch);
      }
    }
  });

  it('is uppercase-only', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toBe(code.toUpperCase());
    }
  });
});

// attributeSignup

describe('attributeSignup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attributes to the resolved referrer on a valid, non-self code', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing attribution
      .mockResolvedValueOnce({ data: { grace_window_hours: 72 }, error: null }) // referral_config
      .mockResolvedValueOnce({ data: null, error: null }) // referral_links probe miss
      .mockResolvedValueOnce({ data: { user_id: REFERRER_ID }, error: null }); // finance_referral_codes (via resolveCodeToReferrer)
    insertFn.mockResolvedValueOnce({ error: null }); // referral_attributions insert

    const result = await attributeSignup(REFERRED_ID, { referralCode: SHARE_CODE });

    expect(result).toEqual({ attributed: true, isHouse: false, attributionType: 'code' });
    expect(insertFn).toHaveBeenCalledOnce();
    expect(insertFn.mock.calls[0][0]).toMatchObject({
      referred_user_id: REFERRED_ID,
      referrer_id: REFERRER_ID,
      attribution_type: 'code',
      code_used: SHARE_CODE,
      is_house: false,
      status: 'grace',
    });
  });

  it('is idempotent: an already-attributed user short-circuits without writing again', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle.mockResolvedValueOnce({
      data: { id: 'attr-1', is_house: false, attribution_type: 'code', risk_flag: null },
      error: null,
    });

    const result = await attributeSignup(REFERRED_ID, { referralCode: SHARE_CODE });

    expect(result).toEqual({ attributed: true, isHouse: false, attributionType: 'code', riskFlag: undefined });
    expect(insertFn).not.toHaveBeenCalled();
  });

  // The code has a self-referral CHECK, and attribution.ts detects
  // the same global-house-account path used for a missing/invalid code.
  it('redirects a self-referral code to the house account with risk_flag=self_referral (not a hard rejection)', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing attribution
      .mockResolvedValueOnce({ data: { grace_window_hours: 72 }, error: null }) // referral_config
      .mockResolvedValueOnce({ data: null, error: null }) // referral_links probe miss
      .mockResolvedValueOnce({ data: { user_id: REFERRED_ID }, error: null }) // code resolves to self
      .mockResolvedValueOnce({ data: { id: 'house-acct-1' }, error: null }); // referral_house_accounts
    insertFn.mockResolvedValueOnce({ error: null }); // referral_attributions insert (house path)

    const result = await attributeSignup(REFERRED_ID, { referralCode: SHARE_CODE });

    expect(result).toEqual({
      attributed: true,
      isHouse: true,
      attributionType: 'global_house',
      riskFlag: 'self_referral',
    });
    expect(insertFn).toHaveBeenCalledOnce();
    expect(insertFn.mock.calls[0][0]).toMatchObject({
      referred_user_id: REFERRED_ID,
      house_account_id: 'house-acct-1',
      attribution_type: 'global_house',
      is_house: true,
      risk_flag: 'self_referral',
    });
  });

  it('falls back to the house account with risk_flag=invalid_code when the code does not resolve', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing attribution
      .mockResolvedValueOnce({ data: { grace_window_hours: 72 }, error: null }) // referral_config
      .mockResolvedValueOnce({ data: null, error: null }) // referral_links probe miss
      .mockResolvedValueOnce({ data: null, error: null }) // legacy code lookup miss
      .mockResolvedValueOnce({ data: { id: 'house-acct-1' }, error: null }); // referral_house_accounts
    insertFn.mockResolvedValueOnce({ error: null });

    const result = await attributeSignup(REFERRED_ID, { referralCode: 'SPOT-NOPE00' });

    expect(result).toEqual({
      attributed: true,
      isHouse: true,
      attributionType: 'global_house',
      riskFlag: 'invalid_code',
    });
  });

  it('attributes straight to the house account when no code is supplied at all', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing attribution
      .mockResolvedValueOnce({ data: { grace_window_hours: 72 }, error: null }) // referral_config
      .mockResolvedValueOnce({ data: { id: 'house-acct-1' }, error: null }); // referral_house_accounts
    insertFn.mockResolvedValueOnce({ error: null });

    const result = await attributeSignup(REFERRED_ID, {});

    expect(result).toEqual({ attributed: true, isHouse: true, attributionType: 'global_house', riskFlag: undefined });
    // No code at all means resolveCodeToReferrer is never called, so exactly
    // 3 maybeSingle calls precede this assertion (existing/config/house) — no
    // 4th call for a code lookup.
    expect(maybySingle).toHaveBeenCalledTimes(3);
  });
});

// getOrCreateCode — two-table convergence (E2E-FIN-044 counterpart).
// Go's GetOrCreateLink adopts an OLDER finance_referral_codes row into
// referral_links; the TS side mirrors it: when the referral_links row is the
// older (or only) one, ITS code is canonical and finance_referral_codes is
// converged/backfilled onto it. Query order inside getOrCreateCode is
// legacy-first then links (both built left-to-right in Promise.all).

const OLDER = '2026-01-01T00:00:00.000000+00:00';
const NEWER = '2026-06-01T00:00:00.000000+00:00';

describe('getOrCreateCode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the legacy code when only finance_referral_codes has a row', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: { code: 'LEGACY1', created_at: OLDER }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }); // no referral_links row

    const code = await getOrCreateCode(REFERRED_ID);

    expect(code).toBe('LEGACY1');
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.upsert).not.toHaveBeenCalled();
  });

  it('adopts the referral_links code when no legacy row exists, and backfills it', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // no legacy row
      .mockResolvedValueOnce({ data: { code: 'LINKCD', created_at: OLDER }, error: null });

    const code = await getOrCreateCode(REFERRED_ID);

    expect(code).toBe('LINKCD');
    // Backfill keeps finance_referral_codes-only readers (resolveCodeToReferrer
    // fallback, legacy reports) resolving the engine-minted code.
    expect(mock.upsert).toHaveBeenCalledWith(
      { user_id: REFERRED_ID, code: 'LINKCD' },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
  });

  it('adopts the referral_links code when it is the OLDER row, converging the legacy row onto it', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: { code: 'NEWLEG', created_at: NEWER }, error: null })
      .mockResolvedValueOnce({ data: { code: 'OLDLNK', created_at: OLDER }, error: null });

    const code = await getOrCreateCode(REFERRED_ID);

    expect(code).toBe('OLDLNK');
    expect(mock.update).toHaveBeenCalledWith({ code: 'OLDLNK' });
  });

  it('keeps the legacy code when the legacy row is OLDER (Go adopts it into referral_links on its side)', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: { code: 'OLDLEG', created_at: OLDER }, error: null })
      .mockResolvedValueOnce({ data: { code: 'NEWLNK', created_at: NEWER }, error: null });

    const code = await getOrCreateCode(REFERRED_ID);

    expect(code).toBe('OLDLEG');
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.upsert).not.toHaveBeenCalled();
  });

  it('mints a fresh code into finance_referral_codes when neither table has a row', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    insertFn.mockResolvedValueOnce({ error: null });

    const code = await getOrCreateCode(REFERRED_ID);

    expect(code).toMatch(/^[ABCDEFGHJKMNPQRTUVWXY346789]{5}$/);
    expect(insertFn).toHaveBeenCalledWith({ user_id: REFERRED_ID, code });
  });
});
