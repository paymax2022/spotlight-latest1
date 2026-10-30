// Utility payment gate — the pre-rail checks a bill payment must pass BEFORE a
// transaction row is written or a payment rail (wallet debit / Paystack
// initialize) is touched.
//
//   wallet rail
//     Tier 0  : at most ₦20,000 per payment, else 403 asking for KYC Tier 1;
//               at most ₦50,000 of wallet debits per UTC day.
//     Tier 1+ : the ordinary tier daily caps (unchanged).
//   paystack rail (any tier)
//     at most ₦20,000 per payment; at most ₦50,000 per UTC day across the
//     member's non-failed Paystack bill intents.
//
// Every check fails closed: a tier or ledger read error is a 503, never a pass.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/kyc/service', () => ({
  getKycTier: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { getKycTier } from '@/src/server/kyc/service';
import { ApiError } from '@/src/lib/api/responses';
import {
  UTILITY_GATEWAY_DAILY_CAP_KOBO,
  UTILITY_GATEWAY_TXN_MAX_KOBO,
  UTILITY_TIER0_DAILY_CAP_KOBO,
  UTILITY_TIER0_TXN_MAX_KOBO,
  enforceUtilityPaymentGate,
} from '@/src/server/utility/payment-gate';

const USER = 'user-gate-001';
const mockAdmin = createAdminClient as ReturnType<typeof vi.fn>;
const mockTier = getKycTier as ReturnType<typeof vi.fn>;

type Result = { data: unknown; error: null | { message: string } };

/**
 * A query builder stub: every filter method returns the builder, `maybeSingle`
 * and `await` both resolve to the canned result for that table.
 */
function table(result: Result) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'neq', 'not', 'order', 'limit']) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.insert = vi.fn().mockResolvedValue({ error: null });
  b.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return b;
}

function supabaseWith(tables: Record<string, Result>) {
  const from = vi.fn().mockImplementation((name: string) => {
    const r = tables[name];
    if (!r) throw new Error(`unexpected table ${name}`);
    return table(r);
  });
  mockAdmin.mockReturnValue({ from });
  return from;
}

function walletTables(opts: { debitedTodayKobo?: number[]; entriesError?: boolean } = {}) {
  return supabaseWith({
    ledger_accounts: { data: { id: 'acct-1' }, error: null },
    ledger_entries: opts.entriesError
      ? { data: null, error: { message: 'boom' } }
      : { data: (opts.debitedTodayKobo ?? []).map((amount_kobo) => ({ amount_kobo })), error: null },
    tier_limit_events: { data: null, error: null },
  });
}

function paystackTables(opts: { intents?: Array<{ retail_amount_kobo: number }>; error?: boolean } = {}) {
  return supabaseWith({
    utility_paystack_intents: opts.error
      ? { data: null, error: { message: 'boom' } }
      : { data: opts.intents ?? [], error: null },
  });
}

async function refusal(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    const e = err as Partial<ApiError> & Error;
    if (typeof e.status !== 'number') throw new Error(`gate threw a non-ApiError: ${e.name}: ${e.message}\n${e.stack}`);
    return err as ApiError;
  }
  throw new Error('expected the gate to refuse');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_TIER_LIMITS_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('limits', () => {
  it('pins the spec amounts', () => {
    expect(UTILITY_TIER0_TXN_MAX_KOBO).toBe(2_000_000);
    expect(UTILITY_TIER0_DAILY_CAP_KOBO).toBe(5_000_000);
    expect(UTILITY_GATEWAY_TXN_MAX_KOBO).toBe(2_000_000);
    expect(UTILITY_GATEWAY_DAILY_CAP_KOBO).toBe(5_000_000);
  });
});

