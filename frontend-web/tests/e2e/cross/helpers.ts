/**
 * Shared helpers for the CROSS-ROLE E2E validation specs.
 *
 * Cross specs chain the proven single-role surfaces into multi-actor flows:
 * user → provider/rider/admin → system (ledger/audit). Fixture-only mutations
 * (never product state): wallet funding posts the same balanced journal the
 * top-up webhook posts; kyc_tier/phone/driver rows are seeded because the
 * local stack has no KYC provider and no driver-onboarding surface on web.
 *
 * Auth: provisioned users get a GoTrue access token (goTrueToken) — accepted by
 * BOTH the Go :8080 routes (RequireAuthContext) and the web BFF :3000 routes
 * (requireRequestUser). Admin actions use the admin fixture's token; the
 * /api/v1/admin/* group additionally requires x-admin-api-key.
 */

import type { APIRequestContext } from '@playwright/test';

import {
  ADMIN_API_KEY,
  ADMIN_WEB_URL,
  GO_BACKEND_URL,
  provisionVerifiedUser,
  psql,
  uniqueEmail,
  type ProvisionedUser,
} from '../auth/helpers';
import {
  ADMIN_USER,
  createRestaurant,
  fundWallet,
  goFetch,
  goTrueToken,
  walletBalance,
} from '../provider/helpers';

export {
  ADMIN_API_KEY,
  ADMIN_USER,
  ADMIN_WEB_URL,
  GO_BACKEND_URL,
  createRestaurant,
  fundWallet,
  goFetch,
  goTrueToken,
  provisionVerifiedUser,
  psql,
  uniqueEmail,
  walletBalance,
  type ProvisionedUser,
};

/** Mint an admin Bearer via GoTrue (same token admin-proxy attaches upstream). */
export async function adminBearer(request: APIRequestContext): Promise<string> {
  return goTrueToken(request, ADMIN_USER.email, ADMIN_USER.password);
}

/**
 * Call a Go :8080 route with admin Bearer + x-admin-api-key — the two-gate
 * chain (RequireAdmin + RequireAdminConsoleRole) the admin-proxy reproduces.
 */
