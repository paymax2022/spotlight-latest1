/**
 * Checkout top-up KYC gate — ADR-042.
 *
 * The card rail funds the wallet for the purchase in flight (ADR-041), so it
 * inherited the standalone top-up's Tier 1 requirement and locked unverified
 * accounts out of paying by card. This gate relaxes that for checkout top-ups
 * ONLY, under a capped rolling allowance, and only behind a feature flag.
 *
 * What these tests protect, in order of how much money is at stake:
 *   1. Standalone funding never gets the weaker gate (including via a spoofed or
 *      unrecognised `purpose`).
 *   2. With the flag off, behaviour is byte-identical to before.
 *   3. The Tier-0 allowance actually caps — per transaction and per rolling window
 *      — and counts pending intents, so concurrent checkouts cannot each see a
 *      fresh allowance.
 *   4. Every failure path denies rather than allows.
 *
 * All Supabase and KYC calls are mocked — no database required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/kyc/service', () => ({ getKycTier: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';
import { getKycTier } from '@/src/server/kyc/service';
import {
  assertTopupAllowed,
  CHECKOUT_TOPUP_ALLOWANCE_KOBO,
  CHECKOUT_TOPUP_MAX_SINGLE_KOBO,
} from '@/src/server/wallet/topup-gate';

const mockAdmin = createAdminClient as ReturnType<typeof vi.fn>;
const mockGetKycTier = getKycTier as ReturnType<typeof vi.fn>;

const TIER0_ALLOWANCE = CHECKOUT_TOPUP_ALLOWANCE_KOBO[0] as number;

/** Supabase double: `wallet_topup_intents` reads + `tier_limit_events` inserts. */
function makeSupabase(intents: { data: { amount_kobo: number }[] | null; error: unknown }) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'tier_limit_events') {
        return { insert: vi.fn().mockImplementation((row) => { inserts.push(row); return Promise.resolve({ error: null }); }) };
      }
      // wallet_topup_intents — the chain ends on .gte()
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.gte = vi.fn().mockResolvedValue(intents);
      return chain;
    }),
  };
  return { client, inserts };
}

function used(...amounts: number[]) {
  return { data: amounts.map((a) => ({ amount_kobo: a })), error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_CHECKOUT_TOPUP_TIER0 = 'true';
});
afterEach(() => { delete process.env.FEATURE_CHECKOUT_TOPUP_TIER0; });

describe('standalone funding keeps the Tier 1 gate', () => {
  it('denies Tier 0 for purpose=wallet even with the flag on', async () => {
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    await expect(assertTopupAllowed('u1', 100_000, 'wallet')).rejects.toThrow(/Tier 1/i);
  });

  it('allows Tier 1 for purpose=wallet', async () => {
    mockGetKycTier.mockResolvedValue(1);
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    await expect(assertTopupAllowed('u1', 100_000, 'wallet')).resolves.toMatchObject({ tier: 1 });
  });
});

describe('the flag is the switch — off means nothing changed', () => {
  it('denies a Tier-0 checkout top-up when the flag is off', async () => {
    delete process.env.FEATURE_CHECKOUT_TOPUP_TIER0;
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    // Identical to the pre-ADR-042 behaviour: the standalone Tier 1 gate.
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/Tier 1/i);
  });

  it('is off unless the env var is exactly "true"', async () => {
    process.env.FEATURE_CHECKOUT_TOPUP_TIER0 = 'TRUE';
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/Tier 1/i);
  });
});

