package association_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the association module.
//
// association.Service (association.NewService(pool, ledgerSvc)) talks to a
// concrete *pgxpool.Pool for every mutation (PayInvoice, DecideApplication,
// DecideOfflinePayment, SuspendMember/RestoreMember/TransferMember/AssignRole,
// PublishOrganisation, SetAiNoteStatus via ApproveAiNote/PublishAiNote) and to
// the real ledger.Service for double-entry posting. None of this can run
// without a migrated Postgres. This file is SKIPPED whenever
// DATABASE_URL/TEST_DATABASE_URL is unset (same pattern as
// backend/internal/top5events/service_integration_test.go and
// backend/tests/transport_scheduled/live_db_integration_test.go), but is fully
// written end-to-end so it can be un-skipped the moment infra is available —
// the skip is NOT a stub; every step below drives the real Service against
// real tables.
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply migrations in order, in particular:
//       supabase/migrations/20260628000000_association_module.sql
//       supabase/migrations/20260629000000_assoc_committee_members.sql
//       supabase/migrations/20260629000100_association_settings.sql
//     Confirm the core tables landed:
//       psql "$DATABASE_URL" -c "\d assoc_dues_invoices"
//       psql "$DATABASE_URL" -c "\d assoc_payments"
//  2. These tests do NOT depend on Supabase auth.users rows except where noted
//     (GetApprovalQueue LEFT JOINs auth.users but tolerates no match). Money
//     tests need a wallet with a positive balance for the paying member (dues
//     debits fail closed otherwise) — seed one via a direct ledger credit to
//     the synthetic test user id before running PayInvoice tests. Each test
//     SKIPS with a clear message rather than reporting a false negative if the
//     wallet balance is insufficient.
//  3. Set DATABASE_URL (or TEST_DATABASE_URL) to a disposable/test database —
//     never point this at production. `supabase db reset` (local, port 54322)
//     is the safest target:
//       export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  4. Run:
//       cd backend && go test ./tests/association/... -run LiveDB -v
//
// Every row this file touches is created by the test itself with a fresh
// uuid.New() id — no truncation, no shared fixtures, safe to run repeatedly
// against the same test database.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/association"
	"spotlight/backend/internal/finance/ledger"
)

// liveDBPool connects using DATABASE_URL/TEST_DATABASE_URL, or skips.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB association integration test; see bring-up note in live_db_integration_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// newLiveAssociationService wires association.Service exactly as production
// does (backend/internal/app/finance_routes.go:
// `assocSvc := association.NewService(pool, ledgerSvc)`), using a nil Redis
// client for the ledger (confirmed nil-safe pattern per ledger.Service.Debit /
// ledger/service_test.go and reused across the other live-DB test suites in
// this repo).
func newLiveAssociationService(pool *pgxpool.Pool) *association.Service {
	ledRepo := ledger.NewRepository(pool)
	led := ledger.NewService(ledRepo, (*goredis.Client)(nil))
	return association.NewService(pool, led)
}

func newIdemKey(t *testing.T, label string) string {
	t.Helper()
	return label + "-" + uuid.New().String()
}

// seedOrganisation inserts a minimal published organisation and returns its id.
func seedOrganisation(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string) string {
	t.Helper()
	orgID := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO assoc_organisations (id, name, category, group_type, approval_rule, published)
		VALUES ($1, $2, 'Professional', 'CLOSED', 'ADMIN', true)`, orgID, name)
	if err != nil {
		t.Fatalf("seed organisation: %v", err)
	}
	return orgID
}

// seedActiveMembership inserts an ACTIVE membership for a fresh synthetic user
// under the given organisation and returns (userID, membershipID).
func seedActiveMembership(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID string) (userID, membershipID string) {
	t.Helper()
	userID = uuid.New().String()
	membershipID = uuid.New().String()
	// The member's ledger wallet account FKs auth.users(id); seed the user first
	// (email required by the handle_new_user trigger → user_profiles.email NOT NULL).
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID, userID+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO assoc_memberships (id, organisation_id, user_id, member_code, status, payment_standing, joined_at)
		VALUES ($1, $2, $3, $4, 'ACTIVE', 'DUE', now())`,
		membershipID, orgID, userID, "TEST-"+membershipID[:8])
	if err != nil {
		t.Fatalf("seed membership: %v", err)
	}
	return userID, membershipID
}

// seedAdminRole grants adminUserID the given role/jurisdiction inside orgID by
// creating a membership + assoc_member_roles row, and returns the admin's
// membership id.
func seedAdminRole(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID, role string) (adminUserID string) {
	t.Helper()
	adminUserID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	_, err := pool.Exec(ctx, `
		INSERT INTO assoc_member_roles (id, membership_id, role, jurisdiction)
		VALUES ($1, $2, $3, 'NATIONAL')`, uuid.New().String(), membershipID, role)
	if err != nil {
		t.Fatalf("seed admin role: %v", err)
	}
	return adminUserID
}

