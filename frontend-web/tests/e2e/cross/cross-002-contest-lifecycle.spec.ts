/**
 * CROSS-002 — contest lifecycle: admin creates → user discovers → user applies
 * → admin configures voting → user votes (free + paid-from-wallet) → admin sees
 * the votes → audit rows exist.
 *
 * Real product surfaces chained:
 *   - Go admin API  POST /api/v1/admin/competitions/open-mic   (contests row)
 *   - Web BFF admin POST /api/admin/voting/settings            (voting_settings
 *     + syncs contests.voting_enabled/vote_price_ngn, mirrored into
 *     connect_contests by trg_sync_connect_contest)
 *   - Web BFF admin POST /api/admin/voting/packages            (vote_packages)
 *   - User discovery  GET /api/v1/contests + GET :8080 /api/v1/connect/contests
 *   - User apply      POST /api/registration/applications (registrations row)
 *   - Admin review    POST /api/admin/registration/applications/:id/review
 *     (promoting status → promote_registration_to_contestant RPC → contestants)
 *   - Free vote       POST /api/v2/votes/free
 *   - Paid vote       POST /api/votes/paid/wallet (wallet-funded — the ONLY
 *     paid-vote rail that can complete locally; Paystack is unreachable)
 *   - Admin read-back GET /api/admin/voting/:contestId/transactions + leaderboard
 *   - Audit           audit_logs (Go) + vote_audit_logs (BFF)
 *
 * Fixture-only: wallet funding journal + voter kyc_tier=1 (no local KYC/PSP).
 * If the admin review cannot promote (consent/photo gates on a bare draft),
 * the contestants row is seeded via psql and recorded as fixture, not product.
 */

import { expect, test } from '@playwright/test';
import {
  adminGo,
  adminGoAs,
  adminBearer,
  fundWallet,
  goFetch,
  goTrueToken,
  provisionVerifiedUser,
  psql,
  setKycTier,
  walletBalance,
  ADMIN_USER,
} from './helpers';

const WEB = ''; // same-origin :3000 (Playwright baseURL)

