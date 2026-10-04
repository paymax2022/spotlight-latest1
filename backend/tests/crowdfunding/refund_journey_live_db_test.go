package crowdfunding_test

// LIVE-DB regression for the refund journey end-to-end: member request →
// admin queue → money path. Two bugs left backers no working refund — the
// member endpoint wrote cf_refund_requests while ops read cf_refunds, and
// instant-settled contributions weren't refundable. These pin the real path
// through creator.RequestRefund and adminext.DecideRefund (escrow + clawback
// branches + the legacy demo table). Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crowdfunding/adminext"
	"spotlight/backend/internal/crowdfunding/creator"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

// findRefund locates the queue row belonging to one contribution by campaign
// title — the RefundRequest DTO deliberately exposes no raw contribution id.
func findRefund(t *testing.T, items []adminext.RefundRequest, campaignTitle string) *adminext.RefundRequest {
	t.Helper()
	for i := range items {
		if items[i].CampaignTitle == campaignTitle {
			return &items[i]
		}
	}
	return nil
}

// TestLiveDB_RefundJourney_MemberRequestToAdminPayout is the headline
// regression: contribute → member refund-request → admin queue shows the row
// → admin approves → money is BACK IN THE BACKER'S WALLET, proven by balanced
// ledger legs and every row reaching its terminal state.
func TestLiveDB_RefundJourney_MemberRequestToAdminPayout(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 200_000
	fx := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)
	campaignID, contributorID := fx.campaignID, fx.contributorID

	var contributionID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM contributions WHERE campaign_id = $1`, campaignID).Scan(&contributionID); err != nil {
		t.Fatalf("read contribution: %v", err)
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	backerBefore, err := ledgerSvc.GetBalance(ctx, contributorID)
	if err != nil {
		t.Fatalf("backer balance: %v", err)
	}

	// (1) Member files the refund request against their own contribution.
	creatorSvc := creator.NewService(pool)
	if _, err := creatorSvc.RequestRefund(ctx, contributionID, contributorID, "changed my mind"); err != nil {
		t.Fatalf("request refund: %v", err)
	}

	// (2) The request NOW REACHES the admin queue (the E2E-COM-001 split is
	// closed): live row, REQUESTED-mapped status, is_demo=false.
	adminSvc := adminext.NewService(pool).
		WithLedger(ledgerSvc).
		WithSettlement(settlement.NewService(pool, ledgerSvc))
	queue, err := adminSvc.ListRefunds(ctx, "REQUESTED")
	if err != nil {
		t.Fatalf("list refunds: %v", err)
	}
	row := findRefund(t, queue, "Withdrawal/refund fixture")
	if row == nil {
		t.Fatalf("member refund request did not reach the admin queue — E2E-COM-001 regressed")
	}
	if row.Status != "REQUESTED" {
		t.Errorf("queue row status = %q, want REQUESTED", row.Status)
	}
	if row.IsDemo {
		t.Errorf("live request flagged is_demo — provenance inverted")
	}
	if row.AmountKobo != contributeKobo {
		t.Errorf("queue row amountKobo = %d, want %d", row.AmountKobo, contributeKobo)
	}

	if !row.RefundEligible {
		t.Errorf("queue row refundEligible = false on an unreversed contribution")
	}

	// (3) Admin approves → the real money path runs (clawback on the settled
	// split) and the request reaches its terminal REFUNDED state.
	if err := adminSvc.DecideRefund(ctx, row.ID, uuid.NewString(), true, "approved"); err != nil {
		t.Fatalf("decide refund (approve): %v", err)
	}
	if got, err := ledgerSvc.GetBalance(ctx, contributorID); err != nil || got != backerBefore+contributeKobo {
		t.Errorf("backer balance = %d, want %d (err=%v) — the gross must be back in the wallet", got, backerBefore+contributeKobo, err)
	}
	debits, credits := refundLegs(t, ctx, pool, "cf:refund:"+contributionID+"%")
	if debits != contributeKobo || credits != contributeKobo {
		t.Errorf("clawback legs: debits=%d credits=%d, want both %d (DR creator+revenue / CR backer)", debits, credits, contributeKobo)
	}
	var reqStatus, contribStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM cf_refund_requests WHERE contribution_id = $1`, contributionID).Scan(&reqStatus); err != nil {
		t.Fatalf("read request status: %v", err)
	}
	if reqStatus != "REFUNDED" {
		t.Errorf("request status = %q, want REFUNDED after the money moved", reqStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM contributions WHERE id = $1`, contributionID).Scan(&contribStatus); err != nil {
		t.Fatalf("read contribution status: %v", err)
	}
	if contribStatus != "refunded" {
		t.Errorf("contribution status = %q, want refunded", contribStatus)
	}
	// The audit trail recorded the payout decision.
	var audited bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM cf_audit_logs WHERE action='refund.approve.payout' AND target LIKE $1)`,
		contributionID+"%").Scan(&audited); err == nil && !audited {
		t.Errorf("no cf_audit_logs row for the refund payout — money mutations must be audited")
	}

	// (4) The decision is guarded: a second decide on the terminal row fails.
	if err := adminSvc.DecideRefund(ctx, row.ID, uuid.NewString(), true, "again"); err == nil {
		t.Errorf("second approve on a REFUNDED request succeeded — the guard must refuse terminal states")
	}
	d0, c0 := refundLegs(t, ctx, pool, "cf:refund:"+contributionID+"%")
	if d0 != debits || c0 != credits {
		t.Errorf("the refused re-decision posted legs: (%d,%d) vs prior (%d,%d)", d0, c0, debits, credits)
	}

	// (5) The queue now renders it PROCESSED (REFUNDED mapped), and it is no
	// longer refund-eligible.
	done, err := adminSvc.ListRefunds(ctx, "PROCESSED")
	if err != nil {
		t.Fatalf("list processed refunds: %v", err)
	}
	doneRow := findRefund(t, done, "Withdrawal/refund fixture")
	if doneRow == nil {
		t.Fatalf("processed request missing from the PROCESSED filter")
	}
	if doneRow.Status != "PROCESSED" {
		t.Errorf("processed row status = %q, want PROCESSED", doneRow.Status)
	}
	if doneRow.RefundEligible {
		t.Errorf("a refunded contribution still reports refundEligible")
	}
}