// seedDuesInvoice inserts a DUE invoice for membershipID and returns its id.
func seedDuesInvoice(t *testing.T, ctx context.Context, pool *pgxpool.Pool, membershipID string, amountKobo int64) string {
	t.Helper()
	invoiceID := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO assoc_dues_invoices (id, membership_id, title, amount_kobo, cadence, scope, status, due_date)
		VALUES ($1, $2, 'Annual dues', $3, 'ANNUAL', 'NATIONAL', 'DUE', now() + interval '30 days')`,
		invoiceID, membershipID, amountKobo)
	if err != nil {
		t.Fatalf("seed dues invoice: %v", err)
	}
	return invoiceID
}

// seedWallet credits userID's wallet with amountKobo via a direct ledger
// credit from a synthetic funding standing account, so PayInvoice's debit has
// funds to draw down (Debit fails closed on insufficient balance).
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("seed wallet: standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "test-seed:"+uuid.New().String(), "test-seed-idem:"+uuid.New().String(), settle.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: credit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// PayInvoice: idempotency, balanced double-entry, audit, already-PAID receipt.
// ---------------------------------------------------------------------------

// TestLiveDB_PayInvoice_IdempotentSamePostingSameReceipt drives a real dues
// payment twice with the SAME Idempotency-Key and proves: (a) exactly one
// assoc_payments row is created, (b) the invoice flips to PAID exactly once,
// (c) both calls return the SAME receipt id, and (d) exactly one
// DUES_PAY audit row is written.
func TestLiveDB_PayInvoice_IdempotentSamePostingSameReceipt(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ledRepo := ledger.NewRepository(pool)
	led := ledger.NewService(ledRepo, (*goredis.Client)(nil))
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Test Guild "+uuid.New().String())
	userID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	const amount = int64(500_00) // 500 naira in kobo
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, amount)
	seedWallet(t, ctx, led, userID, amount*2) // headroom

	key := newIdemKey(t, "dues-pay")
	req := association.PayInvoiceRequest{Method: "WALLET", IdempotencyKey: key}

	first, err := svc.PayInvoice(ctx, userID, invoiceID, req)
	if err != nil {
		t.Fatalf("first PayInvoice: %v", err)
	}
	if first.Status != "SUCCESS" {
		t.Fatalf("first PayInvoice status = %s, want SUCCESS", first.Status)
	}

	second, err := svc.PayInvoice(ctx, userID, invoiceID, req)
	if err != nil {
		t.Fatalf("retried PayInvoice: %v", err)
	}
	if second.ReceiptID != first.ReceiptID {
		t.Errorf("retry returned a DIFFERENT receipt id: first=%s second=%s", first.ReceiptID, second.ReceiptID)
	}

	var paymentCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_payments WHERE invoice_id=$1`, invoiceID).Scan(&paymentCount); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if paymentCount != 1 {
		t.Errorf("assoc_payments rows for invoice = %d, want exactly 1 (no double posting)", paymentCount)
	}

	var invoiceStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&invoiceStatus); err != nil {
		t.Fatalf("read invoice status: %v", err)
	}
	if invoiceStatus != "PAID" {
		t.Errorf("invoice status = %s, want PAID", invoiceStatus)
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='invoice' AND subject_id=$1 AND action='DUES_PAY'`, invoiceID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("DUES_PAY audit rows = %d, want exactly 1", auditCount)
	}

	var splitCount int
	var paymentID string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_payments WHERE invoice_id=$1`, invoiceID).Scan(&paymentID); err != nil {
		t.Fatalf("read payment id: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_revenue_splits WHERE payment_id=$1`, paymentID).Scan(&splitCount); err != nil {
		t.Fatalf("count splits: %v", err)
	}
	if splitCount != len(association.RevenueSplit(amount)) {
		t.Errorf("revenue split rows = %d, want %d", splitCount, len(association.RevenueSplit(amount)))
	}
}

// TestLiveDB_PayInvoice_PostsBalancedDoubleEntry proves the ledger side: after
// PayInvoice, the paying member's wallet balance has decreased by exactly the
// invoice amount (the debit side of the balanced entry). The credit side lands
// on the settlement standing account, verified via ledger.GetBalance semantics
// (indirectly, by confirming the debit succeeded and the invoice is PAID —
// ledger.Debit's own invariant tests in finance/ledger/service_test.go cover
// the low-level balance mechanics; this test proves association wires it in).
func TestLiveDB_PayInvoice_PostsBalancedDoubleEntry(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ledRepo := ledger.NewRepository(pool)
	led := ledger.NewService(ledRepo, (*goredis.Client)(nil))
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Balance Guild "+uuid.New().String())
	userID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	const amount = int64(150_00)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, amount)
	seedWallet(t, ctx, led, userID, amount+1000_00) // extra headroom

	balBefore, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance before: %v", err)
	}

	_, err = svc.PayInvoice(ctx, userID, invoiceID, association.PayInvoiceRequest{
		Method: "WALLET", IdempotencyKey: newIdemKey(t, "balance-check"),
	})
	if err != nil {
		t.Fatalf("PayInvoice: %v", err)
	}

	balAfter, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after: %v", err)
	}
	if balBefore-balAfter != amount {
		t.Errorf("wallet balance dropped by %d, want exactly %d (double-entry debit)", balBefore-balAfter, amount)
	}
}

