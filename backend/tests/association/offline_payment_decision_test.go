package association_test

// LIVE-DB regression tests for DecideOfflinePayment (w10 community lane).
// The approval path posts a balanced DR provider_clearing → CR settlement
// journal keyed on the CALLER's Idempotency-Key, then flips the payment to
// SUCCESS and the invoice to PAID. Three replay/decision defects were latent:
//
//  1. ErrDuplicate swallowed without identity verification — repo.PostJournal
//     surfaces ErrDuplicate for ANY pre-existing key (it does not
//     identity-check the held journal, unlike DebitWithBalanceCheck), so an
//     admin approving payment B while accidentally reusing the key that
//     approved payment A had the duplicate swallowed: payment B marked
//     SUCCESS, its invoice PAID, revenue splits + audit committed — with ZERO
//     ledger legs behind it.
//  2. No decided-state guard on approve — a second approval of the SAME
//     payment under a NEW key posted a second identical journal, double-
//     counting the settlement credit for one payment.
//  3. No decided-state guard on reject — rejecting an already-SUCCESS payment
//     flipped it to FAILED while the invoice stayed PAID and the settled legs
//     stood, leaving the books contradicting the ledger.
//
// The durable idempotency unit is the PAYMENT: the journal carries the
// deterministic reference "assoc_offline_approval:<paymentID>", so "did this
// payment's settlement legs post" is answerable from the ledger of record
// regardless of which key a retry carried.
//
// Gated on TEST_DATABASE_URL — see live_db_integration_test.go's bring-up
// note. Fixture rows use the w10-comm- prefix.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/association/... -run LiveDB_OfflineDecision -v

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedOfflinePayment (idor_scope_test.go) inserts the PENDING offline payment
// claim these tests decide on — reused rather than redeclared.

// paymentAndInvoiceStatus reads back the (payment.status, invoice.status) pair.
func paymentAndInvoiceStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, paymentID, invoiceID string) (string, string) {
	t.Helper()
	var payStatus, invStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_payments WHERE id=$1`, paymentID).Scan(&payStatus); err != nil {
		t.Fatalf("read payment status: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&invStatus); err != nil {
		t.Fatalf("read invoice status: %v", err)
	}
	return payStatus, invStatus
}

// approvalLegCount counts ledger_entries carrying the deterministic
// association offline-approval reference for paymentID. A posted approval is
// exactly TWO rows (the balanced pair).
func approvalLegCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, paymentID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_entries WHERE reference=$1`,
		"assoc_offline_approval:"+paymentID).Scan(&n); err != nil {
		t.Fatalf("count approval legs: %v", err)
	}
	return n
}

// TestLiveDB_OfflineDecision_ForeignKeyReuse_Refused is defect 1: the caller's
// Idempotency-Key already holds a DIFFERENT journal (it approved a different
// payment). The duplicate must surface as a refusal — NOT be swallowed into a
// PAID invoice with no ledger legs.
func TestLiveDB_OfflineDecision_ForeignKeyReuse_Refused(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "w10-comm Foreign Key Guild "+uuid.New().String())
	adminID := seedAdminRole(t, ctx, pool, orgID, "FINANCE_ADMIN")
	_, membershipA := seedActiveMembership(t, ctx, pool, orgID)
	_, membershipB := seedActiveMembership(t, ctx, pool, orgID)
	invoiceA := seedDuesInvoice(t, ctx, pool, membershipA, 100_00)
	invoiceB := seedDuesInvoice(t, ctx, pool, membershipB, 200_00)
	paymentA := seedOfflinePayment(t, ctx, pool, membershipA, invoiceA, 100_00)
	paymentB := seedOfflinePayment(t, ctx, pool, membershipB, invoiceB, 200_00)

	sharedKey := newIdemKey(t, "w10-comm-shared")

	// Approve payment A under the shared key — legitimate first use.
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentA, sharedKey, true); err != nil {
		t.Fatalf("approve payment A: %v", err)
	}
	if n := approvalLegCount(t, ctx, pool, paymentA); n != 2 {
		t.Fatalf("payment A legs = %d, want 2 (one balanced journal)", n)
	}

	// Approve payment B reusing the SAME key. The key is held by payment A's
	// journal — a foreign claim. The swallow used to mark B's invoice PAID
	// with no money moved.
	err := svc.DecideOfflinePayment(ctx, adminID, paymentB, sharedKey, true)
	if err == nil {
		t.Errorf("foreign-key reuse must be refused, got nil error")
	}
	payB, invB := paymentAndInvoiceStatus(t, ctx, pool, paymentB, invoiceB)
	if payB != "PENDING" || invB != "DUE" {
		t.Errorf("refused approval must leave bookkeeping untouched: payment=%q invoice=%q, want PENDING/DUE", payB, invB)
	}
	if n := approvalLegCount(t, ctx, pool, paymentB); n != 0 {
		t.Errorf("payment B legs = %d, want 0 — no journal may post for a refused approval", n)
	}

	// And a fresh-key retry must then settle B normally.
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentB, newIdemKey(t, "w10-comm-b-ok"), true); err != nil {
		t.Fatalf("approve payment B with a fresh key: %v", err)
	}
	payB, invB = paymentAndInvoiceStatus(t, ctx, pool, paymentB, invoiceB)
	if payB != "SUCCESS" || invB != "PAID" {
		t.Errorf("payment B after clean retry: payment=%q invoice=%q, want SUCCESS/PAID", payB, invB)
	}
	if n := approvalLegCount(t, ctx, pool, paymentB); n != 2 {
		t.Errorf("payment B legs = %d, want 2", n)
	}
}