// TestLiveDB_RefundJourney_RejectKeepsMoneyUntouched pins the reject half:
// note required, no refund legs posted, request terminal REJECTED.
func TestLiveDB_RefundJourney_RejectKeepsMoneyUntouched(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 150_000
	fx := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)
	campaignID, contributorID := fx.campaignID, fx.contributorID

	var contributionID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM contributions WHERE campaign_id = $1`, campaignID).Scan(&contributionID); err != nil {
		t.Fatalf("read contribution: %v", err)
	}
	creatorSvc := creator.NewService(pool)
	if _, err := creatorSvc.RequestRefund(ctx, contributionID, contributorID, "buyer's remorse"); err != nil {
		t.Fatalf("request refund: %v", err)
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	adminSvc := adminext.NewService(pool).
		WithLedger(ledgerSvc).
		WithSettlement(settlement.NewService(pool, ledgerSvc))

	queue, err := adminSvc.ListRefunds(ctx, "REQUESTED")
	if err != nil {
		t.Fatalf("list refunds: %v", err)
	}
	row := findRefund(t, queue, "Withdrawal/refund fixture")
	if row == nil {
		t.Fatalf("request missing from queue")
	}

	if err := adminSvc.DecideRefund(ctx, row.ID, uuid.NewString(), false, ""); err == nil {
		t.Fatalf("reject without a note succeeded — the note is required")
	}
	if err := adminSvc.DecideRefund(ctx, row.ID, uuid.NewString(), false, "campaign delivered"); err != nil {
		t.Fatalf("reject with note: %v", err)
	}
	var reqStatus, contribStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM cf_refund_requests WHERE contribution_id = $1`, contributionID).Scan(&reqStatus); err != nil {
		t.Fatalf("read request: %v", err)
	}
	if reqStatus != "REJECTED" {
		t.Errorf("request status = %q, want REJECTED", reqStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM contributions WHERE id = $1`, contributionID).Scan(&contribStatus); err != nil {
		t.Fatalf("read contribution: %v", err)
	}
	if contribStatus != "released" {
		t.Errorf("contribution status = %q, want released — a rejection must not touch the money", contribStatus)
	}
	if d, c := refundLegs(t, ctx, pool, "cf:refund:"+contributionID+"%"); d != 0 || c != 0 {
		t.Errorf("rejection posted refund legs: debits=%d credits=%d, want 0", d, c)
	}
}

// TestLiveDB_RefundJourney_LegacyRowsStillDecideButMoveNoMoney pins the
// cf_refunds branch of the union: seed/demo rows remain decidable (status
// flip + audit) but can never post a ledger leg — they name no contribution.
func TestLiveDB_RefundJourney_LegacyRowsStillDecideButMoveNoMoney(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ref := "SPL-RF-LEGACY-" + uuid.NewString()[:8]
	var legacyID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO cf_refunds (reference, campaign_title, contributor_name, amount_kobo, reason, status, is_demo)
		VALUES ($1, 'Legacy fixture', 'Demo Backer', 75000, 'demo', 'REQUESTED', TRUE)
		RETURNING id::text`, ref).Scan(&legacyID); err != nil {
		t.Fatalf("insert legacy refund: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM cf_refunds WHERE id = $1`, legacyID); err != nil {
			t.Errorf("cleanup legacy refund: %v", err)
		}
	})

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	adminSvc := adminext.NewService(pool).
		WithLedger(ledgerSvc).
		WithSettlement(settlement.NewService(pool, ledgerSvc))

	queue, err := adminSvc.ListRefunds(ctx, "REQUESTED")
	if err != nil {
		t.Fatalf("list refunds: %v", err)
	}
	var legacy *adminext.RefundRequest
	for i := range queue {
		if queue[i].ID == legacyID {
			legacy = &queue[i]
		}
	}
	if legacy == nil {
		t.Fatalf("legacy cf_refunds row missing from the union queue")
	}
	if !legacy.IsDemo {
		t.Errorf("legacy row is_demo = false — provenance flag must stay on")
	}
	// Snapshot every refund-referenced leg: a demo-row decision must post
	// ZERO new legs against ANY contribution.
	d0, c0 := refundLegs(t, ctx, pool, "cf:refund:%")
	if err := adminSvc.DecideRefund(ctx, legacyID, uuid.NewString(), true, ""); err != nil {
		t.Fatalf("legacy approve: %v", err)
	}
	d1, c1 := refundLegs(t, ctx, pool, "cf:refund:%")
	if d1 != d0 || c1 != c0 {
		t.Errorf("a demo-row decision posted ledger legs: (%d,%d) → (%d,%d) — demo rows must never move money",
			d0, c0, d1, c1)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM cf_refunds WHERE id = $1`, legacyID).Scan(&status); err != nil {
		t.Fatalf("read legacy status: %v", err)
	}
	if status != "APPROVED" {
		t.Errorf("legacy status = %q, want APPROVED", status)
	}
}

// TestLiveDB_RefundJourney_EscrowBranchRefundsFromPool pins the other half of
// the executor: a contribution whose settlement never settled (the
// instant-settle failure residue) refunds through settlement.Refund — DR
// escrow / CR payer — not through the clawback.
func TestLiveDB_RefundJourney_EscrowBranchRefundsFromPool(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	fx := seedFundedContribution(t, ctx, pool, 5_000_000, 100_000)
	campaignID, creatorID, cfSvc := fx.campaignID, fx.creatorID, fx.cfSvc

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)

	// Second contributor with a genuinely-escrowed settlement — produced by
	// the REAL Escrow() debit (never a fabricated row), so the shared escrow
	// account's balance stays honest.
	backer2 := uuid.NewString()
	testsupport.CleanupUser(t, pool, backer2)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, backer2, "cf-escrow-"+backer2+"@test.local"); err != nil {
		t.Fatalf("seed backer2: %v", err)
	}
	testsupport.SetKycTier(t, ctx, pool, backer2, testsupport.KycTierUnlimited)

	// Fund backer2's wallet (same balanced-pair fixture as
	// seedFundedContribution) so the real Escrow debit has money to move.
	backer2Wallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, backer2)
	if err != nil {
		t.Fatalf("backer2 wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	fundRef := "cf-escrow-fund-" + campaignID
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,'CREDIT',$3,$4,$4||':credit'), ($2,'DEBIT',$3,$4,$4||':debit')`,
		backer2Wallet.ID, clearing.ID, int64(60_000), fundRef); err != nil {
		t.Fatalf("fund backer2: %v", err)
	}

	const escrowKobo int64 = 50_000
	sett, err := settlementSvc.Escrow(ctx, backer2,
		"campaign:"+campaignID+":contributor:"+backer2, "cf-escrow-idem-"+campaignID, "crowdfunding", escrowKobo)
	if err != nil {
		t.Fatalf("escrow backer2: %v", err)
	}
	contribID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,'escrowed',$5,$6)`,
		contribID, campaignID, backer2, escrowKobo, "cf-escrow-contrib-"+contribID, sett.ID); err != nil {
		t.Fatalf("insert escrowed contribution: %v", err)
	}

	result, err := cfSvc.RefundAll(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("refund all: %v", err)
	}
	// Both contributions refund: the released one via clawback (100,000), the
	// escrowed one straight out of the pool (50,000).
	if result.RefundedCount != 2 {
		t.Errorf("RefundedCount = %d, want 2 (clawback + escrow)", result.RefundedCount)
	}
	if result.RefundedKobo != 150_000 {
		t.Errorf("RefundedKobo = %d, want 150000", result.RefundedKobo)
	}
	if got, err := ledgerSvc.GetBalance(ctx, backer2); err != nil || got != 60_000 {
		t.Errorf("backer2 balance = %d, want 60000 (err=%v) — the escrow refund must restore the gross", got, err)
	}
	var stStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id = $1`, sett.ID).Scan(&stStatus); err != nil {
		t.Fatalf("read settlement: %v", err)
	}
	if stStatus != "refunded" {
		t.Errorf("settlement status = %q, want refunded", stStatus)
	}
}

