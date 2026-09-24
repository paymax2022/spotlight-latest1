package estate

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for PayDuesPaystackFunded / QuoteDuesInvoice
// (backend/internal/estate/service_dues.go), the externally-funded dues
// payment path — the estate counterpart of
// restaurant/paystackfunded_live_db_test.go and
// transport/paystackfunded_live_db_test.go. Reuses
// service_dues_live_db_test.go's fixtures (estateDuesTestPool,
// newDuesTestService, seedDuesUser, seedEstate, seedResident, seedInvoice,
// walletBalance, duesSettlementLegKobo, paymentCount, invoiceStatus).
//
// Asserts on the settlement leg by THIS payment's own idempotency key
// (duesSettlementLegKobo), not a before/after balance diff — settlement is a
// global standing account shared by restaurant payouts, academy, connect,
// realtor and other suites, and `go test ./...` runs packages concurrently
// against one database, so a balance delta would race their postings. See
// service_dues_live_db_test.go's duesSettlementLegKobo doc comment.
//
// What these pin:
//  1. A Tier-0 resident — refused by the wallet-funded PayDues — can settle
//     an invoice via the Paystack-funded path. The tier gate never runs at
//     all: no wallet debit occurs, so there is nothing for it to price.
//  2. The resident's wallet balance is UNCHANGED by an externally-funded
//     payment.
//  3. QuoteDuesInvoice's number is exactly what PayDuesPaystackFunded accepts.
//  4. A caller that passes anything other than the exact invoice amount is
//     refused BEFORE any money moves, above and below.
//  5. The settlement account is still credited exactly like the wallet-funded
//     path — externally-funded dues settle into the SAME collection account,
//     just via a different ledger leg (no wallet debit).
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
)

func TestLiveDB_PayDuesPaystackFunded_SkipsTierGate(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	// Downgrade to Tier 0 — seedDuesUser seeds Tier 3 by default.
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=0 WHERE id=$1`, resident); err != nil {
		t.Fatalf("downgrade resident to tier 0: %v", err)
	}

	const amount int64 = 300_000
	invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")

	walletBefore := walletBalance(t, ctx, pool, resident)

	// Sanity: the WALLET path is refused for this Tier-0 resident.
	if _, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{
		InvoiceID: invID, IdempotencyKey: "duespf-tier0-wallet-" + invID,
	}); err == nil {
		t.Fatal("wallet-funded PayDues must be refused for a Tier-0 resident (this feature must not relax it)")
	}

	quoted, err := svc.QuoteDuesInvoice(ctx, estateID, resident, invID)
	if err != nil {
		t.Fatalf("QuoteDuesInvoice: %v", err)
	}
	if quoted != amount {
		t.Fatalf("quoted amount = %d, want the invoice amount %d", quoted, amount)
	}

	const idemKey = "duespf-tier0-"
	receipt, err := svc.PayDuesPaystackFunded(ctx, estateID, resident, PayDuesRequest{
		InvoiceID: invID, IdempotencyKey: idemKey + invID,
	}, quoted)
	if err != nil {
		t.Fatalf("PayDuesPaystackFunded must succeed for a Tier-0 resident, got: %v", err)
	}
	if receipt.AmountKobo != amount {
		t.Errorf("receipt amount = %d, want %d", receipt.AmountKobo, amount)
	}
	if receipt.Method != "paystack" {
		t.Errorf("receipt.Method = %q, want \"paystack\"", receipt.Method)
	}

	if got := invoiceStatus(t, ctx, pool, invID); got != "paid" {
		t.Errorf("invoice status = %q, want paid", got)
	}

	// Wallet untouched; settlement credited exactly like the wallet-funded path.
	walletAfter := walletBalance(t, ctx, pool, resident)
	if walletAfter != walletBefore {
		t.Errorf("resident wallet balance moved on an externally-funded payment: %d -> %d", walletBefore, walletAfter)
	}
	if got := duesSettlementLegKobo(t, ctx, pool, led, idemKey+invID); got != amount {
		t.Errorf("settlement credited %d for this payment, want exactly %d", got, amount)
	}
}

func TestLiveDB_PayDuesPaystackFunded_AmountMismatchRejects(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	const amount int64 = 400_000
	invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")

	quoted, err := svc.QuoteDuesInvoice(ctx, estateID, resident, invID)
	if err != nil {
		t.Fatalf("QuoteDuesInvoice: %v", err)
	}

	walletBefore := walletBalance(t, ctx, pool, resident)

	const underKey = "duespf-mismatch-under-"
	const overKey = "duespf-mismatch-over-"
	if _, err := svc.PayDuesPaystackFunded(ctx, estateID, resident, PayDuesRequest{
		InvoiceID: invID, IdempotencyKey: underKey + invID,
	}, quoted-1); err == nil {
		t.Fatal("underpaid amount must be refused")
	}
	if _, err := svc.PayDuesPaystackFunded(ctx, estateID, resident, PayDuesRequest{
		InvoiceID: invID, IdempotencyKey: overKey + invID,
	}, quoted+1); err == nil {
		t.Fatal("overpaid amount must be refused")
	}

	if got := invoiceStatus(t, ctx, pool, invID); got != "pending" {
		t.Errorf("invoice status = %q after rejected payments, want still pending", got)
	}
	if n := paymentCount(t, ctx, pool, invID); n != 0 {
		t.Errorf("payment rows = %d after rejected payments, want 0", n)
	}
	walletAfter := walletBalance(t, ctx, pool, resident)
	if walletAfter != walletBefore {
		t.Errorf("resident wallet balance moved on rejected payments: %d -> %d", walletBefore, walletAfter)
	}
	if got := duesSettlementLegKobo(t, ctx, pool, led, underKey+invID); got != 0 {
		t.Errorf("settlement moved %d on the rejected underpaid attempt, want 0", got)
	}
	if got := duesSettlementLegKobo(t, ctx, pool, led, overKey+invID); got != 0 {
		t.Errorf("settlement moved %d on the rejected overpaid attempt, want 0", got)
	}
}

func TestLiveDB_QuoteDuesInvoice_MatchesPayDuesPaystackFundedAmount(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, _ := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	const amount int64 = 175_000
	invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")

	quoted, err := svc.QuoteDuesInvoice(ctx, estateID, resident, invID)
	if err != nil {
		t.Fatalf("QuoteDuesInvoice: %v", err)
	}
	receipt, err := svc.PayDuesPaystackFunded(ctx, estateID, resident, PayDuesRequest{
		InvoiceID: invID, IdempotencyKey: "duespf-quotematch-" + invID,
	}, quoted)
	if err != nil {
		t.Fatalf("PayDuesPaystackFunded: %v", err)
	}
	if receipt.AmountKobo != quoted {
		t.Errorf("paid amount = %d, quoted = %d — QuoteDuesInvoice and PayDuesPaystackFunded drifted", receipt.AmountKobo, quoted)
	}
}

func TestLiveDB_QuoteDuesInvoice_RejectsAnotherResidentsInvoice(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, _ := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	residentX := seedDuesUser(t, ctx, pool)
	residentY := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, residentX, "resident")
	seedResident(t, ctx, pool, estateID, residentY, "resident")

	invY := seedInvoice(t, ctx, pool, estateID, residentY, 250_000, "pending")

	if _, err := svc.QuoteDuesInvoice(ctx, estateID, residentX, invY); err == nil {
		t.Fatal("expected rejection: resident X must not quote resident Y's invoice")
	}
}