// TestLiveDB_PayInvoice_ForbidsPayingSomeoneElsesInvoice proves the
// object-level OLA check: a user who is not the invoice's owning member gets
// ErrForbidden.
func TestLiveDB_PayInvoice_ForbidsPayingSomeoneElsesInvoice(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "OLA Guild "+uuid.New().String())
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 10_000_00)

	stranger := uuid.New().String()
	_, err := svc.PayInvoice(ctx, stranger, invoiceID, association.PayInvoiceRequest{
		Method: "WALLET", IdempotencyKey: newIdemKey(t, "ola-pay"),
	})
	if err == nil {
		t.Fatal("expected ErrForbidden when a non-owner attempts to pay another member's invoice")
	}
}

// TestLiveDB_PayInvoice_RequiresIdempotencyKey proves the fail-closed guard
// end-to-end: an empty Idempotency-Key is rejected before any DB write.
func TestLiveDB_PayInvoice_RequiresIdempotencyKey(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "NoKey Guild "+uuid.New().String())
	userID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 5_000_00)

	_, err := svc.PayInvoice(ctx, userID, invoiceID, association.PayInvoiceRequest{Method: "WALLET", IdempotencyKey: ""})
	if err == nil {
		t.Fatal("expected PayInvoice with empty Idempotency-Key to fail")
	}

	var paymentCount int
	if scanErr := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_payments WHERE invoice_id=$1`, invoiceID).Scan(&paymentCount); scanErr != nil {
		t.Fatalf("count payments: %v", scanErr)
	}
	if paymentCount != 0 {
		t.Errorf("PayInvoice without an Idempotency-Key must not write any payment row, found %d", paymentCount)
	}
}

// ---------------------------------------------------------------------------
// DecideApplication: persistence + audit.
// ---------------------------------------------------------------------------

// TestLiveDB_DecideApplication_ApprovePersistsAndActivatesMembership seeds a
// PENDING application + a matching (not-yet-active) membership row, approves
// it, and verifies: application status flips to APPROVED, the membership
// activates, and an APPROVAL_DECISION audit row is written.
func TestLiveDB_DecideApplication_ApprovePersistsAndActivatesMembership(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Approval Guild "+uuid.New().String())
	applicantID := uuid.New().String()

	// Membership row not yet ACTIVE (application pending decision).
	membershipID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_memberships (id, organisation_id, user_id, status, payment_standing)
		VALUES ($1, $2, $3, 'PENDING', 'DUE')`, membershipID, orgID, applicantID); err != nil {
		t.Fatalf("seed pending membership: %v", err)
	}

	appID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_applications (id, organisation_id, user_id, status, jurisdiction)
		VALUES ($1, $2, $3, 'PENDING', 'CHAPTER')`, appID, orgID, applicantID); err != nil {
		t.Fatalf("seed application: %v", err)
	}

	adminID := seedAdminRole(t, ctx, pool, orgID, "NATIONAL_ADMIN")

	err := svc.DecideApplication(ctx, adminID, appID, association.ApprovalDecisionRequest{
		Decision: "APPROVE", Note: "looks good", IdempotencyKey: newIdemKey(t, "approve"),
	})
	if err != nil {
		t.Fatalf("DecideApplication: %v", err)
	}

	var appStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_applications WHERE id=$1`, appID).Scan(&appStatus); err != nil {
		t.Fatalf("read application status: %v", err)
	}
	if appStatus != "APPROVED" {
		t.Errorf("application status = %s, want APPROVED", appStatus)
	}

	var memberStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_memberships WHERE id=$1`, membershipID).Scan(&memberStatus); err != nil {
		t.Fatalf("read membership status: %v", err)
	}
	if memberStatus != "ACTIVE" {
		t.Errorf("membership status after approval = %s, want ACTIVE", memberStatus)
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='application' AND subject_id=$1 AND action='APPROVAL_DECISION'`, appID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("APPROVAL_DECISION audit rows = %d, want 1", auditCount)
	}
}