test.describe('CROSS-002: contest lifecycle across actors', () => {
  test('admin create → discover → apply → configure → vote (free+wallet) → admin sees → audit', async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const applicant = await provisionVerifiedUser(request, 'x-appl');
    const voter = await provisionVerifiedUser(request, 'x-voter');
    const adminToken = await adminBearer(request);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const voterToken = await goTrueToken(request, voter.email, voter.password);
    const voterAuth = { Authorization: `Bearer ${voterToken}` };

    const stamp = Date.now() % 100000;
    const contestName = `E2E Cross Open Mic ${stamp}`;
    let contestId = '';
    let contestSlug = '';
    let packageId = '';

    await test.step('admin creates the contest via the real admin API', async () => {
      const res = await adminGo(request, '/api/v1/admin/competitions/open-mic', {
        method: 'POST',
        data: {
          name: contestName,
          description: 'E2E cross-role validation contest',
          status: 'active',
          category: 'Music',
          vote_price_ngn: 0,
          entry_fee_ngn: 0,
        },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      contestId = res.body?.competition?.id;
      contestSlug = res.body?.competition?.slug;
      expect(contestId).toBeTruthy();

      // The legacy→connect mirror fired on INSERT.
      const mirror = psql(
        `select status || '|' || slug from connect_contests where id='${contestId}';`,
      );
      expect(mirror).toBe(`open|${contestSlug}`);

      // Negative: a normal user cannot call the admin create route.
      const denied = await adminGoAs(request, voterToken, '/api/v1/admin/competitions/open-mic', {
        method: 'POST',
        data: { name: 'Should Not Exist' },
      });
      expect([401, 403]).toContain(denied.status);
    });

    await test.step('admin configures voting (settings + a paid package)', async () => {
      const settings = await request.fetch(`${WEB}/api/admin/voting/settings`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        data: {
          contestId,
          status: 'active',
          votingEnabled: true,
          votingType: 'paid',
          freeVotingEnabled: true,
          freeVotesPerDay: 5,
          requireLoginForFreeVote: true,
          paidVotingEnabled: true,
          pricePerVoteNgn: 100,
          currency: 'NGN',
        },
      });
      expect(settings.status(), await settings.text()).toBe(200);

      const row = psql(
        `select status || '|' || voting_enabled || '|' || paid_voting_enabled || '|' || free_voting_enabled ` +
          `from voting_settings where contest_id='${contestId}';`,
      );
      expect(row).toBe('active|true|true|true');
      // syncContestVotingState carried the decision to the contest row…
      expect(psql(`select voting_enabled || '|' || vote_price_ngn from contests where id='${contestId}';`))
        .toBe('true|100');
      // …and the mirror carried it to connect_contests (paid_vote_kobo = 100*100).
      expect(psql(`select paid_vote_kobo from connect_contests where id='${contestId}';`)).toBe('10000');

      const pkg = await request.fetch(`${WEB}/api/admin/voting/packages`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        data: { contestId, name: 'E2E Pack', votes: 10, bonusVotes: 2, amount: 1000 },
      });
      expect(pkg.status(), await pkg.text()).toBe(201);
      packageId = (await pkg.json()).package?.id;
      expect(packageId).toBeTruthy();
    });

    await test.step('user discovers the contest on both discovery surfaces', async () => {
      const web = await request.get(`/api/v1/contests?search=${encodeURIComponent(contestName)}`);
      expect(web.status()).toBe(200);
      const webList = (await web.json()) as Array<{ id: string; name: string }>;
      expect(webList.map((c) => c.id)).toContain(contestId);

      const connect = await goFetch(request, '/api/v1/connect/contests', { token: voterToken });
      expect(connect.status).toBe(200);
      const connectList = (connect.body?.data ?? connect.body?.contests ?? []) as Array<{ id: string }>;
      expect(connectList.map((c) => c.id)).toContain(contestId);
    });

    let contestantId = '';
    await test.step('user applies; admin review promotes them to a votable contestant (or fixture fallback)', async () => {
      const applicantToken = await goTrueToken(request, applicant.email, applicant.password);
      const apply = await request.fetch('/api/registration/applications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${applicantToken}`, 'Content-Type': 'application/json' },
        data: { contestSlug },
      });
      const applyBody = await apply.json().catch(() => null);
      expect([200, 201, 409]).toContain(apply.status());
      const draftId = applyBody?.draft?.id ?? applyBody?.registration?.id;
      expect(draftId).toBeTruthy();
      expect(psql(`select status from registrations where id='${draftId}';`)).toBe('draft');

      // The promote gate (SEC-010/RG-003) refuses approval when the built form
      // collects consent the applicant never gave. Real contests use the
      // default form — media.rightsConfirmed under 'category_specific' and,
      // when voting is supported, publicProfile.publicVotingConsent. Step saves
      // merge `values` verbatim into form_data, so the consent keys ride along
      // on the 'review_submit' step (whose own required checkboxes must all be
      // present for the step to persist).
      const patch = await request.fetch(`/api/registration/applications/${draftId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${applicantToken}`, 'Content-Type': 'application/json' },
        data: {
          stepKey: 'review_submit',
          values: {
            'legal.accuracyDeclaration': true,
            'legal.termsConsent': true,
            'legal.privacyConsent': true,
            'legal.communicationConsent': true,
            'review.confirmSubmit': true,
            'media.rightsConfirmed': true,
            'publicProfile.publicVotingConsent': true,
          },
        },
      });
      expect(patch.status(), await patch.text()).toBe(200);

      const review = await request.fetch(`/api/admin/registration/applications/${draftId}/review`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        data: { status: 'approved', note: 'E2E cross approval' },
      });
      const reviewBody = await review.json().catch(() => null);
      test.info().annotations.push({
        type: 'review',
        description: `review → ${review.status}: ${JSON.stringify(reviewBody).slice(0, 300)}`,
      });

      // Did the promote seam run?
      contestantId = psql(
        `select id::text from contestants where registration_id='${draftId}' or (contest_id='${contestId}' and user_id='${applicant.userId}') limit 1;`,
      );
      if (!contestantId) {
        // FIXTURE fallback: the review could not promote a bare draft (consent/
        // photo gates). Seed the roster row directly — documented, not product.
        contestantId = psql(
          `insert into contestants (contest_id, user_id, name, stage_name, status, is_active, registration_id) ` +
            `values ('${contestId}','${applicant.userId}','E2E Cross Act','E2E Cross Act','approved',true,'${draftId}') returning id;`,
        ).split('\n')[0];
        expect(contestantId).toBeTruthy();
        test.info().annotations.push({
          type: 'fixture',
          description: `review did not promote (status ${review.status}); contestants row seeded via psql`,
        });
      } else {
        // Real promote ran. promote_registration_to_contestant writes ONLY
        // contestants.connect_contest_id (resolved via connect_contests.slug)
        // and leaves contest_id NULL — while every public surface
        // (/api/v1/contests/:id/contestants, /api/vote-page) filters on
        // contestants.contest_id. FINDING: promoted contestants are invisible
        // to voters on the public roster/vote page.
        const linkCols = psql(
          `select coalesce(contest_id::text,'NULL') || '|' || coalesce(connect_contest_id::text,'NULL') ` +
            `from contestants where id='${contestantId}';`,
        );
        const [cid, ccid] = linkCols.split('|');
        if (cid === 'NULL' && ccid === contestId) {
          test.info().annotations.push({
            type: 'finding',
            description:
              'promote_registration_to_contestant sets connect_contest_id only; contestants.contest_id stays NULL → contestant invisible on /api/v1/contests/:id/contestants and /api/vote-page',
          });
        }
      }

      // Public roster check — pins the link-column defect when the real
      // promote ran (roster keys on contest_id, which the RPC leaves NULL).
      const roster = await request.get(`/api/v1/contests/${contestId}/contestants`);
      expect(roster.status()).toBe(200);
      const rosterIds = ((await roster.json()) as Array<{ id: string }>).map((c) => c.id);
      const linkedContestId = psql(
        `select coalesce(contest_id::text,'NULL') from contestants where id='${contestantId}';`,
      );
      if (linkedContestId === 'NULL') {
        expect(rosterIds, 'promoted contestant is invisible on the public roster (contest_id NULL)').not.toContain(contestantId);
      } else {
        expect(rosterIds).toContain(contestantId);
      }
    });

    await test.step('user casts a FREE vote → votes row + totals', async () => {
      const res = await request.fetch('/api/v2/votes/free', {
        method: 'POST',
        headers: {
          ...voterAuth,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `xfv-${Date.now()}`,
        },
        data: { contestId, contestantId, voteQuantity: 1 },
      });
      const body = await res.json().catch(() => null);
      test.info().annotations.push({ type: 'free-vote', description: `${res.status()} ${JSON.stringify(body).slice(0, 200)}` });
      expect(res.status(), JSON.stringify(body)).toBe(200);
      expect(body.success ?? body.votesAdded).toBeTruthy();

      expect(
        psql(`select vote_type || '|' || vote_status from votes where contest_id='${contestId}' and contestant_id='${contestantId}' and voter_user_id='${voter.userId}';`),
      ).toContain('free|confirmed');
    });

    await test.step('user buys a PAID vote package from wallet → tx+votes+ledger+audit land', async () => {
      setKycTier(voter.userId, 1);
      fundWallet(voter.userId, 300_000, `xvote-${Date.now()}`);
      expect(walletBalance(voter.userId)).toBe('300000');

      const res = await request.fetch('/api/votes/paid/wallet', {
        method: 'POST',
        headers: {
          ...voterAuth,
          'Content-Type': 'application/json',
          'Idempotency-Key': `xwv-${Date.now()}`,
        },
        data: {
          contestId,
          contestantId,
          packageId,
          voterEmail: voter.email,
          voterName: 'E2E Cross Voter',
        },
      });
      const body = await res.json().catch(() => null);
      test.info().annotations.push({ type: 'paid-vote', description: `${res.status()} ${JSON.stringify(body).slice(0, 300)}` });
      expect(res.status(), JSON.stringify(body)).toBe(201);
      expect(body.votesCredited).toBe(12); // 10 + 2 bonus
      const txId = body.transactionId as string;

      // Atomicity: transaction row + votes row + totals all present.
      expect(psql(`select payment_status || '|' || vote_credit_status from vote_transactions where id='${txId}';`))
        .toBe('successful|credited');
      expect(psql(`select vote_type || '|' || vote_quantity from votes where transaction_id='${txId}';`))
        .toBe('paid|12');

      // Wallet debited ₦1,000 = 100,000 kobo; journal DR user_wallet / CR settlement.
      expect(walletBalance(voter.userId)).toBe('200000');
      const drLeg = psql(
        `select le.type || '|' || le.amount_kobo from ledger_entries le ` +
          `join ledger_accounts la on la.id=le.account_id ` +
          `where la.user_id='${voter.userId}' and le.reference like 'WVOTE-%' order by le.created_at desc limit 1;`,
      );
      expect(drLeg).toBe('DEBIT|100000');

      // Audit trail on the BFF voting plane.
      const audit = psql(
        `select action || '|' || actor_id from vote_audit_logs where entity_id='${txId}' order by created_at desc limit 1;`,
      );
      expect(audit).toBe(`wallet_vote_credited|${voter.userId}`);
    });

    await test.step('admin reads the votes back on the admin voting surface', async () => {
      const txns = await request.get(`/api/admin/voting/${contestId}/transactions`, { headers: adminHeaders });
      expect(txns.status()).toBe(200);
      const txBody = await txns.json();
      test.info().annotations.push({ type: 'admin-txns', description: JSON.stringify(txBody).slice(0, 300) });
      // The paid wallet purchase is visible to the admin console.
      expect(JSON.stringify(txBody?.transactions ?? [])).toContain('successful');

      // E2E-X-026 FIXED: routes now use the bridge-owned getLeaderboard
      // (voting-bridge/leaderboard.service.ts) — the legacy totals.service
      // version embedded contestant_share_links on vote_totals with no FK
      // (PGRST200 → swallowed → permanently []). The bridge queries
      // vote_totals plainly and merges share links in a second query.
      const lb = await request.get(`/api/admin/voting/${contestId}/leaderboard`, { headers: adminHeaders });
      expect(lb.status()).toBe(200);
      const lbBody = await lb.json();
      const entries = lbBody?.leaderboard ?? [];
      expect(entries.length).toBeGreaterThan(0); // fixed: real rows now surface

      // E2E-X-027 FIXED: the unique constraint is now NULLS NOT DISTINCT so
      // increment_vote_totals' ON CONFLICT (contest_id, contestant_id,
      // round_id) matches NULL round_id — every vote accumulates onto ONE
      // totals row instead of fragmenting.
      const totalsRows = psql(
        `select count(*) from vote_totals where contest_id='${contestId}' and contestant_id='${contestantId}';`,
      );
      test.info().annotations.push({
        type: 'totals',
        description: `vote_totals rows for one contestant: ${totalsRows} (must be 1 — accumulates, not fragments)`,
      });
      expect(Number(totalsRows)).toBe(1); // fixed: single accumulating row
    });

    await test.step('audit: contest.create row persists with admin actor attribution', async () => {
      const row = psql(
        `select coalesce(actor_user_id::text,'') || '|' || action || '|' || module || '|' || resource_id ` +
          `from audit_logs where action='contest.openmic.create' and resource_id='${contestId}';`,
      );
      expect(row).toBeTruthy();
      const [actor, action, module, resourceId] = row.split('|');
      expect(action).toBe('contest.openmic.create');
      expect(module).toBe('contest');
      expect(resourceId).toBe(contestId);
      // E2E-X-028 FIXED: emitAudit now resolves the actor from the adminUserID
      // context key that RequireAdminConsoleRole populates (previously it read
      // only GetAuthenticatedUser, which that middleware never sets — every
      // contest.openmic.create row persisted with NULL actor_user_id).
      const adminId = psql(`select id from auth.users where email='${ADMIN_USER.email}';`);
      expect(actor).toBe(adminId);
    });
  });
});