export async function adminGo(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; data?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const token = await adminBearer(request);
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-admin-api-key': ADMIN_API_KEY,
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** Same, for a NON-admin caller (negative probes keep the key attached — the
 * role gate is the interesting layer). */
export async function adminGoAs(
  request: APIRequestContext,
  token: string,
  path: string,
  opts: { method?: string; data?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-admin-api-key': ADMIN_API_KEY,
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

// ── Fixture setup (documented; never used to move product state) ─────────────

/** Give a user a KYC tier (wallet debit/transfers are Tier-0-gated, no local KYC provider). */
export function setKycTier(userId: string, tier: number): void {
  psql(`update public.user_profiles set kyc_tier=${tier} where id='${userId}';`);
}

/** Set user_profiles.phone — the P2P recipient resolver matches the 10-digit NSN. */
export function setProfilePhone(userId: string, phone: string): void {
  psql(`update public.user_profiles set phone='${phone}' where id='${userId}';`);
}

/**
 * Register a provisioned user as an online, approved rider in the shared
 * transport `drivers` pool — the pool restaurant dispatch sources from.
 * There is no web driver-onboarding surface, so this is a fixture row.
 */
export function seedDriver(userId: string, name: string): void {
  psql(
    `insert into public.drivers (user_id, name, vehicle_reg, vehicle_type, status, verification_status, phone) ` +
      `values ('${userId}','${name}','E2E-${userId.slice(0, 8)}','bike','online','approved','+2348000000000') ` +
      `on conflict (user_id) do update set status='online', verification_status='approved';`,
  );
}

// ── Ledger assertions ────────────────────────────────────────────────────────

export interface LedgerLeg {
  accountType: string;
  accountUserId: string; // '' for standing accounts
  side: 'DEBIT' | 'CREDIT';
  total: number;
}

/** Sum ledger_entries by account type + owner + side for a reference pattern (SQL LIKE). */
export function ledgerSums(referenceLike: string): LedgerLeg[] {
  const out = psql(
    `select la.type || '|' || coalesce(la.user_id::text,'') || '|' || le.type || '|' || sum(le.amount_kobo) ` +
      `from ledger_entries le join ledger_accounts la on la.id = le.account_id ` +
      `where le.reference like '${referenceLike}' group by la.type, la.user_id, le.type ` +
      `order by la.type, la.user_id, le.type;`,
  );
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [accountType, accountUserId, side, total] = line.split('|');
      return { accountType, accountUserId, side: side as 'DEBIT' | 'CREDIT', total: Number(total) };
    });
}

/** Net balance of a standing account type (escrow, provider_clearing, …). */
export function standingAccountBalance(type: string): number {
  const out = psql(
    `select coalesce(sum(case when le.type='CREDIT' then le.amount_kobo else -le.amount_kobo end),0) ` +
      `from ledger_entries le join ledger_accounts la on la.id=le.account_id ` +
      `where la.type='${type}' and la.user_id is null;`,
  );
  return Number(out || 0);
}

// ── Contest fixture (admin API for the contest/settings/packages rows; the
// contestants roster row is seeded via psql because a bare registration draft
// cannot satisfy the promote gate without consent/media steps) ────────────────

export interface VotableContest {
  contestId: string;
  slug: string;
  contestantId: string;
  packageId: string;
}

/**
 * Spin up a live, votable contest through the real admin surfaces:
 *   Go POST /api/v1/admin/competitions/open-mic  → contests (+ connect mirror)
 *   BFF POST /api/admin/voting/settings          → active paid+free voting
 *   BFF POST /api/admin/voting/packages          → one active package
 *   psql insert into contestants                 → fixture roster row
 * Requires the voter-side userId only to attribute the contestant to a real
 * provisioned account.
 */
export async function setupVotableContest(
  request: APIRequestContext,
  contestantUserId: string,
  tag: string,
): Promise<VotableContest> {
  const name = `E2E ${tag} ${Date.now() % 100000}`;
  const created = await adminGo(request, '/api/v1/admin/competitions/open-mic', {
    method: 'POST',
    data: { name, description: 'E2E cross spec', status: 'active', category: 'Music', vote_price_ngn: 0, entry_fee_ngn: 0 },
  });
  if (created.status !== 201) {
    throw new Error(`open-mic create failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const contestId = created.body?.competition?.id as string;
  const slug = created.body?.competition?.slug as string;

  const token = await adminBearer(request);
  const settings = await request.fetch('/api/admin/voting/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      contestId,
      status: 'active',
      votingEnabled: true,
      votingType: 'paid',
      freeVotingEnabled: true,
      freeVotesPerDay: 10,
      requireLoginForFreeVote: true,
      paidVotingEnabled: true,
      pricePerVoteNgn: 100,
      currency: 'NGN',
    },
  });
  if (settings.status() !== 200) {
    throw new Error(`voting settings failed: ${settings.status()} ${await settings.text()}`);
  }

  const pkg = await request.fetch('/api/admin/voting/packages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { contestId, name: 'E2E Pack', votes: 10, bonusVotes: 2, amount: 1000 },
  });
  if (pkg.status() !== 201) {
    throw new Error(`vote package failed: ${pkg.status()} ${await pkg.text()}`);
  }
  const packageId = ((await pkg.json()) as { package?: { id: string } }).package?.id as string;

  const contestantId = psql(
    `insert into contestants (contest_id, user_id, name, stage_name, status, is_active) ` +
      `values ('${contestId}','${contestantUserId}','E2E Act ${tag}','E2E Act ${tag}','approved',true) returning id;`,
  ).split('\n')[0]; // INSERT…RETURNING also prints the command tag
  if (!contestantId) throw new Error('contestant fixture insert failed');

  return { contestId, slug, contestantId, packageId };
}