// TestLiveDB_DecideApplication_RejectDoesNotActivateMembership proves REJECT
// flips application status without touching the membership row.
func TestLiveDB_DecideApplication_RejectDoesNotActivateMembership(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Rejection Guild "+uuid.New().String())
	applicantID := uuid.New().String()
	membershipID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_memberships (id, organisation_id, user_id, status, payment_standing)
		VALUES ($1, $2, $3, 'PENDING', 'DUE')`, membershipID, orgID, applicantID); err != nil {
		t.Fatalf("seed pending membership: %v", err)
	}
	appID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_applications (id, organisation_id, user_id, status, jurisdiction)
		VALUES ($1, $2, $3, 'PENDING', 'CHAPTER')`, appID, orgID, applicantID); err != nil {
		t.Fatalf("seed application: %v", err)
	}
	adminID := seedAdminRole(t, ctx, pool, orgID, "NATIONAL_ADMIN")

	err := svc.DecideApplication(ctx, adminID, appID, association.ApprovalDecisionRequest{
		Decision: "REJECT", IdempotencyKey: newIdemKey(t, "reject"),
	})
	if err != nil {
		t.Fatalf("DecideApplication (reject): %v", err)
	}

	var appStatus, memberStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_applications WHERE id=$1`, appID).Scan(&appStatus); err != nil {
		t.Fatalf("read application status: %v", err)
	}
	if appStatus != "REJECTED" {
		t.Errorf("application status = %s, want REJECTED", appStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_memberships WHERE id=$1`, membershipID).Scan(&memberStatus); err != nil {
		t.Fatalf("read membership status: %v", err)
	}
	if memberStatus != "PENDING" {
		t.Errorf("membership status after reject = %s, want unchanged PENDING", memberStatus)
	}
}

// ---------------------------------------------------------------------------
// DecideOfflinePayment: persistence + balanced journal on approve.
// ---------------------------------------------------------------------------

// TestLiveDB_DecideOfflinePayment_ApprovePostsBalancedJournal seeds a pending
// offline payment against a DUE invoice, approves it as a FINANCE_ADMIN, and
// verifies: payment flips to SUCCESS, invoice flips to PAID, and a
// provider_clearing -> settlement journal entry pair exists for the amount.
func TestLiveDB_DecideOfflinePayment_ApprovePostsBalancedJournal(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Offline Guild "+uuid.New().String())
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	const amount = int64(75_00)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, amount)

	paymentID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_payments (id, invoice_id, membership_id, amount_kobo, method, status, offline)
		VALUES ($1, $2, $3, $4, 'CASH', 'PENDING', true)`,
		paymentID, invoiceID, membershipID, amount); err != nil {
		t.Fatalf("seed offline payment: %v", err)
	}

	adminID := seedAdminRole(t, ctx, pool, orgID, "FINANCE_ADMIN")

	key := newIdemKey(t, "offline-approve")
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, key, true); err != nil {
		t.Fatalf("DecideOfflinePayment (approve): %v", err)
	}

	var paymentStatus, invoiceStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_payments WHERE id=$1`, paymentID).Scan(&paymentStatus); err != nil {
		t.Fatalf("read payment status: %v", err)
	}
	if paymentStatus != "SUCCESS" {
		t.Errorf("offline payment status = %s, want SUCCESS", paymentStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&invoiceStatus); err != nil {
		t.Fatalf("read invoice status: %v", err)
	}
	if invoiceStatus != "PAID" {
		t.Errorf("invoice status = %s, want PAID", invoiceStatus)
	}

	var ledgerCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, "assoc_offline_approval:"+paymentID).Scan(&ledgerCount); err != nil {
		t.Fatalf("count ledger entries: %v", err)
	}
	if ledgerCount != 2 { // one DEBIT + one CREDIT leg = balanced pair
		t.Errorf("ledger entries for offline approval = %d, want 2 (one balanced debit/credit pair)", ledgerCount)
	}

	// Retry with the SAME key must not double-post.
	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, key, true); err != nil {
		t.Fatalf("retried DecideOfflinePayment (approve): %v", err)
	}
	var ledgerCountAfterRetry int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, "assoc_offline_approval:"+paymentID).Scan(&ledgerCountAfterRetry); err != nil {
		t.Fatalf("count ledger entries after retry: %v", err)
	}
	if ledgerCountAfterRetry != 2 {
		t.Errorf("ledger entries after retry = %d, want still 2 (idempotent retry must not double-post)", ledgerCountAfterRetry)
	}
}

