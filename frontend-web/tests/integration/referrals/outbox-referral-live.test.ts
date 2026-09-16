/**
 * REF-001 — live-DB proof that the fixed `outbox.ts` drain path really posts a
 * ledger credit, not just that the function resolves without throwing.
 *
 * Runs against a real local Supabase/Postgres. Creates a real referrer +
 * referred user and a real `bridge_outbox` row with
 * `event_type = 'referral.triggered'`, drives it through
 * `processPendingOutboxEvents()` (the generic worker in
 * `@/src/server/voting-bridge/outbox` whose `handleReferralTriggered()` used
 * to be a dead stub), and asserts via direct SQL reads that:
 *   - `ledger_entries` now has a real ₦500 (50,000 kobo) CREDIT row for the
 *     referrer's wallet account.
 *   - `bridge_outbox` row is `status = 'done'`.
 *   - `referral_events` recorded the reward.
 * It then re-runs BOTH drain paths against the same referrer/referred pair
 * and asserts the ledger still shows exactly one credit — never two.
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { processPendingOutboxEvents } from '@/src/server/voting-bridge/outbox';
import { processReferralOutbox } from '@/src/server/referrals/service';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const STAMP = Date.now();
const REFERRER_EMAIL = `ref-referrer-${STAMP}@seed.test`;
const REFERRED_EMAIL = `ref-referred-${STAMP}@seed.test`;
const SHARE_CODE = `SPOT-${STAMP % 1_000_000}`.slice(0, 12);

let referrerId = '';
let referredId = '';
const outboxIds: string[] = [];

describe.skipIf(!live)('REF-001: referral.triggered outbox — live DB', () => {
  beforeAll(async () => {
    const { data: referrer, error: e1 } = await db().auth.admin.createUser({
      email: REFERRER_EMAIL,
      email_confirm: true,
    });
    expect(e1, e1?.message).toBeNull();
    referrerId = referrer.user!.id;

    const { data: referred, error: e2 } = await db().auth.admin.createUser({
      email: REFERRED_EMAIL,
      email_confirm: true,
    });
    expect(e2, e2?.message).toBeNull();
    referredId = referred.user!.id;

    const { error: e3 } = await db()
      .from('finance_referral_codes')
      .insert({ user_id: referrerId, code: SHARE_CODE });
    expect(e3, e3?.message).toBeNull();
  });

  afterAll(async () => {
    // Ledger entries are immutable by design (ADR-040) — leave them, but clean
    // up everything else this fixture created.
    await db().from('bridge_outbox').delete().in('id', outboxIds);
    await db().from('referral_events').delete().eq('referrer_id', referrerId);
    await db().from('finance_referral_codes').delete().eq('user_id', referrerId);
    await db().from('ledger_accounts').delete().eq('user_id', referrerId);
    await db().auth.admin.deleteUser(referrerId).catch(() => {});
    await db().auth.admin.deleteUser(referredId).catch(() => {});
  });

  it('processPendingOutboxEvents() posts a real ledger credit and marks the row done', async () => {
    const { data: row, error } = await db()
      .from('bridge_outbox')
      .insert({
        event_type: 'referral.triggered',
        payload: { shareCode: SHARE_CODE, voterId: referredId, contestantId: 'contestant-live-1' },
        status: 'pending',
      })
      .select('id')
      .single();
    expect(error, error?.message).toBeNull();
    outboxIds.push(row!.id);

    const processedCount = await processPendingOutboxEvents();
    expect(processedCount).toBeGreaterThanOrEqual(1);

    // bridge_outbox row is done
    const { data: outboxRow } = await db()
      .from('bridge_outbox')
      .select('status, processed_at')
      .eq('id', row!.id)
      .single();
    expect(outboxRow?.status).toBe('done');
    expect(outboxRow?.processed_at).toBeTruthy();

    // referral_events recorded the reward
    const { data: eventRow } = await db()
      .from('referral_events')
      .select('referrer_id, referred_id, amount_kobo')
      .eq('referrer_id', referrerId)
      .eq('referred_id', referredId)
      .maybeSingle();
    expect(eventRow).toBeTruthy();
    expect(Number(eventRow!.amount_kobo)).toBe(50_000);

    // Real ledger credit — the actual proof, not just "no exception thrown"
    const { data: account } = await db()
      .from('ledger_accounts')
      .select('id')
      .eq('user_id', referrerId)
      .eq('type', 'user_wallet')
      .maybeSingle();
    expect(account, 'wallet account should have been created for the referrer').toBeTruthy();

    const { data: entries } = await db()
      .from('ledger_entries')
      .select('type, amount_kobo, idempotency_key')
      .eq('account_id', account!.id)
      .eq('type', 'CREDIT');

    expect(entries?.length).toBe(1);
    expect(Number(entries![0].amount_kobo)).toBe(50_000);
    expect(entries![0].idempotency_key).toBe(`referral-reward:${referrerId}:${referredId}`);
  });

  it('re-draining via BOTH paths for the same pair never double-credits', async () => {
    // Second outbox row for the SAME referrer/referred pair — simulates a
    // duplicate enqueue or a race between the two drain paths.
    const { data: row2, error } = await db()
      .from('bridge_outbox')
      .insert({
        event_type: 'referral.triggered',
        payload: { shareCode: SHARE_CODE, voterId: referredId, contestantId: 'contestant-live-2' },
        status: 'pending',
      })
      .select('id')
      .single();
    expect(error, error?.message).toBeNull();
    outboxIds.push(row2!.id);

    // Drain via the generic worker...
    await processPendingOutboxEvents();
    // ...and via the dedicated referral drain, in case anything is still pending.
    await processReferralOutbox();

    const { data: account } = await db()
      .from('ledger_accounts')
      .select('id')
      .eq('user_id', referrerId)
      .eq('type', 'user_wallet')
      .maybeSingle();

    const { data: entries } = await db()
      .from('ledger_entries')
      .select('id')
      .eq('account_id', account!.id)
      .eq('type', 'CREDIT');

    // Still exactly one credit — the second outbox row for the same pair was
    // marked done (skipped/alreadyRewarded) but did NOT post a second credit.
    expect(entries?.length).toBe(1);

    const { data: row2After } = await db()
      .from('bridge_outbox')
      .select('status')
      .eq('id', row2!.id)
      .single();
    expect(row2After?.status).toBe('done');
  });
});
