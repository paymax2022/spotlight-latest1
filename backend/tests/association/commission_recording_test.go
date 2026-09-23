package association_test

// ---------------------------------------------------------------------------
// LIVE-DB spec closing the TODO in docs/qa/modules/association.md §3/§7
// (ASSOCIATION-INT-008): a settled dues payment must record exactly ONE
// commission_earnings row — the realized 5% platform-fee line of
// RevenueSplit, not a second re-derived cut — and must NOT post a second
// ledger entry, since the dues split above already routes the platform fee
// through PayInvoice's own balanced double-entry. The association→commission
// adapter is wired with a NIL ledger specifically to guarantee this (see
// service.go's recordCommissionSafe doc comment); this test proves that
// wiring holds live, not just by reading the code.
//
// Gated on TEST_DATABASE_URL alone — see live_db_integration_test.go's
// bring-up note for this package.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/association/... -run LiveDB_PayInvoice_RecordsCommissionEarningRowOnly -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/association"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
)

// testCommissionRecorder adapts commission.Service to association.CommissionRecorder
// — the same two-method shape internal/app's commissionRecorderAdapter uses, kept
// local here since that adapter type is unexported in package app.
type testCommissionRecorder struct{ svc *commission.Service }

func (a testCommissionRecorder) RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceModule, sourceRef string, userID *string, idempotencyKey string) error {
	_, err := a.svc.RecordFor(ctx, category, service, subtype, grossKobo, sourceModule, sourceRef, userID, idempotencyKey)
	return err
}

func (a testCommissionRecorder) RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
	sourceModule, sourceRef string, userID *string, idempotencyKey string) error {
	_, err := a.svc.RecordExact(ctx, category, service, subtype, grossKobo, recordedRevenueKobo, sourceModule, sourceRef, userID, idempotencyKey)
	return err
}

func TestLiveDB_PayInvoice_RecordsCommissionEarningRowOnly(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ledRepo := ledger.NewRepository(pool)
	led := ledger.NewService(ledRepo, (*goredis.Client)(nil))
	svc := association.NewService(pool, led)

	// The nil-ledger wiring is the load-bearing part of this test: it's what
	// makes RecordExact append-only (no second ledger post), matching the
	// real production wiring in finance_routes.go exactly.
	commissionSvc := commission.NewService(commission.NewRepository(pool), nil)
	svc.SetCommissionRecorder(testCommissionRecorder{svc: commissionSvc})

	ctx := context.Background()
	orgID := seedOrganisation(t, ctx, pool, "Commission Guild "+uuid.New().String())
	userID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	const amount = int64(2_000_000) // -> 100,000 kobo platform fee (5%)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, amount)
	seedWallet(t, ctx, led, userID, amount+1_000_00)

	balBefore, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance before: %v", err)
	}

	key := newIdemKey(t, "commission-pay")
	result, err := svc.PayInvoice(ctx, userID, invoiceID, association.PayInvoiceRequest{
		Method: "WALLET", IdempotencyKey: key,
	})
	if err != nil {
		t.Fatalf("PayInvoice: %v", err)
	}
	// commission_earnings is append-only (same immutability trigger as
	// ledger_entries) — the row this test creates is permanent, harmless
	// audit residue by design, not cleaned up here on purpose.

	// Exactly one earning row, at the exact realized platform-fee line —
	// amount*5/100 = 100,000 — not a re-derived config percentage of the
	// full dues amount.
	var count int
	var grossKobo, spotlightRevenueKobo, platformChargeKobo int64
	var sourceModule string
	if err := pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(MAX(gross_amount_kobo),0), COALESCE(MAX(spotlight_revenue_kobo),0),
		       COALESCE(MAX(platform_charge_kobo),0), COALESCE(MAX(source_module),'')
		FROM commission_earnings WHERE source_module = 'association' AND source_ref = $1`,
		invoiceID).Scan(&count, &grossKobo, &spotlightRevenueKobo, &platformChargeKobo, &sourceModule); err != nil {
		t.Fatalf("count commission_earnings: %v", err)
	}
	if count != 1 {
		t.Errorf("commission_earnings rows for this invoice = %d, want exactly 1", count)
	}
	if grossKobo != amount {
		t.Errorf("gross_amount_kobo = %d, want %d (the full dues amount, for reporting context)", grossKobo, amount)
	}
	const wantPlatformFee = 100_000 // amount * 5 / 100
	if spotlightRevenueKobo != wantPlatformFee {
		t.Errorf("spotlight_revenue_kobo = %d, want %d (the REALIZED 5%% platform-fee line, not a re-derived config cut)", spotlightRevenueKobo, wantPlatformFee)
	}
	if platformChargeKobo != wantPlatformFee {
		t.Errorf("platform_charge_kobo = %d, want %d", platformChargeKobo, wantPlatformFee)
	}
	if sourceModule != "association" {
		t.Errorf("source_module = %q, want %q", sourceModule, "association")
	}

	// No second ledger post: exactly the two legs PayInvoice's own balanced
	// debit posted (user wallet DEBIT / settlement CREDIT), never a third or
	// fourth entry from commission recognition.
	var ledgerEntryCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference = $1`,
		"assoc_dues:"+invoiceID).Scan(&ledgerEntryCount); err != nil {
		t.Fatalf("count ledger entries: %v", err)
	}
	if ledgerEntryCount != 2 {
		t.Errorf("ledger_entries for this payment = %d, want exactly 2 (one balanced debit/credit pair) — "+
			"a higher count means commission recording posted its own ledger entries, double-counting the platform fee", ledgerEntryCount)
	}

	balAfter, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after: %v", err)
	}
	if balBefore-balAfter != amount {
		t.Errorf("wallet balance dropped by %d, want exactly %d — commission recording must never move money", balBefore-balAfter, amount)
	}
	if result.Status != "SUCCESS" {
		t.Errorf("PayInvoice status = %q, want SUCCESS", result.Status)
	}
}
