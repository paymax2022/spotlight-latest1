// @vitest-environment node
/**
 * The referral admin console read the wrong shape off four real endpoints.
 *
 * Each of these pages reported "This page couldn't load" in production, and the
 * reason is the same every time: the Go handler answers with a NAMED envelope
 * (`{payouts: [...]}`), the client type is a bare array, and the page's guard is
 * `!rows || rows.length === 0` — which is false for a plain object, so `rows.map`
 * throws and the React boundary replaces the whole screen. An unwrap at the
 * service boundary is the fix; the page never has to know the wire shape.
 *
 * The mappings below are pinned field by field against the backend structs
 * (finance.Payout in repo.go:415, merchant.Merchant in service.go:258,
 * risk.DashboardCounts in repo.go:596, house.Handler.Ledger in service.go:157),
 * including the two fields Go spells differently from the console
 * (created_at → requested_at, reward_id → reward_ids) and the path that was
 * simply wrong (/house returns the account, /house/ledger returns the ledger).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const payoutRow = {
  id: 'po_1',
  beneficiary_id: 'user_9',
  reward_id: 'rw_4',
  amount_kobo: 250000,
  currency: 'NGN',
  status: 'queued',
  approved_by: '',
  created_at: '2026-11-19T10:00:00Z',
  updated_at: '2026-11-19T10:00:00Z',
};

describe('referral admin envelopes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_REFERRAL_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('listPayouts unwraps {payouts} instead of handing the page an object', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ payouts: [payoutRow] }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    const rows = await mod.listPayouts();

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('listPayouts maps the backend field names onto the ones the page reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ payouts: [payoutRow] }) })));
    const mod = await import('./referralAdminOpsService');

    const [p] = await mod.listPayouts();

    // The queue table renders "Requested" and "Rewards"; both read the mapped
    // names, so an unmapped row shows blank cells rather than failing.
    expect(p.requested_at).toBe('2026-11-19T10:00:00Z');
    expect(p.reward_ids).toEqual(['rw_4']);
    expect(p.amount_kobo).toBe(250000);
  });

  it('a payout the backend did not attach a reward to keeps an empty list, not undefined', async () => {
    const noReward = { ...payoutRow, reward_id: undefined };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ payouts: [noReward] }) })));
    const mod = await import('./referralAdminOpsService');

    const [p] = await mod.listPayouts();

    expect(p.reward_ids).toEqual([]);
  });

  it('listMerchants unwraps {merchants} and keeps created_at as the join date', async () => {
    const merchant = { id: 'm1', name: 'Kongapay', slug: 'kongapay', status: 'active', created_at: '2026-10-02T08:00:00Z' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ merchants: [merchant] }) })));
    const mod = await import('./referralAdminOpsService');

    const rows = await mod.listMerchants();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Kongapay');
    expect(rows[0].joined_at).toBe('2026-10-02T08:00:00Z');
  });

  it('getRiskDashboard takes its counts from {dashboard} and its rows from {alerts}', async () => {
    const counts = { open_alerts: 7, open_cases: 3, queued_reviews: 11, active_blocks: 2 };
    const alerts = [{ id: 'al_1', subject_user_id: 'u1', rule: 'velocity', status: 'open', amount_at_risk_kobo: 90000, created_at: '2026-11-19T09:00:00Z' }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/risk/alerts') ? { alerts } : { dashboard: counts }),
    })));
    const mod = await import('./referralAdminOpsService');

    const d = await mod.getRiskDashboard();

    expect(d.open_cases).toBe(3);
    expect(d.alerts).toHaveLength(1);
  });

  it('leaves the metrics the backend never computes absent rather than zeroed', async () => {
    // DashboardCounts is four integers. fraud_rate, amount-at-risk, blocked-24h
    // and clawbacks-30d have no source in it, and a 0 on a risk screen reads as
    // "clean" — which is a claim, not an absence of data.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/risk/alerts')
        ? { alerts: [] }
        : { dashboard: { open_alerts: 0, open_cases: 0, queued_reviews: 0, active_blocks: 0 } }),
    })));
    const mod = await import('./referralAdminOpsService');

    const d = await mod.getRiskDashboard();

    expect(d.fraud_rate ?? null).toBeNull();
    expect(d.amount_at_risk_kobo ?? null).toBeNull();
    expect(d.blocked_24h ?? null).toBeNull();
    expect(d.clawbacks_30d_kobo ?? null).toBeNull();
  });

  it('approvePayout posts to the route the backend registers, with idempotency', async () => {
    // finance/service.go:248 registers POST /finance/payouts/:id/approve under
    // referral.payout.manage. The client used to throw "no backend endpoint
    // exists yet" before its own send, which told the operator nothing had
    // changed when the change was available all along.
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ payout: { ...payoutRow, status: 'approved' } }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    await mod.approvePayout('po_1', 'checked against ledger');

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/finance\/payouts\/po_1\/approve$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('rejectPayout posts the reason to the reject route', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    await mod.rejectPayout('po_1', 'device cluster with 6 signups');

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/finance\/payouts\/po_1\/reject$/);
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'device cluster with 6 signups' });
  });

  it('getHouseLedger reads /house/ledger, not /house', async () => {
    // GET /house answers with the house ACCOUNT alone; the ledger — entries plus
    // totals — is the sibling route. Asking for the account and rendering a
    // ledger is how the page got an object with no entries and crashed on map.
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        house: { id: 'ha_1', scope: 'global', region: null, owner_user_id: 'system', code: 'HOUSE', non_withdrawable: true, created_at: '2026-01-01T00:00:00Z' },
        non_withdrawable: true,
        total_count: 12,
        total_kobo: 450000,
        entries: [{ id: 'rl_1', referred_user_id: 'u7', kind: 'cash', state: 'credited', amount_kobo: 450000, currency: 'NGN', excluded_from_override: true, excluded_from_kfactor: true, created_at: '2026-11-18T12:00:00Z' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    const ledger = await mod.getHouseLedger();

    expect((fetchFn.mock.calls[0] as [string])[0]).toMatch(/\/house\/ledger$/);
    expect(ledger.total_house_volume).toBe(12);
    expect(ledger.total_house_value_kobo).toBe(450000);
    expect(ledger.accounts).toHaveLength(1);
    expect(ledger.entries[0].amount_kobo).toBe(450000);
  });

  it('derives budget_neutral from the account the backend actually flags', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        house: { id: 'ha_1', scope: 'global', region: null, owner_user_id: 'system', code: 'HOUSE', non_withdrawable: true, created_at: '2026-01-01T00:00:00Z' },
        non_withdrawable: true,
        total_count: 0,
        total_kobo: 0,
        entries: [],
      }),
    })));
    const mod = await import('./referralAdminService');

    const ledger = await mod.getHouseLedger();

    expect(ledger.budget_neutral).toBe(true);
  });

  it('does not invent a notional balance the ledger does not return', async () => {
    // referral_house_accounts has no balance column in this response, so the
    // table cell has to say "not returned" rather than show ₦0.00, which an
    // operator would read as a measured zero.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        house: { id: 'ha_1', scope: 'global', region: null, owner_user_id: 'system', code: 'HOUSE', non_withdrawable: true, created_at: '2026-01-01T00:00:00Z' },
        non_withdrawable: true,
        total_count: 0,
        total_kobo: 0,
        entries: [],
      }),
    })));
    const mod = await import('./referralAdminService');

    const ledger = await mod.getHouseLedger();

    expect(ledger.accounts[0].balance_kobo ?? null).toBeNull();
  });

  /**
   * GET /merchants/:id answers the bare merchant.Merchant struct (handlers.go:183),
   * which has no campaign_list, invoices, audit trail, contact details or revenue
   * share. The detail page read all of them off that one object, so
   * `data.campaign_list.length` threw on the first click from the directory. The
   * routes that DO carry them are the two siblings registered next to it:
   * /:id/campaigns → {campaigns} and /:id/keys → {keys} (handlers.go:37,41).
   */
  const merchantWire = (o: Record<string, unknown> = {}) => ({
    id: 'mer_7', name: 'Kongapay', slug: 'kongapay', status: 'active',
    owner_user_id: 'usr_owner', funding_wallet_user_id: 'wal_fund',
    created_at: '2026-08-01T09:00:00Z', ...o,
  });
  const campaignWire = {
    id: 'mc_1', merchant_id: 'mer_7', campaign_id: 'cmp_1', name: 'Q4 air push',
    funded_kobo: 8_000_000, settled_kobo: 3_000_000, status: 'funded',
    created_at: '2026-10-04T09:00:00Z',
  };
  const keyWire = {
    id: 'pk_1', merchant_id: 'mer_7', key_prefix: 'rk_live_ab', scopes: ['referral:write'],
    status: 'active', created_at: '2026-09-01T09:00:00Z',
  };

  const merchantFetch = (overrides: Record<string, unknown> = {}) => vi.fn(async (url: string) => {
    if (url.endsWith('/campaigns')) return { ok: true, status: 200, json: async () => ({ campaigns: overrides.campaigns ?? [campaignWire] }) };
    if (url.endsWith('/keys')) return { ok: true, status: 200, json: async () => ({ keys: overrides.keys ?? [keyWire] }) };
    return { ok: true, status: 200, json: async () => overrides.merchant ?? merchantWire() };
  });

  it('getMerchant composes the profile with its campaigns and keys routes', async () => {
    const fetchFn = merchantFetch();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    const detail = await mod.getMerchant('mer_7');

    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/merchants\/mer_7$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/merchants\/mer_7\/campaigns$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/merchants\/mer_7\/keys$/.test(u))).toBe(true);
    expect(detail?.name).toBe('Kongapay');
    // settled_kobo is what the table column calls spent.
    expect(detail?.campaign_list).toEqual([
      { id: 'mc_1', name: 'Q4 air push', status: 'funded', funded_kobo: 8_000_000, spent_kobo: 3_000_000 },
    ]);
  });

  it('sums escrow from the campaign rows instead of trusting a field the API lacks', async () => {
    vi.stubGlobal('fetch', merchantFetch({
      campaigns: [campaignWire, { ...campaignWire, id: 'mc_2', funded_kobo: 2_000_000, settled_kobo: 2_000_000 }],
    }));
    const mod = await import('./referralAdminOpsService');

    const detail = await mod.getMerchant('mer_7');

    // Funded 10,000,000 kobo, settled 5,000,000 — the unspent funded budget, the
    // same arithmetic merchant.Handler.MemberDashboard does server-side.
    expect(detail?.funded_kobo).toBe(10_000_000);
    expect(detail?.outstanding_balance_kobo).toBe(5_000_000);
  });

  it('reports a revoked key as inactive from the keys route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/keys')
        ? { keys: [{ ...keyWire, status: 'revoked' }] }
        : url.endsWith('/campaigns') ? { campaigns: [] } : merchantWire()),
    })));
    const mod = await import('./referralAdminOpsService');

    const detail = await mod.getMerchant('mer_7');

    expect(detail?.api_key_active).toBe(false);
  });

  it('reports an active key as active', async () => {
    vi.stubGlobal('fetch', merchantFetch({ keys: [keyWire] }));
    const mod = await import('./referralAdminOpsService');

    const detail = await mod.getMerchant('mer_7');

    expect(detail?.api_key_active).toBe(true);
  });

  it('a campaigns route that fails rejects instead of listing no campaigns', async () => {
    // Swallowing this into [] would show a partner as unfunded, which is the
    // false all-clear the whole envelope fix exists to stop.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/campaigns')
      ? { ok: false, status: 500, json: async () => ({ error: 'db down' }) }
      : { ok: true, status: 200, json: async () => merchantWire() }));
    const mod = await import('./referralAdminOpsService');

    await expect(mod.getMerchant('mer_7')).rejects.toThrow(/Request failed \(500\)/);
  });

  it('leaves the merchant fields no admin route answers absent', async () => {
    vi.stubGlobal('fetch', merchantFetch());
    const mod = await import('./referralAdminOpsService');

    const detail = await mod.getMerchant('mer_7');

    expect(detail?.category ?? null).toBeNull();
    expect(detail?.kyc_status ?? null).toBeNull();
    expect(detail?.revenue_share_pct ?? null).toBeNull();
    expect(detail?.invoices ?? null).toBeNull();
    expect(detail?.audit ?? null).toBeNull();
  });

  it('approveMerchantCampaign refuses rather than POSTing a route Go never registers', async () => {
    // merchant.Register has fund and settle, no approve (handlers.go:38-40). The
    // old code posted /campaigns/:mcid/approve and surfaced a bare 404; the
    // refusal says what is missing and keeps the click from looking like a
    // partial success.
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    await expect(mod.approveMerchantCampaign('mer_7', 'mc_1', 'looks fine')).rejects.toThrow(/has no backend yet/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