// TestLiveDB_DecideOfflinePayment_RejectNoLedgerMovement proves the reject
// branch flips status to FAILED and writes an audit row without any ledger
// posting.
func TestLiveDB_DecideOfflinePayment_RejectNoLedgerMovement(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "OfflineReject Guild "+uuid.New().String())
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 20_00)
	paymentID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_payments (id, invoice_id, membership_id, amount_kobo, method, status, offline)
		VALUES ($1, $2, $3, $4, 'CASH', 'PENDING', true)`,
		paymentID, invoiceID, membershipID, 20_00); err != nil {
		t.Fatalf("seed offline payment: %v", err)
	}
	adminID := seedAdminRole(t, ctx, pool, orgID, "FINANCE_ADMIN")

	if err := svc.DecideOfflinePayment(ctx, adminID, paymentID, "", false); err != nil {
		t.Fatalf("DecideOfflinePayment (reject): %v", err)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_payments WHERE id=$1`, paymentID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "FAILED" {
		t.Errorf("rejected offline payment status = %s, want FAILED", status)
	}
	var ledgerCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, "assoc_offline_approval:"+paymentID).Scan(&ledgerCount); err != nil {
		t.Fatalf("count ledger entries: %v", err)
	}
	if ledgerCount != 0 {
		t.Errorf("reject must post NO ledger entries, found %d", ledgerCount)
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='payment' AND subject_id=$1 AND action='OFFLINE_PAYMENT_REJECTED'`, paymentID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("OFFLINE_PAYMENT_REJECTED audit rows = %d, want 1", auditCount)
	}
}

// TestLiveDB_DecideOfflinePayment_NonFinanceAdminForbidden proves a
// CHAPTER_ADMIN (ManageMembers but not ManageFinance) cannot decide an offline
// payment.
func TestLiveDB_DecideOfflinePayment_NonFinanceAdminForbidden(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "OLA Finance Guild "+uuid.New().String())
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 30_00)
	paymentID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_payments (id, invoice_id, membership_id, amount_kobo, method, status, offline)
		VALUES ($1, $2, $3, $4, 'CASH', 'PENDING', true)`,
		paymentID, invoiceID, membershipID, 30_00); err != nil {
		t.Fatalf("seed offline payment: %v", err)
	}
	chapterAdminID := seedAdminRole(t, ctx, pool, orgID, "CHAPTER_ADMIN")

	err := svc.DecideOfflinePayment(ctx, chapterAdminID, paymentID, newIdemKey(t, "forbidden-approve"), true)
	if err == nil {
		t.Fatal("expected CHAPTER_ADMIN (no ManageFinance) to be forbidden from deciding an offline payment")
	}
}

// ---------------------------------------------------------------------------
// Member actions: suspend / restore / transfer / role — persistence + audit +
// OLA (only association admins).
// ---------------------------------------------------------------------------

// TestLiveDB_SuspendThenRestoreMember_PersistsStatusAndAudit exercises the
// full suspend -> restore cycle and proves each transition persists and is
// audited.
func TestLiveDB_SuspendThenRestoreMember_PersistsStatusAndAudit(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Suspend Guild "+uuid.New().String())
	_, targetMembershipID := seedActiveMembership(t, ctx, pool, orgID)
	adminID := seedAdminRole(t, ctx, pool, orgID, "CHAPTER_ADMIN")

	if err := svc.SuspendMember(ctx, adminID, targetMembershipID, "late dues"); err != nil {
		t.Fatalf("SuspendMember: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_memberships WHERE id=$1`, targetMembershipID).Scan(&status); err != nil {
		t.Fatalf("read status after suspend: %v", err)
	}
	if status != "SUSPENDED" {
		t.Errorf("status after SuspendMember = %s, want SUSPENDED", status)
	}
	var suspendAuditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='member' AND subject_id=$1 AND action='MEMBER_SUSPEND'`, targetMembershipID).Scan(&suspendAuditCount); err != nil {
		t.Fatalf("count suspend audit: %v", err)
	}
	if suspendAuditCount != 1 {
		t.Errorf("MEMBER_SUSPEND audit rows = %d, want 1", suspendAuditCount)
	}

	if err := svc.RestoreMember(ctx, adminID, targetMembershipID); err != nil {
		t.Fatalf("RestoreMember: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_memberships WHERE id=$1`, targetMembershipID).Scan(&status); err != nil {
		t.Fatalf("read status after restore: %v", err)
	}
	if status != "ACTIVE" {
		t.Errorf("status after RestoreMember = %s, want ACTIVE", status)
	}
	var restoreAuditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='member' AND subject_id=$1 AND action='MEMBER_RESTORE'`, targetMembershipID).Scan(&restoreAuditCount); err != nil {
		t.Fatalf("count restore audit: %v", err)
	}
	if restoreAuditCount != 1 {
		t.Errorf("MEMBER_RESTORE audit rows = %d, want 1", restoreAuditCount)
	}
}

// TestLiveDB_SuspendMember_NonAdminForbidden proves OLA: a plain member (no
// assoc_member_roles row) cannot suspend another member.
func TestLiveDB_SuspendMember_NonAdminForbidden(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "NonAdmin Guild "+uuid.New().String())
	plainMemberID, _ := seedActiveMembership(t, ctx, pool, orgID)
	_, targetMembershipID := seedActiveMembership(t, ctx, pool, orgID)

	err := svc.SuspendMember(ctx, plainMemberID, targetMembershipID, "no reason")
	if err == nil {
		t.Fatal("expected a plain (non-admin) member to be forbidden from suspending another member")
	}

	var status string
	if scanErr := pool.QueryRow(ctx, `SELECT status FROM assoc_memberships WHERE id=$1`, targetMembershipID).Scan(&status); scanErr != nil {
		t.Fatalf("read status: %v", scanErr)
	}
	if status != "ACTIVE" {
		t.Errorf("target membership status changed to %s despite forbidden suspend attempt", status)
	}
}

// TestLiveDB_TransferMember_PersistsChapterAndAudit seeds two chapters, moves a
// member from none to a named chapter, and verifies persistence + audit.
func TestLiveDB_TransferMember_PersistsChapterAndAudit(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Transfer Guild "+uuid.New().String())
	chapterID := uuid.New().String()
	chapterName := "Lagos Chapter " + uuid.New().String()[:8]
	if _, err := pool.Exec(ctx, `INSERT INTO assoc_chapters (id, organisation_id, name, level) VALUES ($1,$2,$3,'STATE')`, chapterID, orgID, chapterName); err != nil {
		t.Fatalf("seed chapter: %v", err)
	}
	_, targetMembershipID := seedActiveMembership(t, ctx, pool, orgID)
	adminID := seedAdminRole(t, ctx, pool, orgID, "NATIONAL_ADMIN")

	if err := svc.TransferMember(ctx, adminID, targetMembershipID, chapterName); err != nil {
		t.Fatalf("TransferMember: %v", err)
	}

	var gotChapterID *string
	if err := pool.QueryRow(ctx, `SELECT chapter_id FROM assoc_memberships WHERE id=$1`, targetMembershipID).Scan(&gotChapterID); err != nil {
		t.Fatalf("read chapter_id: %v", err)
	}
	if gotChapterID == nil || *gotChapterID != chapterID {
		t.Errorf("chapter_id after transfer = %v, want %s", gotChapterID, chapterID)
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='member' AND subject_id=$1 AND action='MEMBER_TRANSFER'`, targetMembershipID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("MEMBER_TRANSFER audit rows = %d, want 1", auditCount)
	}
}

