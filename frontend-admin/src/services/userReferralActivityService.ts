import { AdminUsersRequestError, adminApiBase, authHeaders, readOrThrow } from './usersService';

/** Read-only referral data for the admin user profile. */

export type ReferralCode = { code: string; source: string };

export type Referral360 = {
  referrer_id: string | null;
  referred_count: number;
  total_earned_kobo: number;
  paid_kobo: number;
  clawed_back_kobo: number;
  fraud_standing: string;
};

export type ReferralLedgerEntry = {
  id: string;
  beneficiary_id?: string;
  house_account_id?: string;
  referred_user_id?: string;
  kind: string;
  state: string;
  amount_kobo: number;
  currency: string;
  is_house: boolean;
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The user's OWN referral code. GET /api/finance/admin/referrals/:id/code (referral.admin.case). 404 -> null. */
export async function getUserReferralCode(id: string): Promise<ReferralCode | null> {
  const res = await fetch(`${adminApiBase()}/finance/admin/referrals/${encodeURIComponent(id)}/code`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  const p = await readOrThrow(res, 'Loading referral code');
  const code = typeof p.code === 'string' ? p.code.trim() : '';
  if (!code) return null;
  return { code, source: String(p.source ?? '') };
}

/** GET /api/referral/admin/users/:id/referral-360 (referral.users.view); payload is {user: {...}}. */
export async function getReferral360(id: string): Promise<Referral360> {
  const res = await fetch(`${adminApiBase()}/referral/admin/users/${encodeURIComponent(id)}/referral-360`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const p = await readOrThrow(res, 'Loading referral summary');
  const u = (p.user && typeof p.user === 'object' ? p.user : {}) as Record<string, unknown>;
  return {
    referrer_id: typeof u.referrer_id === 'string' && u.referrer_id ? u.referrer_id : null,
    referred_count: num(u.referred_count),
    total_earned_kobo: num(u.total_earned_kobo),
    paid_kobo: num(u.paid_kobo),
    clawed_back_kobo: num(u.clawed_back_kobo),
    fraud_standing: String(u.fraud_standing ?? ''),
  };
}

/** GET /api/referral/admin/ledger?beneficiary=<id> (referral.ledger.view; backend caps at 200). */
export async function getReferralLedger(id: string): Promise<ReferralLedgerEntry[]> {
  const res = await fetch(`${adminApiBase()}/referral/admin/ledger?beneficiary=${encodeURIComponent(id)}`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const p = await readOrThrow(res, 'Loading referral ledger');
  return Array.isArray(p.entries) ? (p.entries as ReferralLedgerEntry[]) : [];
}

export { AdminUsersRequestError };
