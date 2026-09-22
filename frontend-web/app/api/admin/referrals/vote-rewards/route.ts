import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * REF-007 — admin visibility for System C, the flat ₦500 vote-triggered
 * referral reward (frontend-web/src/server/referrals/{service,attribution}.ts,
 * audited via `referral_events`). Unlike System A
 * (backend/internal/referral/*, console at frontend-admin/app/admin/referral)
 * and System B (backend/internal/finance/referrals/*, console at
 * frontend-admin/app/admin/referral-rewards), System C had NO admin surface
 * anywhere — confirmed by grepping frontend-admin/app and frontend-web/app
 * for `finance_referral_codes` / `referral_events` outside the service file.
 *
 * Deliberately read-only: System C's crediting is fully automatic (at-most-
 * once via referral_events' UNIQUE(referrer_id,referred_id) and
 * UNIQUE(idempotency_key) constraints) — there is no maker-checker to expose
 * because there is no maker step. Building one is out of scope for a
 * visibility fix.
 *
 * Mirrors frontend-web/app/api/admin/payments-finance/route.ts's conventions:
 * assertAdminPermission(request, 'finance:view'), createAdminClient(), and a
 * manual user_profiles join-by-map (referral_events only stores bare
 * referrer_id/referred_id UUIDs — no FK-joinable view exists).
 *
 * WAL-013 lesson applied up front: the `stats` aggregate is computed over an
 * UNBOUNDED query with the same filters as the page, never by summing the
 * capped/paginated row list — see aggQuery below.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type DbRow = Record<string, unknown>;

interface ReferralEventRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  idempotency_key: string;
  amount_kobo: number;
  ledger_entry_id: string | null;
  rewarded_at: string;
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'finance:view');

    const url = new URL(request.url);
    const fromParam = url.searchParams.get('from'); // ISO date/datetime, inclusive
    const toParam = url.searchParams.get('to'); // ISO date/datetime, inclusive
    const referrerId = url.searchParams.get('referrerId');

    const limitParam = Number(url.searchParams.get('limit'));
    const offsetParam = Number(url.searchParams.get('offset'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

    const supabase = createAdminClient();

    // `any` here mirrors payments-finance/route.ts's own queryRows filter
    // signature — the Supabase query builder's fluent type is not worth
    // chaining through a helper.
    const applyFilters = (query: any) => {
      let q = query;
      if (fromParam) q = q.gte('rewarded_at', fromParam);
      if (toParam) q = q.lte('rewarded_at', toParam);
      if (referrerId) q = q.eq('referrer_id', referrerId);
      return q;
    };

    const pageQuery = applyFilters(
      supabase
        .from('referral_events')
        .select('id,referrer_id,referred_id,idempotency_key,amount_kobo,ledger_entry_id,rewarded_at', { count: 'exact' })
        .order('rewarded_at', { ascending: false }),
    ).range(offset, offset + limit - 1);

    // Unbounded aggregate query — same filters as the page, minimal columns,
    // no range/limit. This is what `stats` below is computed from.
    const aggQuery = applyFilters(
      supabase.from('referral_events').select('amount_kobo,referrer_id'),
    );

    const [{ data: pageData, error: pageError, count }, { data: aggData, error: aggError }] = await Promise.all([
      pageQuery,
      aggQuery,
    ]);

    if (pageError) throw new Error(pageError.message);

    const rows = (pageData ?? []) as unknown as ReferralEventRow[];
    const aggRows = (aggData ?? []) as unknown as Array<{ amount_kobo: number; referrer_id: string }>;

    // Manual join-by-map for display names/emails — same pattern as
    // payments-finance/route.ts's profileById lookup.
    const userIds = Array.from(new Set(rows.flatMap((r) => [r.referrer_id, r.referred_id])));
    let profileById = new Map<string, { full_name?: string; email?: string }>();
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id,full_name,email')
        .in('id', userIds);
      profileById = new Map(
        ((profiles ?? []) as DbRow[]).map((p) => [p.id as string, p as { full_name?: string; email?: string }]),
      );
    }

    const events = rows.map((r) => {
      const referrer = profileById.get(r.referrer_id);
      const referred = profileById.get(r.referred_id);
      return {
        id: r.id,
        referrerId: r.referrer_id,
        referrerName: referrer?.full_name || referrer?.email || r.referrer_id,
        referrerEmail: referrer?.email || null,
        referredId: r.referred_id,
        referredName: referred?.full_name || referred?.email || r.referred_id,
        referredEmail: referred?.email || null,
        amountKobo: Number(r.amount_kobo),
        ledgerEntryId: r.ledger_entry_id,
        rewardedAt: r.rewarded_at,
        idempotencyKey: r.idempotency_key,
      };
    });

    const totalRewardsKobo = aggRows.reduce((sum, r) => sum + Number(r.amount_kobo), 0);
    const distinctReferrersRewarded = new Set(aggRows.map((r) => r.referrer_id)).size;

    return successResponse({
      events,
      meta: {
        total: count ?? aggRows.length,
        limit,
        offset,
      },
      stats: {
        totalRewardsKobo,
        distinctReferrersRewarded,
        eventCount: aggRows.length,
        error: aggError?.message ?? null,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load vote-triggered referral rewards');
  }
}