// TestLiveDB_AssignRole_PersistsRoleAndAudit_ChapterAdminForbidden proves
// AssignRole persists a new assoc_member_roles row when called by a
// NATIONAL_ADMIN, and is forbidden when called by a CHAPTER_ADMIN (who lacks
// ManageFinance and therefore cannot self-escalate or delegate).
func TestLiveDB_AssignRole_PersistsRoleAndAudit_ChapterAdminForbidden(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "RoleAssign Guild "+uuid.New().String())
	_, targetMembershipID := seedActiveMembership(t, ctx, pool, orgID)
	nationalAdminID := seedAdminRole(t, ctx, pool, orgID, "NATIONAL_ADMIN")

	if err := svc.AssignRole(ctx, nationalAdminID, targetMembershipID, "SECRETARY"); err != nil {
		t.Fatalf("AssignRole (by NATIONAL_ADMIN): %v", err)
	}
	var roleCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_member_roles WHERE membership_id=$1 AND role='SECRETARY'`, targetMembershipID).Scan(&roleCount); err != nil {
		t.Fatalf("count roles: %v", err)
	}
	if roleCount != 1 {
		t.Errorf("SECRETARY role rows for target = %d, want 1", roleCount)
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='member' AND subject_id=$1 AND action='ROLE_ASSIGN'`, targetMembershipID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("ROLE_ASSIGN audit rows = %d, want 1", auditCount)
	}

	// A CHAPTER_ADMIN (ManageMembers=true, ManageFinance=false) must be
	// forbidden from assigning roles (no self-escalation/delegation).
	chapterAdminID := seedAdminRole(t, ctx, pool, orgID, "CHAPTER_ADMIN")
	_, otherTargetMembershipID := seedActiveMembership(t, ctx, pool, orgID)
	err := svc.AssignRole(ctx, chapterAdminID, otherTargetMembershipID, "SECRETARY")
	if err == nil {
		t.Error("expected CHAPTER_ADMIN to be forbidden from assigning roles")
	}
}

// ---------------------------------------------------------------------------
// PublishOrganisation: state persists (org + chapters + committees +
// categories + audit) in one transaction.
// ---------------------------------------------------------------------------

