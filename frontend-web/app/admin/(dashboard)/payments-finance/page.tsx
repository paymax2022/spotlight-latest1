import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/src/lib/auth/server';
import { addAuditEvent } from '@/src/server/admin/audit';
import { approveKyc, failKyc, suspendKyc } from '@/src/server/kyc/service';
import { TIER_VOTE_LIMIT, TIER_WALLET_LIMIT_KOBO, type KycTier } from '@/src/server/kyc/types';
import { creditWallet, debitWallet, getOrCreateAccount } from '@/src/server/wallet/service';

export const dynamic = 'force-dynamic';

type DbRow = Record<string, unknown>;

type WalletBalanceRow = {
  account_id: string;
  user_id: string;
  account_type: string;
  currency: string;
  available_kobo: number;
  last_transaction_at: string | null;
};

type LedgerEntryRow = {
  id: string;
  account_id: string;
  type: string;
  amount_kobo: number;
  reference: string;
  description: string | null;
  created_at: string;
};

type KycProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  kyc_tier: number;
  kyc_status: string;
  phone_verified: boolean;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  document_type: string | null;
};

type UserProfileSummary = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type VirtualAccountRow = {
  id: string;
  user_id: string;
  provider: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  currency: string;
  provisioned_at: string;
};

type ServerFormAction = string;

function formatNaira(kobo: number | null | undefined) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format((kobo ?? 0) / 100);
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-NG') : '-';
}

function badgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (['verified', 'credit', 'active', 'successful'].some((key) => normalized.includes(key))) return 'badge-approved';
  if (['failed', 'suspended', 'debit', 'reversal'].some((key) => normalized.includes(key))) return 'badge-rejected';
  return 'badge-pending';
}

function displayUser(profile: UserProfileSummary | undefined, fallbackId: string) {
  if (!profile) return { name: fallbackId, detail: fallbackId };
  const name = profile.full_name || profile.email || fallbackId;
  return { name, detail: profile.email || fallbackId };
}

function amountFromNaira(value: FormDataEntryValue | null) {
  const amountNaira = Number(value || 0);
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    throw new Error('Enter a valid amount greater than 0.');
  }
  return Math.round(amountNaira * 100);
}

async function adminActorId() {
  const { user } = await requireAdmin();
  return user.id;
}

async function approveKycAction(formData: FormData) {
  'use server';

  const actorId = await adminActorId();
  const userId = String(formData.get('user_id') || '');
  const tier = Number(formData.get('tier') || 1) as KycTier;
  if (!userId) return;

  await approveKyc(userId, tier, actorId);
  addAuditEvent({
    adminUser: actorId,
    role: 'admin',
    action: 'fintech.kyc.approve',
    module: 'payments_finance',
    entityType: 'user_profile',
    entityId: userId,
    reason: `Approved KYC tier ${tier}`,
  });
  revalidatePath('/admin/payments-finance');
}

async function rejectKycAction(formData: FormData) {
  'use server';

  const actorId = await adminActorId();
  const userId = String(formData.get('user_id') || '');
  const reason = String(formData.get('reason') || 'Rejected by compliance review.');
  if (!userId) return;

  await failKyc(userId, reason, actorId);
  addAuditEvent({
    adminUser: actorId,
    role: 'admin',
    action: 'fintech.kyc.reject',
    module: 'payments_finance',
    entityType: 'user_profile',
    entityId: userId,
    reason,
  });
  revalidatePath('/admin/payments-finance');
}

async function suspendKycAction(formData: FormData) {
  'use server';

  const actorId = await adminActorId();
  const userId = String(formData.get('user_id') || '');
  const reason = String(formData.get('reason') || 'Suspended by compliance review.');
  if (!userId) return;

  await suspendKyc(userId, reason, actorId);
  addAuditEvent({
    adminUser: actorId,
    role: 'admin',
    action: 'fintech.kyc.suspend',
    module: 'payments_finance',
    entityType: 'user_profile',
    entityId: userId,
    reason,
  });
  revalidatePath('/admin/payments-finance');
}

