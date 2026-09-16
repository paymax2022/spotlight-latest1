/**
 * Payments & Finance admin data — a Path A console (admin consolidation; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Surfaced while auditing frontend-web/app/admin before its deletion: this
 * was a sixth orphaned module, and the one that matters most — it is the
 * ONLY admin UI anywhere in the codebase that can manually credit or debit a
 * user's wallet (frontend-admin's own Wallet Lookup page is read-only:
 * balance + transaction history, no adjustment). Unlike the other orphans
 * this isn't a dead-store bug: it already reads real Supabase tables
 * directly. What was missing is a frontend-admin console reaching it.
 *
 * Money-path: wallet credit/debit goes through frontend-web's EXISTING
 * creditWallet/debitWallet (src/server/wallet/service.ts) — already
 * idempotency-keyed, already posts balanced double-entry ledger legs via
 * ADR-040's journal helper, already tier-limit-enforced fail-closed on
 * debit. This service does not reimplement any of that; it calls the same
 * functions the original page's server actions called, over new API routes.
 *
 * Gated on 'finance:view' (read) and 'finance:adjust:initiate' (write) —
 * tighter than the original page's bare role==='admin' check. The
 * permission already existed in the codebase for exactly this (Block 9);
 * it was just never wired to this page. A plain 'admin' role does NOT
 * automatically have 'finance:adjust:initiate' — only finance_admin /
 * finance_maker do (see frontend-web/src/server/admin/rbac.ts).
 */
import { webProxyBase } from '@/config/env';

export interface WalletRow {
  account_id: string;
  user_id: string;
  account_type: string;
  currency: string;
  available_kobo: number;
  last_transaction_at: string | null;
  userName: string;
  userDetail: string;
}

export interface LedgerEntryRow {
  id: string;
  account_id: string;
  type: string;
  amount_kobo: number;
  reference: string;
  description: string | null;
  created_at: string;
}

export interface KycProfileRow {
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
}

export interface VirtualAccountRow {
  id: string;
  user_id: string;
  provider: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  currency: string;
  provisioned_at: string;
}

export interface AuditEventRow {
  id: string;
  adminUser: string;
  action: string;
  entityId?: string;
  reason?: string;
  timestamp: string;
}

export interface TierPolicyRow {
  tier: number;
  walletLimitKobo: number | null;
  voteLimit: number | null;
}

export interface PaymentsFinanceConsole {
  wallets: WalletRow[];
  ledgerEntries: { rows: LedgerEntryRow[]; error: string | null };
  kycProfiles: { rows: KycProfileRow[]; error: string | null };
  virtualAccounts: { rows: VirtualAccountRow[]; error: string | null };
  auditEvents: AuditEventRow[];
  tierPolicy: TierPolicyRow[];
  stats: {
    totalBalanceKobo: number;
    creditVolumeKobo: number;
    debitVolumeKobo: number;
    /** WAL-013: distinct wallets with >=1 ledger movement within statsWindowDays. */
    activeWalletsCount: number;
    /** WAL-013: rolling window (days) the volume + active-wallet figures are computed over. */
    statsWindowDays: number;
    pendingKyc: number;
    verifiedKyc: number;
    error?: string | null;
  };
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false, extra?: Record<string, string>): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = { ...extra };
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot manage finance. Needs the finance_admin or finance_maker role.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export function formatNaira(kobo: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format((kobo ?? 0) / 100);
}

export async function getPaymentsFinanceConsole(): Promise<PaymentsFinanceConsole> {
  const res = await fetch(`${webBase()}/api/admin/payments-finance`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading payments & finance console');
  return json as unknown as PaymentsFinanceConsole;
}

export type KycAction = 'approve' | 'reject' | 'suspend';

export async function kycAction(action: KycAction, userId: string, opts?: { tier?: number; reason?: string }): Promise<void> {
  const res = await fetch(`${webBase()}/api/admin/payments-finance/kyc`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ action, userId, ...opts }),
  });
  await readJsonOrThrow(res, 'Updating KYC status');
}

export type WalletDirection = 'credit' | 'debit';

/** Server requires a reason of at least 10 characters — see ADR-005 maker-checker. */
export const ADJUST_WALLET_MIN_REASON_LENGTH = 10;

export interface AdjustWalletResult {
  adjustmentId: string;
  /** 'executed' = money already moved. 'pending_approval' = queued for a second admin — nothing has moved yet. */
  status: 'executed' | 'pending_approval';
  requiresApproval: boolean;
  alreadyProcessed: boolean;
}

/**
 * Routes through the REAL ADR-005 maker-checker endpoint
 * (POST /api/v1/admin/adjustments — see frontend-web/src/server/admin/fintech/service.ts).
 *
 * WAL-004: this used to POST to /api/admin/payments-finance/wallet/adjust,
 * a second, unguarded wallet-mutation route that executed any amount
 * immediately with no maker-checker threshold, no approval queue, and a
 * single actor — a live-verified ₦500,000 credit went through it instantly
 * while admin_adjustments stayed at 0 rows. That route is now unused; see
 * frontend-web/app/api/admin/payments-finance/wallet/adjust/route.ts's own
 * header comment for disposition.
 *
 * Field translation for the real endpoint's contract:
 *   userId        -> target_user_id
 *   direction      -> type ('credit'->'CREDIT', 'debit'->'DEBIT')
 *   amountKobo     -> amount_kobo
 *   reason         -> reason (>= 10 chars, enforced server-side too)
 */
export async function adjustWallet(userId: string, direction: WalletDirection, amountNaira: number, reason: string): Promise<AdjustWalletResult> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < ADJUST_WALLET_MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${ADJUST_WALLET_MIN_REASON_LENGTH} characters.`);
  }
  const amountKobo = Math.round(amountNaira * 100);
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(`${webBase()}/api/v1/admin/adjustments`, {
    method: 'POST',
    headers: authHeaders(true, { 'Idempotency-Key': idempotencyKey }),
    body: JSON.stringify({
      target_user_id: userId,
      type: direction === 'credit' ? 'CREDIT' : 'DEBIT',
      amount_kobo: amountKobo,
      reason: trimmedReason,
    }),
  });
  const json = await readJsonOrThrow(res, 'Adjusting wallet');
  const adjustment = json.adjustment as {
    adjustmentId: string;
    status: 'executed' | 'pending_approval';
    requiresApproval: boolean;
    alreadyProcessed: boolean;
  };
  return {
    adjustmentId: adjustment.adjustmentId,
    status: adjustment.status,
    requiresApproval: adjustment.requiresApproval,
    alreadyProcessed: adjustment.alreadyProcessed,
  };
}

export async function backfillWallets(): Promise<number> {
  const res = await fetch(`${webBase()}/api/admin/payments-finance/wallet/backfill`, {
    method: 'POST',
    headers: authHeaders(true),
  });
  const json = await readJsonOrThrow(res, 'Backfilling wallets');
  return json.processed as number;
}