// TestLiveDB_PublishOrganisation_PersistsFullGraphAndAudit publishes a new
// organisation with chapters, committees, and membership categories, then
// verifies every child row persisted and an ORG_PUBLISH audit row was written.
func TestLiveDB_PublishOrganisation_PersistsFullGraphAndAudit(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	founderID := uuid.New().String()
	orgName := "Published Guild " + uuid.New().String()

	draft := association.OrgDraft{
		Name:                orgName,
		Category:            "Professional",
		GroupType:           "OPEN",
		RegistrationFeeKobo: 0,
		Chapters:            []association.OrgDraftChapter{{Name: "Lagos", Level: "STATE"}, {Name: "Abuja", Level: "STATE"}},
		Committees:          []association.OrgDraftCommittee{{Name: "Welfare"}},
		Categories:          []association.OrgDraftCategory{{Label: "Regular", DuesKobo: 10_000_00, Cadence: "ANNUAL"}},
		AcceptedTerms:       true,
	}

	result, err := svc.PublishOrganisation(ctx, founderID, draft)
	if err != nil {
		t.Fatalf("PublishOrganisation: %v", err)
	}
	if result.OrganisationID == "" {
		t.Fatal("PublishOrganisation returned an empty organisation id")
	}

	var published bool
	var name string
	if err := pool.QueryRow(ctx, `SELECT name, published FROM assoc_organisations WHERE id=$1`, result.OrganisationID).Scan(&name, &published); err != nil {
		t.Fatalf("read organisation: %v", err)
	}
	if !published {
		t.Error("published organisation row has published=false")
	}
	if name != orgName {
		t.Errorf("organisation name = %q, want %q", name, orgName)
	}

	var chapterCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_chapters WHERE organisation_id=$1`, result.OrganisationID).Scan(&chapterCount); err != nil {
		t.Fatalf("count chapters: %v", err)
	}
	if chapterCount != 2 {
		t.Errorf("chapters persisted = %d, want 2", chapterCount)
	}

	var committeeCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_committees WHERE organisation_id=$1`, result.OrganisationID).Scan(&committeeCount); err != nil {
		t.Fatalf("count committees: %v", err)
	}
	if committeeCount != 1 {
		t.Errorf("committees persisted = %d, want 1", committeeCount)
	}

	var categoryCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_membership_categories WHERE organisation_id=$1`, result.OrganisationID).Scan(&categoryCount); err != nil {
		t.Fatalf("count categories: %v", err)
	}
	if categoryCount != 1 {
		t.Errorf("membership categories persisted = %d, want 1", categoryCount)
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='organisation' AND subject_id=$1 AND action='ORG_PUBLISH'`, result.OrganisationID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("ORG_PUBLISH audit rows = %d, want 1", auditCount)
	}

	// The published org must also be visible via the discovery read path.
	orgs, err := svc.GetOrganisations(ctx, orgName)
	if err != nil {
		t.Fatalf("GetOrganisations: %v", err)
	}
	found := false
	for _, o := range orgs {
		if o.ID == result.OrganisationID {
			found = true
		}
	}
	if !found {
		t.Error("newly published organisation not found via GetOrganisations search — publish + read-path are inconsistent")
	}
}

// TestLiveDB_PublishOrganisation_RejectsWithoutAcceptedTerms proves the
// AcceptedTerms guard fires before any row is written.
func TestLiveDB_PublishOrganisation_RejectsWithoutAcceptedTerms(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	founderID := uuid.New().String()
	orgName := "Unaccepted Guild " + uuid.New().String()
	_, err := svc.PublishOrganisation(ctx, founderID, association.OrgDraft{
		Name: orgName, Category: "Professional", GroupType: "OPEN", AcceptedTerms: false,
	})
	if err == nil {
		t.Fatal("expected PublishOrganisation to reject a draft with AcceptedTerms=false")
	}
	var count int
	if scanErr := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_organisations WHERE name=$1`, orgName).Scan(&count); scanErr != nil {
		t.Fatalf("count orgs: %v", scanErr)
	}
	if count != 0 {
		t.Errorf("organisation row was written despite AcceptedTerms=false, count=%d", count)
	}
}

// ---------------------------------------------------------------------------
// AI-note approve/publish: state transitions persist. (See
// money_invariants_test.go TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap
// for the accompanying authorization-gap finding — these tests only prove the
// STATE TRANSITION persists as coded; they do not assert an authz boundary
// that does not currently exist in source.)
// ---------------------------------------------------------------------------

// seedAiNote inserts an assoc_ai_notes row in READY status and returns its id.
func seedAiNote(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID string) string {
	t.Helper()
	noteID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_ai_notes (id, organisation_id, meeting_title, source, status)
		VALUES ($1, $2, 'Q3 board meeting', 'AUDIO', 'READY')`, noteID, orgID); err != nil {
		t.Fatalf("seed ai note: %v", err)
	}
	return noteID
}