describe('Tier-0 checkout allowance', () => {
  it('allows a small checkout top-up and reports the remaining allowance', async () => {
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    const res = await assertTopupAllowed('u1', 500_000, 'checkout');
    expect(res).toEqual({ tier: 0, remainingAllowanceKobo: TIER0_ALLOWANCE - 500_000 });
  });

  it('refuses a single top-up above the per-purchase ceiling', async () => {
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    await expect(
      assertTopupAllowed('u1', CHECKOUT_TOPUP_MAX_SINGLE_KOBO + 1, 'checkout'),
    ).rejects.toThrow(/per purchase/i);
  });

  it('refuses once the rolling window is exhausted', async () => {
    mockGetKycTier.mockResolvedValue(0);
    // Already used the full allowance across earlier checkouts.
    mockAdmin.mockReturnValue(makeSupabase(used(TIER0_ALLOWANCE)).client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/daily card limit/i);
  });

  it('refuses the top-up that would cross the cap, not just the one after it', async () => {
    // The cap must be checked against used + THIS amount. Checking only the prior
    // total would let a final top-up straddle the limit.
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase(used(TIER0_ALLOWANCE - 100_000)).client);
    await expect(assertTopupAllowed('u1', 100_001, 'checkout')).rejects.toThrow(/daily card limit/i);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).resolves.toMatchObject({
      remainingAllowanceKobo: 0,
    });
  });

  it('counts PENDING intents, so concurrent checkouts cannot each see a fresh allowance', async () => {
    // A pending intent is money the user has almost certainly already been charged
    // for — the webhook just has not landed. Counting only 'completed' would let N
    // simultaneous checkouts each pass the cap.
    mockGetKycTier.mockResolvedValue(0);
    const { client } = makeSupabase(used(TIER0_ALLOWANCE - 50_000));
    mockAdmin.mockReturnValue(client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/daily card limit/i);

    const intentsCall = client.from.mock.results.find((r) => r.value.in)?.value;
    expect(intentsCall.in).toHaveBeenCalledWith('status', ['pending', 'completed']);
  });

  it('scopes the allowance to checkout top-ups and to this user', async () => {
    // Standalone Tier-1 funding must not consume a checkout allowance, and one
    // user's history must never bound another's.
    mockGetKycTier.mockResolvedValue(0);
    const { client } = makeSupabase(used());
    mockAdmin.mockReturnValue(client);
    await assertTopupAllowed('u1', 100_000, 'checkout');
    const chain = client.from.mock.results.find((r) => r.value.in)?.value;
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(chain.eq).toHaveBeenCalledWith('purpose', 'checkout');
  });

  it('leaves verified tiers uncapped by this gate', async () => {
    for (const tier of [1, 2, 3]) {
      mockGetKycTier.mockResolvedValue(tier);
      mockAdmin.mockReturnValue(makeSupabase(used()).client);
      await expect(assertTopupAllowed('u1', 50_000_000, 'checkout')).resolves.toEqual({
        tier, remainingAllowanceKobo: null,
      });
    }
  });
});

describe('fails closed', () => {
  it('denies when the tier cannot be read', async () => {
    mockGetKycTier.mockRejectedValue(new Error('db down'));
    mockAdmin.mockReturnValue(makeSupabase(used()).client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/Access denied/i);
  });

  it('denies when the allowance history cannot be read', async () => {
    // An unreadable history means the cap cannot be proven intact — allowing here
    // would make the cap unenforceable by simply breaking the query.
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(makeSupabase({ data: null, error: { message: 'boom' } }).client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/allowance/i);
  });

  it('still enforces when the audit write fails', async () => {
    mockGetKycTier.mockResolvedValue(0);
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tier_limit_events') {
          return { insert: vi.fn().mockRejectedValue(new Error('audit down')) };
        }
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.in = vi.fn().mockReturnValue(chain);
        chain.gte = vi.fn().mockResolvedValue(used(TIER0_ALLOWANCE));
        return chain;
      }),
    };
    mockAdmin.mockReturnValue(client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow(/daily card limit/i);
  });
});

describe('audit trail', () => {
  it('records both the approval and the denial', async () => {
    mockGetKycTier.mockResolvedValue(0);
    const allow = makeSupabase(used());
    mockAdmin.mockReturnValue(allow.client);
    await assertTopupAllowed('u1', 100_000, 'checkout');
    expect(allow.inserts).toHaveLength(1);
    expect(allow.inserts[0]).toMatchObject({ limit_type: 'checkout_topup', tier: 0, denied: false });

    const deny = makeSupabase(used(TIER0_ALLOWANCE));
    mockAdmin.mockReturnValue(deny.client);
    await expect(assertTopupAllowed('u1', 100_000, 'checkout')).rejects.toThrow();
    expect(deny.inserts[0]).toMatchObject({ limit_type: 'checkout_topup', denied: true });
  });
});