async function backfillWalletsAction() {
  'use server';

  const actorId = await adminActorId();
  const supabase = createAdminClient();
  const { data } = await supabase.from('user_profiles').select('id').limit(500);
  const profiles = (data ?? []) as Array<{ id: string }>;

  let processed = 0;
  for (const profile of profiles) {
    if (!profile.id) continue;
    await getOrCreateAccount(profile.id);
    processed += 1;
  }

  addAuditEvent({
    adminUser: actorId,
    role: 'admin',
    action: 'fintech.wallet.backfill',
    module: 'payments_finance',
    entityType: 'ledger_account',
    reason: `Ensured wallet accounts for ${processed} profiles`,
  });
  revalidatePath('/admin/payments-finance');
}

async function adjustWalletAction(formData: FormData) {
  'use server';

  const actorId = await adminActorId();
  const userId = String(formData.get('user_id') || '');
  const direction = String(formData.get('direction') || '');
  const amountKobo = amountFromNaira(formData.get('amount_naira'));
  const reason = String(formData.get('reason') || '').trim();
  if (!userId) throw new Error('Missing user.');
  if (!reason) throw new Error('Reason is required for wallet adjustments.');

  const reference = `ADMIN-${direction.toUpperCase()}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const input = {
    amountKobo,
    reference,
    idempotencyKey: `admin-wallet:${reference}:${direction}`,
    description: `Admin wallet ${direction}: ${reason}`,
    // ADR-040: manual admin movements settle against the platform clearing pot,
    // not against a payment provider.
    counterAccount: 'settlement' as const,
    metadata: {
      actor_id: actorId,
      reason,
      source: 'admin_payments_finance',
    },
  };

  if (direction === 'credit') {
    await creditWallet(userId, input);
  } else if (direction === 'debit') {
    await debitWallet(userId, input);
  } else {
    throw new Error('Invalid wallet adjustment direction.');
  }

  addAuditEvent({
    adminUser: actorId,
    role: 'admin',
    action: direction === 'credit' ? 'fintech.wallet.credit' : 'fintech.wallet.debit',
    module: 'payments_finance',
    entityType: 'wallet',
    entityId: userId,
    reason: `${reason} (${formatNaira(amountKobo)})`,
    newValue: { userId, amountKobo, reference, direction },
  });
  revalidatePath('/admin/payments-finance');
}

const approveKycFormAction = approveKycAction as unknown as ServerFormAction;
const rejectKycFormAction = rejectKycAction as unknown as ServerFormAction;
const suspendKycFormAction = suspendKycAction as unknown as ServerFormAction;
const backfillWalletsFormAction = backfillWalletsAction as unknown as ServerFormAction;
const adjustWalletFormAction = adjustWalletAction as unknown as ServerFormAction;

/**
 * ledger_accounts types that hold CUSTOMER money, as opposed to the platform
 * standing accounts (settlement, provider_clearing, paymax_revenue, escrow,
 * legacy_wallet_contra, …) that ADR-040 posts counter-legs to. Everything not in
 * this list is a platform pot and is excluded from the customer-facing figures.
 */
const CUSTOMER_ACCOUNT_TYPES = ['wallet', 'user_wallet', 'group_wallet'] as const;

async function queryRows<T>(table: string, select: string, opts: { order?: string; ascending?: boolean; limit?: number; filter?: (query: any) => any } = {}) {
  const supabase = createAdminClient();
  let query = supabase.from(table).select(select);
  if (opts.filter) query = opts.filter(query);
  if (opts.order) query = query.order(opts.order, { ascending: opts.ascending ?? false });
  if (opts.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  return { rows: (data ?? []) as T[], error: error?.message ?? null };
}

export default async function PaymentsFinanceAdminPage() {
  // ADR-040: every wallet movement now also posts a counter-leg onto a PLATFORM
  // standing account (settlement / provider_clearing / paymax_revenue / …).
  // Those are not customer money — including them here would make "Wallet
  // Balance" move the WRONG WAY on a spend (the user's wallet drops, the
  // settlement pot rises by the same amount) and would let them monopolise the
  // 50-row windows below.
  //
  // Discriminated by ACCOUNT TYPE rather than `user_id IS NULL`: group wallets
  // are customer money but also carry a NULL user_id
  // (backend/internal/groups/service.go), so a user_id test would wrongly drop
  // them from these figures.
  //
  // Resolved BEFORE the rest so the ledger query can exclude platform accounts
  // server-side. Trimming client-side after a fixed-size window would under-fill
  // the table: the ADR-040 backfill inserts every contra-leg with the same
  // created_at, so right after that migration the newest N rows can be entirely
  // contra-legs.
  const platformAccounts = await queryRows<{ id: string }>('ledger_accounts', 'id', {
    filter: (q) => q.not('type', 'in', `(${CUSTOMER_ACCOUNT_TYPES.join(',')})`),
  });
  const platformAccountIds = platformAccounts.rows.map((row) => row.id);

  const [wallets, ledgerEntriesRaw, kycProfiles, userProfiles, virtualAccounts, auditEvents] = await Promise.all([
    queryRows<WalletBalanceRow>('wallet_balance', 'account_id,user_id,account_type,currency,available_kobo,last_transaction_at', { order: 'last_transaction_at', limit: 50, filter: (q) => q.in('account_type', CUSTOMER_ACCOUNT_TYPES) }),
    queryRows<LedgerEntryRow>('ledger_entries', 'id,account_id,type,amount_kobo,reference,description,created_at', {
      order: 'created_at',
      limit: 50,
      filter: (q) => (platformAccountIds.length
        ? q.not('account_id', 'in', `(${platformAccountIds.join(',')})`)
        : q),
    }),
    queryRows<KycProfileRow>(
      'user_profiles',
      'id,email,full_name,phone,kyc_tier,kyc_status,phone_verified,kyc_submitted_at,kyc_verified_at,document_type',
      { order: 'kyc_submitted_at', limit: 50 },
    ),
    queryRows<UserProfileSummary>('user_profiles', 'id,email,full_name', { order: 'full_name', ascending: true, limit: 500 }),
    queryRows<VirtualAccountRow>('virtual_accounts', 'id,user_id,provider,account_number,account_name,bank_name,currency,provisioned_at', { order: 'provisioned_at', limit: 50 }),
    queryRows<DbRow>('kyc_events', 'id,user_id,old_status,new_status,old_tier,new_tier,note,created_at', { order: 'created_at', limit: 50 }),
  ]);

  // Fail LOUD, not open: if the platform-account lookup errored we could not
  // build the exclusion, so the entry stream may contain counter-legs and the
  // volume tiles would silently revert to double-counting. Surface it.
  const ledgerEntries = {
    error: ledgerEntriesRaw.error ?? platformAccounts.error,
    rows: ledgerEntriesRaw.rows,
  };

  const totalBalance = wallets.rows.reduce((sum, row) => sum + Number(row.available_kobo || 0), 0);
  const pendingKyc = kycProfiles.rows.filter((row) => row.kyc_status === 'pending');
  const verifiedKyc = kycProfiles.rows.filter((row) => row.kyc_status === 'verified');
  const debitVolume = ledgerEntries.rows
    .filter((row) => row.type === 'DEBIT')
    .reduce((sum, row) => sum + Number(row.amount_kobo || 0), 0);
  const creditVolume = ledgerEntries.rows
    .filter((row) => row.type === 'CREDIT')
    .reduce((sum, row) => sum + Number(row.amount_kobo || 0), 0);
  const profileById = new Map(userProfiles.rows.map((profile) => [profile.id, profile]));

  const modules = [
    ['Wallet', 'Ledger-backed balances, wallet backfill, immutable debit/credit history.', wallets.error ? 'Needs DB migration' : 'Manageable'],
    ['Virtual Accounts', 'Dedicated account inventory and funding rail readiness.', virtualAccounts.error ? 'Needs DB migration' : 'Manageable'],
    ['Transactions', 'Ledger entries, references, idempotency and reversal audit trail.', ledgerEntries.error ? 'Needs DB migration' : 'Manageable'],
    ['KYC', 'Review pending profiles, approve tiers, reject or suspend profiles.', kycProfiles.error ? 'Needs DB migration' : 'Manageable'],
    ['Tier Management', 'Tier limits are currently code-configured from KYC policy constants.', 'Policy visible'],
    ['Referral & Rewards', 'PRD module not backed by tables in this checkout yet.', 'Backend required'],
    ['User Profile', 'KYC fields extend user_profiles; profile editor remains user-facing.', 'Linked'],
    ['RBAC / Audit', 'Admin roles and audit events exist; maker-checker remains a PRD gap.', 'Partial'],
  ];

  return (
    <section className="pb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground mb-1">Payments & Finance</h1>
          <p className="text-foreground-muted mb-0">Fintech operations console for wallet, ledger, virtual accounts, KYC, tiers, RBAC and reconciliation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={backfillWalletsFormAction}>
            <button type="submit" className="btn-primary py-2 px-3 text-[11px]">Backfill Wallets</button>
          </form>
          <Link href="/admin/users-roles" className="btn-outline py-2 px-3 text-[11px]">Manage RBAC</Link>
          <Link href="/admin/audit-logs" className="btn-outline py-2 px-3 text-[11px]">Audit Logs</Link>
          <Link href="/admin/utility" className="btn-outline py-2 px-3 text-[11px]">Utility Payments</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        {[
          ['Wallet Balance', formatNaira(totalBalance), 'Across listed wallet accounts', 'fa-wallet'],
          ['Credit Volume', formatNaira(creditVolume), 'Recent ledger credits', 'fa-arrow-trend-up'],
          ['Debit Volume', formatNaira(debitVolume), 'Recent ledger debits', 'fa-arrow-trend-down'],
          ['Pending KYC', String(pendingKyc.length), 'Manual review queue', 'fa-id-card'],
        ].map(([label, value, note, icon]) => (
          <div key={label} className="glass-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-foreground-muted">{label}</div>
                <div className="text-3xl font-bold text-foreground mt-2">{value}</div>
                <div className="text-xs text-foreground-dim mt-2">{note}</div>
              </div>
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-md" style={{ background: 'rgba(115,103,240,0.13)', color: '#7367f0' }}>
                <i className={`fa-solid ${icon}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card p-4 mb-5">
        <h2 className="font-display text-xl text-foreground mb-3">Fintech PRD Module Coverage</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-bg-card">
              <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                <th className="py-3 px-3">Module</th>
                <th className="py-3 px-3">Admin Capability</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {modules.map(([name, capability, status]) => (
                <tr key={name} className="border-t border-border">
                  <td className="py-2.5 px-3 text-foreground font-semibold">{name}</td>
                  <td className="py-2.5 px-3 text-foreground-muted">{capability}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${status === 'Manageable' ? 'badge-approved' : status === 'Backend required' ? 'badge-rejected' : 'badge-pending'}`}>
                      {status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card p-4 mb-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-3">
          <div>
            <h2 className="font-display text-xl text-foreground mb-1">KYC Review Queue</h2>
            <p className="text-sm text-foreground-muted mb-0">Approve users into the correct fintech tier, reject failed submissions, or suspend verified profiles.</p>
          </div>
          <span className="text-xs text-foreground-dim">{verifiedKyc.length} verified profiles listed</span>
        </div>
        {kycProfiles.error ? (
          <p className="text-foreground-muted mb-0">{kycProfiles.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">Document</th>
                  <th className="py-3 px-3">Tier</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Submitted</th>
                  <th className="py-3 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {kycProfiles.rows.length === 0 ? (
                  <tr><td className="py-5 px-3 text-foreground-muted" colSpan={7}>No KYC profiles found.</td></tr>
                ) : kycProfiles.rows.map((profile) => (
                  <tr key={profile.id} className="border-t border-border">
                    <td className="py-2.5 px-3">
                      <div className="text-foreground font-semibold">{profile.full_name || profile.email || profile.id}</div>
                      <div className="text-xs text-foreground-dim">{profile.email || profile.id}</div>
                    </td>
                    <td className="py-2.5 px-3 text-foreground-muted">{profile.phone || '-'}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{profile.document_type || '-'}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">Tier {profile.kyc_tier ?? 0}</td>
                    <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(profile.kyc_status)}`}>{profile.kyc_status}</span></td>
                    <td className="py-2.5 px-3 text-foreground-muted">{formatDate(profile.kyc_submitted_at)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-2">
                        {profile.kyc_status === 'pending' ? (
                          <>
                            <form action={approveKycFormAction} className="flex gap-2">
                              <input type="hidden" name="user_id" value={profile.id} />
                              <select name="tier" className="form-input h-[32px] min-h-0 w-[86px] py-1 text-xs" defaultValue="1">
                                <option value="1">Tier 1</option>
                                <option value="2">Tier 2</option>
                                <option value="3">Tier 3</option>
                              </select>
                              <button type="submit" className="btn-primary py-1.5 px-2 text-[10px]">Approve</button>
                            </form>
                            <form action={rejectKycFormAction} className="flex gap-2">
                              <input type="hidden" name="user_id" value={profile.id} />
                              <input type="hidden" name="reason" value="Rejected by admin review." />
                              <button type="submit" className="btn-outline py-1.5 px-2 text-[10px]">Reject</button>
                            </form>
                          </>
                        ) : null}
                        {profile.kyc_status === 'verified' ? (
                          <form action={suspendKycFormAction}>
                            <input type="hidden" name="user_id" value={profile.id} />
                            <input type="hidden" name="reason" value="Suspended by admin review." />
                            <button type="submit" className="btn-outline py-1.5 px-2 text-[10px]">Suspend</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 mb-5">
        <div className="glass-card p-4">
          <h2 className="font-display text-xl text-foreground mb-3">Wallet & Ledger Accounts</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Account</th>
                  <th className="py-3 px-3">Balance</th>
                  <th className="py-3 px-3">Last Activity</th>
                  <th className="py-3 px-3">Wallet Adjustment</th>
                </tr>
              </thead>
              <tbody>
                {wallets.rows.length === 0 ? (
                  <tr><td className="py-5 px-3 text-foreground-muted" colSpan={5}>{wallets.error || 'No wallet accounts found.'}</td></tr>
                ) : wallets.rows.map((wallet) => {
                  const user = displayUser(profileById.get(wallet.user_id), wallet.user_id);
                  return (
                    <tr key={wallet.account_id} className="border-t border-border">
                      <td className="py-2.5 px-3">
                        <div className="text-foreground font-semibold">{user.name}</div>
                        <div className="text-xs text-foreground-dim">{user.detail}</div>
                      </td>
                      <td className="py-2.5 px-3 text-foreground-muted">{wallet.account_id.slice(0, 8)} · {wallet.currency}</td>
                      <td className="py-2.5 px-3 text-foreground font-semibold">{formatNaira(wallet.available_kobo)}</td>
                      <td className="py-2.5 px-3 text-foreground-muted">{formatDate(wallet.last_transaction_at)}</td>
                      <td className="py-2.5 px-3">
                        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2 min-w-[420px]">
                          <form action={adjustWalletFormAction} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="user_id" value={wallet.user_id} />
                            <input type="hidden" name="direction" value="credit" />
                            <label className="d-block">
                              <span className="form-label">Top up</span>
                              <input name="amount_naira" className="form-input h-[32px] min-h-0 w-[92px] py-1 text-xs" type="number" min="1" step="1" placeholder="NGN" required />
                            </label>
                            <label className="d-block">
                              <span className="form-label">Reason</span>
                              <input name="reason" className="form-input h-[32px] min-h-0 w-[140px] py-1 text-xs" placeholder="Reason" required />
                            </label>
                            <button type="submit" className="btn-primary py-1.5 px-2 text-[10px]">Top Up</button>
                          </form>
                          <form action={adjustWalletFormAction} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="user_id" value={wallet.user_id} />
                            <input type="hidden" name="direction" value="debit" />
                            <label className="d-block">
                              <span className="form-label">Deduct</span>
                              <input name="amount_naira" className="form-input h-[32px] min-h-0 w-[92px] py-1 text-xs" type="number" min="1" step="1" placeholder="NGN" required />
                            </label>
                            <label className="d-block">
                              <span className="form-label">Reason</span>
                              <input name="reason" className="form-input h-[32px] min-h-0 w-[140px] py-1 text-xs" placeholder="Reason" required />
                            </label>
                            <button type="submit" className="btn-outline py-1.5 px-2 text-[10px]">Deduct</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-card p-4">
          <h2 className="font-display text-xl text-foreground mb-3">Virtual Bank Accounts</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Account</th>
                  <th className="py-3 px-3">Bank</th>
                  <th className="py-3 px-3">Provider</th>
                  <th className="py-3 px-3">Provisioned</th>
                </tr>
              </thead>
              <tbody>
                {virtualAccounts.rows.length === 0 ? (
                  <tr><td className="py-5 px-3 text-foreground-muted" colSpan={4}>{virtualAccounts.error || 'No virtual accounts provisioned yet.'}</td></tr>
                ) : virtualAccounts.rows.map((account) => (
                  <tr key={account.id} className="border-t border-border">
                    <td className="py-2.5 px-3">
                      <div className="text-foreground font-semibold">{account.account_number}</div>
                      <div className="text-xs text-foreground-dim">{account.account_name}</div>
                    </td>
                    <td className="py-2.5 px-3 text-foreground-muted">{account.bank_name}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{account.provider}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{formatDate(account.provisioned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="glass-card p-4 mb-5">
        <h2 className="font-display text-xl text-foreground mb-3">Recent Ledger Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-bg-card">
              <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                <th className="py-3 px-3">Created</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Reference</th>
                <th className="py-3 px-3">Amount</th>
                <th className="py-3 px-3">Description</th>
                <th className="py-3 px-3">Account</th>
              </tr>
            </thead>
            <tbody>
              {ledgerEntries.rows.length === 0 ? (
                <tr><td className="py-5 px-3 text-foreground-muted" colSpan={6}>{ledgerEntries.error || 'No ledger entries found.'}</td></tr>
              ) : ledgerEntries.rows.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="py-2.5 px-3 text-foreground-muted">{formatDate(entry.created_at)}</td>
                  <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(entry.type)}`}>{entry.type}</span></td>
                  <td className="py-2.5 px-3 text-foreground font-semibold">{entry.reference}</td>
                  <td className="py-2.5 px-3 text-foreground-muted">{formatNaira(entry.amount_kobo)}</td>
                  <td className="py-2.5 px-3 text-foreground-muted">{entry.description || '-'}</td>
                  <td className="py-2.5 px-3 text-foreground-dim">{entry.account_id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="glass-card p-4">
          <h2 className="font-display text-xl text-foreground mb-3">Tier Policy</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Tier</th>
                  <th className="py-3 px-3">Wallet Limit</th>
                  <th className="py-3 px-3">Vote Limit</th>
                  <th className="py-3 px-3">Admin Note</th>
                </tr>
              </thead>
              <tbody>
                {([0, 1, 2, 3] as KycTier[]).map((tier) => (
                  <tr key={tier} className="border-t border-border">
                    <td className="py-2.5 px-3 text-foreground font-semibold">Tier {tier}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{TIER_WALLET_LIMIT_KOBO[tier] === null ? 'Unlimited' : formatNaira(TIER_WALLET_LIMIT_KOBO[tier])}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{TIER_VOTE_LIMIT[tier] === null ? 'Default / unlimited' : TIER_VOTE_LIMIT[tier]}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">Code-configured; DB-managed tier config is a PRD follow-up.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-card p-4">
          <h2 className="font-display text-xl text-foreground mb-3">KYC Audit Events</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Created</th>
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Transition</th>
                  <th className="py-3 px-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.rows.length === 0 ? (
                  <tr><td className="py-5 px-3 text-foreground-muted" colSpan={4}>{auditEvents.error || 'No KYC audit events yet.'}</td></tr>
                ) : auditEvents.rows.map((event) => (
                  <tr key={String(event.id)} className="border-t border-border">
                    <td className="py-2.5 px-3 text-foreground-muted">{formatDate(String(event.created_at || ''))}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{String(event.user_id || '').slice(0, 8)}</td>
                    <td className="py-2.5 px-3 text-foreground font-semibold">{String(event.old_status || '-')} → {String(event.new_status || '-')}</td>
                    <td className="py-2.5 px-3 text-foreground-muted">{String(event.note || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