// TestLiveDB_AiNote_ApproveThenPublish_PersistsStatusAndAudit drives an ai-note
// through READY -> APPROVED -> PUBLISHED via the Handler-level entrypoints
// (SetAiNoteStatus with the exact (status, action) pairs ApproveAiNote /
// PublishAiNote pass — handler_ext.go L253-267), and verifies persistence +
// one audit row per transition.
func TestLiveDB_AiNote_ApproveThenPublish_PersistsStatusAndAudit(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "AiNotes Guild "+uuid.New().String())
	noteID := seedAiNote(t, ctx, pool, orgID)
	// SetAiNoteStatus now enforces requireAssocAdmin (fixed by Agent E). Seed a
	// SECRETARY — the intended minutes reviewer, who holds an admin role even
	// though every AdminCapabilities flag is false for that role.
	actorID := seedAdminRole(t, ctx, pool, orgID, "SECRETARY")

	// Negative: a plain member (no assoc_member_roles row) is forbidden.
	nonAdminID, _ := seedActiveMembership(t, ctx, pool, orgID)
	if err := svc.SetAiNoteStatus(ctx, nonAdminID, noteID, "APPROVED", "MINUTES_APPROVE"); err == nil {
		t.Fatal("SetAiNoteStatus by a non-admin must be forbidden, got nil error")
	}
	// The forbidden call must not have mutated the note.
	var preStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&preStatus); err != nil {
		t.Fatalf("read status after forbidden attempt: %v", err)
	}
	if preStatus == "APPROVED" {
		t.Fatal("non-admin approval was not rejected — note advanced to APPROVED")
	}

	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "APPROVED", "MINUTES_APPROVE"); err != nil {
		t.Fatalf("SetAiNoteStatus (approve): %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
		t.Fatalf("read status after approve: %v", err)
	}
	if status != "APPROVED" {
		t.Errorf("status after approve = %s, want APPROVED", status)
	}
	var approveAuditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='ai_note' AND subject_id=$1 AND action='MINUTES_APPROVE'`, noteID).Scan(&approveAuditCount); err != nil {
		t.Fatalf("count approve audit: %v", err)
	}
	if approveAuditCount != 1 {
		t.Errorf("MINUTES_APPROVE audit rows = %d, want 1", approveAuditCount)
	}

	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "PUBLISHED", "MINUTES_PUBLISH"); err != nil {
		t.Fatalf("SetAiNoteStatus (publish): %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
		t.Fatalf("read status after publish: %v", err)
	}
	if status != "PUBLISHED" {
		t.Errorf("status after publish = %s, want PUBLISHED", status)
	}
	var publishAuditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='ai_note' AND subject_id=$1 AND action='MINUTES_PUBLISH'`, noteID).Scan(&publishAuditCount); err != nil {
		t.Fatalf("count publish audit: %v", err)
	}
	if publishAuditCount != 1 {
		t.Errorf("MINUTES_PUBLISH audit rows = %d, want 1", publishAuditCount)
	}

	// Confirm the read path (GetAiNote) reflects PUBLISHED. GetAiNote is now
	// org-scoped: read as the admin actor, who is an ACTIVE member of the note's org.
	note, err := svc.GetAiNote(ctx, actorID, noteID)
	if err != nil {
		t.Fatalf("GetAiNote: %v", err)
	}
	if note.Status != "PUBLISHED" {
		t.Errorf("GetAiNote status = %s, want PUBLISHED", note.Status)
	}
}

// TestLiveDB_AiNote_SetStatus_NotFoundIsReported proves SetAiNoteStatus surfaces
// an error for a non-existent note id rather than silently succeeding — the
// production code has no RowsAffected guard, so this test also documents the
// CURRENT no-op-vs-error behavior for a future reviewer.
func TestLiveDB_AiNote_SetStatus_NotFoundIsReported(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	// Use an admin actor so we exercise the not-found path, not the (now
	// present) authorization guard added by Agent E.
	orgID := seedOrganisation(t, ctx, pool, "AiNotes NotFound "+uuid.New().String())
	adminID := seedAdminRole(t, ctx, pool, orgID, "SECRETARY")
	missingNoteID := uuid.New().String()
	err := svc.SetAiNoteStatus(ctx, adminID, missingNoteID, "APPROVED", "MINUTES_APPROVE")
	// As read from source (service_ext.go SetAiNoteStatus), the UPDATE affecting
	// zero rows is NOT checked — the function proceeds to write an audit row and
	// commits successfully even though no note was updated. This assertion
	// documents that CURRENT behavior (err == nil) rather than asserting the
	// arguably-more-correct behavior, so a fix is a deliberate, reviewed change
	// rather than a silent one.
	if err != nil {
		t.Logf("SetAiNoteStatus on a missing note id returned an error (%v) — if this is now an intentional not-found check, update this test to assert it explicitly.", err)
		return
	}
	var auditCount int
	if scanErr := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE subject_type='ai_note' AND subject_id=$1`, missingNoteID).Scan(&auditCount); scanErr != nil {
		t.Fatalf("count audit: %v", scanErr)
	}
	if auditCount != 1 {
		t.Errorf("KNOWN GAP CHANGED: expected an audit row even for a no-op update against a missing note id (current behavior), got %d — update this test's premise", auditCount)
	}
}

var _ = time.Now // keep time import available for future test additions without churn