// TestLiveDB_RefundJourney_EscrowRefundRetryConverges pins the wedge the
// ledger audit found in settlement.Refund (DEFECT 1): the credit leg and the
// status flip are separate pooled ops, so a crash between them leaves the
// refund leg posted under "refund:<settlementID>" while the settlement stays
// 'escrowed'. Before ErrDuplicate tolerance, every retry hard-errored on that
// key forever — refunded money, stranded tracking rows. This test seeds the
// crash state directly: post the exact credit Refund would post, leave the
// settlement 'escrowed', then assert Refund converges — succeeds, flips the
// status, and does NOT double-post a second leg pair.
func TestLiveDB_RefundJourney_EscrowRefundRetryConverges(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)

	backer := uuid.NewString()
	testsupport.CleanupUser(t, pool, backer)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, backer, "cf-retry-"+backer+"@test.local"); err != nil {
		t.Fatalf("seed backer: %v", err)
	}
	testsupport.SetKycTier(t, ctx, pool, backer, testsupport.KycTierUnlimited)

	backerWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, backer)
	if err != nil {
		t.Fatalf("backer wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	fundRef := "cf-retry-fund-" + backer
	const escrowKobo int64 = 40_000
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,'CREDIT',$3,$4,$4||':credit'), ($2,'DEBIT',$3,$4,$4||':debit')`,
		backerWallet.ID, clearing.ID, escrowKobo, fundRef); err != nil {
		t.Fatalf("fund backer: %v", err)
	}

	sett, err := settlementSvc.Escrow(ctx, backer,
		"campaign:retry:"+backer, "cf-retry-idem-"+backer, "crowdfunding", escrowKobo)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	// Simulate the crash: the refund credit leg lands under Refund's own
	// idempotency key, but the process dies before the status flip.
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, backer,
		"refund:"+sett.Reference, "refund:"+sett.ID, escrowAcc.ID, escrowKobo); err != nil {
		t.Fatalf("seed partial refund leg: %v", err)
	}

	// The retry must converge: no error, settlement flips, no second leg pair.
	if err := settlementSvc.Refund(ctx, sett.ID, "campaign failed"); err != nil {
		t.Fatalf("refund retry after crash: %v — previously wedged forever on ErrDuplicate", err)
	}
	var stStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id = $1`, sett.ID).Scan(&stStatus); err != nil {
		t.Fatalf("read settlement: %v", err)
	}
	if stStatus != "refunded" {
		t.Errorf("settlement status = %q, want refunded", stStatus)
	}
	var legs int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE $1`,
		"refund:"+sett.ID+"%").Scan(&legs); err != nil {
		t.Fatalf("count refund legs: %v", err)
	}
	if legs != 2 {
		t.Errorf("refund legs = %d, want exactly 2 (one balanced pair — retry must not double-post)", legs)
	}
	if bal, err := ledgerSvc.GetBalance(ctx, backer); err != nil || bal != escrowKobo {
		t.Errorf("backer balance = %d, want %d (refunded exactly once)", bal, escrowKobo)
	}
}
