import { adminApiBase, authHeaders, readOrThrow } from './usersService';

/**
 * Who referred this user. Backend: GET /api/finance/admin/referrals/:id/referred-by
 * (RBAC referral.admin.case). Every user is meant to have a referrer: a real person
 * when they signed up with a code, otherwise the house (Admin) account. A user with no
 * attribution row comes back with attributed=false, and a background sweep connects
 * them to the house account shortly after.
 */
export type ReferredBy = {
  user_id: string;
  attributed: boolean;
  is_house: boolean;
  attribution_id?: string;
  attribution_type?: string;
  status?: string;
  code_used?: string;
  attributed_at?: string;
  referrer_id?: string;
  referrer_name?: string;
  referrer_email?: string;
  referrer_code?: string;
  house_account_id?: string;
  house_code?: string;
  house_owner_id?: string;
  house_owner_name?: string;
};

export async function getUserReferredBy(id: string): Promise<ReferredBy> {
  const res = await fetch(`${adminApiBase()}/finance/admin/referrals/${encodeURIComponent(id)}/referred-by`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const p = await readOrThrow(res, 'Loading referrer');
  return {
    ...(p as unknown as ReferredBy),
    user_id: String(p.user_id ?? id),
    attributed: p.attributed === true,
    is_house: p.is_house === true,
  };
}

/** One-line description of the referrer for the profile. */
export function describeReferrer(rb: ReferredBy): { title: string; detail: string | null } {
  if (!rb.attributed) {
    return {
      title: 'Not attributed yet',
      detail: 'This user will be connected to the Admin (house) account automatically.',
    };
  }
  if (rb.is_house) {
    const owner = rb.house_owner_name ? ` · ${rb.house_owner_name}` : '';
    return {
      title: 'Admin (house account)',
      detail: `${rb.house_code ?? 'house'}${owner} · no referral code was used`,
    };
  }
  const who = rb.referrer_name || rb.referrer_email || rb.referrer_id || 'Unknown user';
  const code = rb.referrer_code ? ` · code ${rb.referrer_code}` : '';
  return { title: who, detail: `${rb.code_used ? `entered ${rb.code_used}` : (rb.attribution_type ?? 'referral')}${code}` };
}
