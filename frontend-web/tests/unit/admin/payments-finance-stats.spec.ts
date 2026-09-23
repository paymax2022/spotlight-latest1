/**
 * WAL-013 — Payments & Finance admin console `stats` block.
 *
 * Exercises `app/api/admin/payments-finance/route.ts` directly, mocking
 * Supabase at the module boundary (mirroring
 * tests/unit/registration/vote-packages-crud.spec.ts's pattern).
 *
 * Before the fix, `stats.totalBalanceKobo` summed only the 50 most-recently-
 * active wallet_balance rows and `stats.creditVolumeKobo`/`debitVolumeKobo`
 * summed only the 50 most-recent ledger_entries rows, regardless of age —
 * both silently understating the true figures once there were more than 50
 * rows. There was also no `activeWalletsCount` at all. The fix moves all
 * four stats to a single `admin_payments_finance_stats` RPC call, computed
 * as real, unbounded SQL aggregates over a 30-day window, while leaving the
 * `wallets`/`ledgerEntries` row lists (still capped at 50 for table display)
 * untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/admin/audit', () => ({ listAuditEvents: vi.fn(() => []) }));

import { GET } from '@/app/api/admin/payments-finance/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

function req() {
  return new Request('https://x.test/api/admin/payments-finance', { method: 'GET' });
}

/**
 * Builds a fake Supabase admin client whose `.from(table)` query chain
 * resolves with `tableData[table]`, and whose `.rpc(name, params)` resolves
 * with `rpcResult` while recording the params it was called with.
 */
function makeSupabase(opts: {
  tableData: Record<string, any[]>;
  rpcResult?: { data?: any[] | null; error?: { message: string } | null };
}) {
  const rpcCalls: { name: string; params: any }[] = [];
  const chainFor = (table: string) => {
    const chain: any = {
      select: () => chain,
      in: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: opts.tableData[table] ?? [], error: null }),
    };
    // Some queries (e.g. platformAccounts) have no .order()/.limit() in the
    // chain before awaiting — support both `await query` directly too by
    // making the chain itself thenable, resolving like `.limit()` would.
    chain.then = (resolve: any) => Promise.resolve({ data: opts.tableData[table] ?? [], error: null }).then(resolve);
    return chain;
  };
  const client = {
    from: (table: string) => chainFor(table),
    rpc: (name: string, params: any) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(opts.rpcResult ?? { data: [], error: null });
    },
  };
  return { client, rpcCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('WAL-013: payments-finance stats', () => {
  it('total balance comes from the RPC aggregate, not a sum of the capped 50-row wallet list', async () => {
    // The capped list has only 2 rows with a tiny sum; the RPC (the real,
    // unbounded aggregate) reports a much larger true total. If the route
    // regressed to client-side summing, this test would see the small number.
    const cappedWalletRows = [
      { account_id: 'w1', user_id: 'u1', account_type: 'user_wallet', currency: 'NGN', available_kobo: 1000, last_transaction_at: null },
      { account_id: 'w2', user_id: 'u2', account_type: 'user_wallet', currency: 'NGN', available_kobo: 2000, last_transaction_at: null },
    ];
    const { client, rpcCalls } = makeSupabase({
      tableData: { ledger_accounts: [], wallet_balance: cappedWalletRows, ledger_entries: [], user_profiles: [], virtual_accounts: [] },
      rpcResult: { data: [{ total_balance_kobo: 190867932, credit_volume_kobo: 0, debit_volume_kobo: 0, active_wallets_count: 0 }], error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    // True total, not sum(cappedWalletRows) === 3000.
    expect(body.stats.totalBalanceKobo).toBe(190867932);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('admin_payments_finance_stats');
  });

  it('credit/debit volume respect the time window rather than "last 50 rows regardless of age"', async () => {
    const { client, rpcCalls } = makeSupabase({
      tableData: { ledger_accounts: [], wallet_balance: [], ledger_entries: [], user_profiles: [], virtual_accounts: [] },
      rpcResult: { data: [{ total_balance_kobo: 0, credit_volume_kobo: 156987977, debit_volume_kobo: 11370000, active_wallets_count: 58 }], error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    const body = await res.json();

    expect(body.stats.creditVolumeKobo).toBe(156987977);
    expect(body.stats.debitVolumeKobo).toBe(11370000);
    expect(body.stats.statsWindowDays).toBe(30);

    // The RPC must be given an actual window_start timestamp, not "no bound".
    const params = rpcCalls[0].params;
    expect(params.p_window_start).toBeTruthy();
    const windowStartMs = new Date(params.p_window_start).getTime();
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(windowStartMs - expectedMs)).toBeLessThan(5000);
  });

  it('activeWalletsCount is present and passed through from the aggregate', async () => {
    const { client } = makeSupabase({
      tableData: { ledger_accounts: [], wallet_balance: [], ledger_entries: [], user_profiles: [], virtual_accounts: [] },
      rpcResult: { data: [{ total_balance_kobo: 0, credit_volume_kobo: 0, debit_volume_kobo: 0, active_wallets_count: 58 }], error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    const body = await res.json();

    expect(body.stats.activeWalletsCount).toBe(58);
  });

  it('platform accounts are still excluded: the RPC is called with the platformAccountIds and CUSTOMER_ACCOUNT_TYPES the route already computes', async () => {
    const platformRows = [{ id: 'plat-1' }, { id: 'plat-2' }];
    const { client, rpcCalls } = makeSupabase({
      tableData: { ledger_accounts: platformRows, wallet_balance: [], ledger_entries: [], user_profiles: [], virtual_accounts: [] },
      rpcResult: { data: [{ total_balance_kobo: 0, credit_volume_kobo: 0, debit_volume_kobo: 0, active_wallets_count: 0 }], error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    await GET(req());

    const params = rpcCalls[0].params;
    expect(params.p_excluded_account_ids).toEqual(['plat-1', 'plat-2']);
    expect(params.p_customer_account_types).toEqual(['wallet', 'user_wallet', 'group_wallet']);
  });

  it('falls back to 0s and surfaces an error, rather than silently reusing the capped sums, if the RPC errors', async () => {
    const { client } = makeSupabase({
      tableData: { ledger_accounts: [], wallet_balance: [{ account_id: 'w1', user_id: 'u1', account_type: 'user_wallet', currency: 'NGN', available_kobo: 5000, last_transaction_at: null }], ledger_entries: [], user_profiles: [], virtual_accounts: [] },
      rpcResult: { data: null, error: { message: 'function admin_payments_finance_stats does not exist' } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    const body = await res.json();

    expect(body.stats.totalBalanceKobo).toBe(0);
    expect(body.stats.error).toBe('function admin_payments_finance_stats does not exist');
  });
});