// TestLiveDB_OfflineDecision_ReplayAndReapprove is defects 2 + replay: a
// same-key retry converges (one journal), and a second approval under a NEW
// key must NOT post a second journal — the payment is already settled.
func TestLiveDB_OfflineDecision_ReplayAndReapprove(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "w10-comm Replay Guild "+uuid.New().String())
	adminID := seedAdminRole(t, ctx, pool, orgID, "FINANCE_ADMIN")
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 150_00)
	paymentID := seedOfflinePayment(t, ctx, pool, membershipID, invoiceID, 150_00)

	key := newIdemKey(t, "w10-comm-approve")

	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, key, true); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	// Same-key replay — a dropped-response retry. Must succeed, no new legs.
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, key, true); err != nil {
		t.Fatalf("same-key replay must converge, got %v", err)
	}
	if n := approvalLegCount(t, ctx, pool, paymentID); n != 2 {
		t.Fatalf("legs after same-key replay = %d, want 2", n)
	}

	// A different admin action (or the same admin with a fresh key) approving
	// the ALREADY-decided payment must not post a second journal — the
	// settlement would be double-counted.
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, newIdemKey(t, "w10-comm-again"), true); err != nil {
		t.Fatalf("re-approve of a decided payment must be an idempotent no-op, got %v", err)
	}
	if n := approvalLegCount(t, ctx, pool, paymentID); n != 2 {
		t.Errorf("legs after new-key re-approve = %d, want still 2 — re-approving must not double-post settlement", n)
	}
}

// TestLiveDB_OfflineDecision_RejectAfterApprove_Refused is defect 3: once a
// payment is SUCCESS the money has settled; the reject path must refuse rather
// than flip the payment to FAILED under standing ledger legs.
func TestLiveDB_OfflineDecision_RejectAfterApprove_Refused(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "w10-comm Reject Guild "+uuid.New().String())
	adminID := seedAdminRole(t, ctx, pool, orgID, "FINANCE_ADMIN")
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 120_00)
	paymentID := seedOfflinePayment(t, ctx, pool, membershipID, invoiceID, 120_00)

	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, newIdemKey(t, "w10-comm-appr"), true); err != nil {
		t.Fatalf("approve: %v", err)
	}
	// Rejecting a settled payment must fail closed.
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, newIdemKey(t, "w10-comm-rej"), false); err == nil {
		t.Errorf("reject after approve must be refused — the payment's money already settled")
	}
	payStatus, invStatus := paymentAndInvoiceStatus(t, ctx, pool, paymentID, invoiceID)
	if payStatus != "SUCCESS" || invStatus != "PAID" {
		t.Errorf("refused reject must leave settled state untouched: payment=%q invoice=%q, want SUCCESS/PAID", payStatus, invStatus)
	}
	if n := approvalLegCount(t, ctx, pool, paymentID); n != 2 {
		t.Errorf("legs = %d, want still 2", n)
	}

	// And rejecting twice is the honest idempotent mirror: first reject
	// succeeds on a fresh payment, the second is a no-op.
	invoice2 := seedDuesInvoice(t, ctx, pool, membershipID, 120_00)
	payment2 := seedOfflinePayment(t, ctx, pool, membershipID, invoice2, 120_00)
	if err := svc.DecideOfflinePayment(ctx, adminID, payment2, "", false); err != nil {
		t.Fatalf("first reject: %v", err)
	}
	if err := svc.DecideOfflinePayment(ctx, adminID, payment2, "", false); err != nil {
		t.Fatalf("second reject must be idempotent nil, got %v", err)
	}
	pay2, _ := paymentAndInvoiceStatus(t, ctx, pool, payment2, invoice2)
	if pay2 != "FAILED" {
		t.Errorf("rejected payment status = %q, want FAILED", pay2)
	}
}
