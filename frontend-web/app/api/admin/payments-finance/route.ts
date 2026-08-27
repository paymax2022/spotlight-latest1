import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { listAuditEvents } from '@/src/server/admin/audit';
import { TIER_VOTE_LIMIT, TIER_WALLET_LIMIT_KOBO, type KycTier } from '@/src/server/kyc/types';

// ADMIN CONSOLIDATION (see docs/adr/ADR-047): frontend-web/app/admin/(dashboard)/
// payments-finance/page.tsx was a fifth orphaned module the ADR never
// accounted for, surfaced while auditing that surface before its deletion.
// Unlike the other orphans it isn't a dead-store bug — it reads real
// Supabase tables (wallet_balance, ledger_entries, user_profiles,
// virtual_accounts) directly. What's missing is a frontend-admin console
// reaching it at all: this is that Path A GET, unchanged in substance from
// the page's own server-side queries, just returned as JSON instead of
// rendered server-side.

type DbRow = Record<string, unknown>;

/**
 * ledger_accounts types that hold CUSTOMER money, as opposed to the platform
 * standing accounts (settlement, provider_clearing, paymax_revenue, escrow,
 * legacy_wallet_contra, …) that ADR-040 posts counter-legs to. Everything not
 * in this list is a platform pot and is excluded from the customer-facing
 * figures — see the original page's own comment for why.
 */
const CUSTOMER_ACCOUNT_TYPES = ['wallet', 'user_wallet', 'group_wallet'] as const;

// `any` here mirrors the original page's own `filter: (query: any) => any`
// signature — the Supabase query builder's fluent type is not worth chaining
// through a helper.
async function queryRows<T>(
  table: string,
  select: string,
  opts: { order?: string; ascending?: boolean; limit?: number; filter?: (query: any) => any } = {},
) {
  const supabase = createAdminClient();
  let query = supabase.from(table).select(select);
  if (opts.filter) query = opts.filter(query);
  if (opts.order) query = query.order(opts.order, { ascending: opts.ascending ?? false });
  if (opts.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  return { rows: (data ?? []) as T[], error: error?.message ?? null };
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'finance:view');

    // Resolved BEFORE the rest so the ledger query can exclude platform
    // accounts server-side — see the original page's comment: trimming
    // client-side after a fixed-size window would under-fill the table.
    const platformAccounts = await queryRows<{ id: string }>('ledger_accounts', 'id', {
      filter: (q) => q.not('type', 'in', `(${CUSTOMER_ACCOUNT_TYPES.join(',')})`),
    });
    const platformAccountIds = platformAccounts.rows.map((row) => row.id);

    const [wallets, ledgerEntriesRaw, kycProfiles, userProfiles, virtualAccounts, auditEventsFromAudit] = await Promise.all([
      queryRows<DbRow>('wallet_balance', 'account_id,user_id,account_type,currency,available_kobo,last_transaction_at', {
        order: 'last_transaction_at', limit: 50,
        filter: (q) => q.in('account_type', CUSTOMER_ACCOUNT_TYPES),
      }),
      queryRows<DbRow>('ledger_entries', 'id,account_id,type,amount_kobo,reference,description,created_at', {
        order: 'created_at', limit: 50,
        filter: (q) => (platformAccountIds.length
          ? q.not('account_id', 'in', `(${platformAccountIds.join(',')})`)
          : q),
      }),
      queryRows<DbRow>('user_profiles', 'id,email,full_name,phone,kyc_tier,kyc_status,phone_verified,kyc_submitted_at,kyc_verified_at,document_type', { order: 'kyc_submitted_at', limit: 50 }),
      queryRows<DbRow>('user_profiles', 'id,email,full_name', { order: 'full_name', ascending: true, limit: 500 }),
      queryRows<DbRow>('virtual_accounts', 'id,user_id,provider,account_number,account_name,bank_name,currency,provisioned_at', { order: 'provisioned_at', limit: 50 }),
      Promise.resolve({ rows: listAuditEvents(50).filter((e) => e.module === 'payments_finance'), error: null as string | null }),
    ]);

    // Fail LOUD, not open: if the platform-account lookup errored we could not
    // build the exclusion, so the entry stream may contain counter-legs and
    // the volume figures would silently double-count. Surface it.
    const ledgerEntries = { error: ledgerEntriesRaw.error ?? platformAccounts.error, rows: ledgerEntriesRaw.rows };

    const totalBalance = wallets.rows.reduce((sum, row) => sum + Number(row.available_kobo || 0), 0);
    const debitVolume = ledgerEntries.rows.filter((r) => r.type === 'DEBIT').reduce((sum, r) => sum + Number(r.amount_kobo || 0), 0);
    const creditVolume = ledgerEntries.rows.filter((r) => r.type === 'CREDIT').reduce((sum, r) => sum + Number(r.amount_kobo || 0), 0);
    const pendingKycCount = kycProfiles.rows.filter((r) => r.kyc_status === 'pending').length;
    const verifiedKycCount = kycProfiles.rows.filter((r) => r.kyc_status === 'verified').length;

    const profileById = new Map(userProfiles.rows.map((p) => [p.id as string, p]));
    const walletsOut = wallets.rows.map((w) => {
      const profile = profileById.get(w.user_id as string) as { full_name?: string; email?: string } | undefined;
      return {
        ...w,
        userName: profile?.full_name || profile?.email || (w.user_id as string),
        userDetail: profile?.email || (w.user_id as string),
      };
    });

    const tierPolicy = ([0, 1, 2, 3] as KycTier[]).map((tier) => ({
      tier,
      walletLimitKobo: TIER_WALLET_LIMIT_KOBO[tier],
      voteLimit: TIER_VOTE_LIMIT[tier],
    }));

    return successResponse({
      wallets: walletsOut,
      ledgerEntries: { rows: ledgerEntries.rows, error: ledgerEntries.error },
      kycProfiles: { rows: kycProfiles.rows, error: kycProfiles.error },
      virtualAccounts: { rows: virtualAccounts.rows, error: virtualAccounts.error },
      auditEvents: auditEventsFromAudit.rows,
      tierPolicy,
      stats: {
        totalBalanceKobo: totalBalance,
        creditVolumeKobo: creditVolume,
        debitVolumeKobo: debitVolume,
        pendingKyc: pendingKycCount,
        verifiedKyc: verifiedKycCount,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load payments & finance console data');
  }
}