describe('wallet rail — Tier 0', () => {
  beforeEach(() => mockTier.mockResolvedValue(0));

  it('allows exactly ₦20,000', async () => {
    walletTables();
    await expect(enforceUtilityPaymentGate(USER, 'wallet', 2_000_000)).resolves.toBeUndefined();
  });

  it('refuses ₦20,000.01 with a KYC Tier 1 403 before any rail is touched', async () => {
    const from = walletTables();
    const err = await refusal(enforceUtilityPaymentGate(USER, 'wallet', 2_000_001));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/KYC Tier 1/);
    // No ledger read is needed to refuse an oversized payment.
    expect(from).not.toHaveBeenCalledWith('ledger_entries');
  });

  it('refuses when today’s wallet debits plus this payment exceed ₦50,000', async () => {
    walletTables({ debitedTodayKobo: [3_000_000, 1_500_000] });
    const err = await refusal(enforceUtilityPaymentGate(USER, 'wallet', 500_001));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/50,000/);
  });

  it('allows when today’s wallet debits plus this payment reach exactly ₦50,000', async () => {
    walletTables({ debitedTodayKobo: [3_000_000, 1_500_000] });
    await expect(enforceUtilityPaymentGate(USER, 'wallet', 500_000)).resolves.toBeUndefined();
  });

  it('fails closed (503) when the daily total cannot be read', async () => {
    walletTables({ entriesError: true });
    const err = await refusal(enforceUtilityPaymentGate(USER, 'wallet', 100_000));
    expect(err.status).toBe(503);
  });

});

// Kept outside the Tier 0 block: its beforeEach pre-sets a resolved tier, and
// vitest 5 then attributes the later rejection to the test itself.
describe('wallet rail — tier lookup failure', () => {
  it('fails closed (503) when the tier cannot be read', async () => {
    mockTier.mockRejectedValue(new Error('db down'));
    walletTables();
    await expect(enforceUtilityPaymentGate(USER, 'wallet', 100_000)).rejects.toMatchObject({ status: 503 });
  });
});

describe('wallet rail — Tier 1+', () => {
  it('does not apply the ₦20,000 per-payment cap to a verified member', async () => {
    mockTier.mockResolvedValue(1);
    walletTables();
    await expect(enforceUtilityPaymentGate(USER, 'wallet', 3_000_000)).resolves.toBeUndefined();
  });

  it('still applies the member’s own tier daily cap', async () => {
    mockTier.mockResolvedValue(1); // ₦50,000 / day
    walletTables({ debitedTodayKobo: [4_900_000] });
    const err = await refusal(enforceUtilityPaymentGate(USER, 'wallet', 200_000));
    expect(err.status).toBe(403);
  });
});

describe('paystack rail — any tier', () => {
  it('allows exactly ₦20,000', async () => {
    mockTier.mockResolvedValue(3);
    paystackTables();
    await expect(enforceUtilityPaymentGate(USER, 'paystack', 2_000_000)).resolves.toBeUndefined();
  });

  it('refuses ₦20,000.01 even for a Tier 3 member', async () => {
    mockTier.mockResolvedValue(3);
    const from = paystackTables();
    const err = await refusal(enforceUtilityPaymentGate(USER, 'paystack', 2_000_001));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/20,000/);
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses when today’s Paystack bill intents plus this payment exceed ₦50,000', async () => {
    paystackTables({ intents: [{ retail_amount_kobo: 2_000_000 }, { retail_amount_kobo: 2_000_000 }] });
    const err = await refusal(enforceUtilityPaymentGate(USER, 'paystack', 1_000_001));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/50,000/);
  });

  it('allows when today’s Paystack bill intents plus this payment reach exactly ₦50,000', async () => {
    paystackTables({ intents: [{ retail_amount_kobo: 2_000_000 }, { retail_amount_kobo: 2_000_000 }] });
    await expect(enforceUtilityPaymentGate(USER, 'paystack', 1_000_000)).resolves.toBeUndefined();
  });

  it('counts only non-failed intents from the start of the UTC day', async () => {
    const from = paystackTables();
    await enforceUtilityPaymentGate(USER, 'paystack', 100_000);
    const builder = from.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(builder.eq).toHaveBeenCalledWith('user_id', USER);
    expect(builder.in).toHaveBeenCalledWith('status', ['pending', 'completed']);
    const [col, since] = builder.gte.mock.calls[0];
    expect(col).toBe('created_at');
    expect(since).toMatch(/T00:00:00\.000Z$/);
  });

  it('fails closed (503) when the daily total cannot be read', async () => {
    paystackTables({ error: true });
    const err = await refusal(enforceUtilityPaymentGate(USER, 'paystack', 100_000));
    expect(err.status).toBe(503);
  });
});

describe('input', () => {
  it('rejects a non-positive or non-integer amount', async () => {
    await expect(enforceUtilityPaymentGate(USER, 'wallet', 0)).rejects.toMatchObject({ status: 400 });
    await expect(enforceUtilityPaymentGate(USER, 'paystack', 10.5)).rejects.toMatchObject({ status: 400 });
  });
});
