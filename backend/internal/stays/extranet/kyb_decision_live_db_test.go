package extranet

// LIVE-DB tests for the ops KYB decision (AdminDecideKYB) and the review queue.
// The decision statement is one large INSERT .. ON CONFLICT whose column list and
// VALUES list must stay aligned; a mismatch fails ONLY at execution
// ("INSERT has more target columns than expressions"), so no non-DB test can
// catch it — and it shipped broken, returning 500 on every decision.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func kybDecisionFixture(t *testing.T) (*Service, *pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping KYB decision live-DB tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	property := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_property
			(id, source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type)
		VALUES ($1, 'DIRECT', 'self', $2, 'KYB Decision Test Hotel', '1 St', 'Lagos', 4, 'hotel')`,
		property, uuid.New().String()); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.stays_hotelier_kyb WHERE property_id = $1`, property)
		_, _ = pool.Exec(bg, `DELETE FROM public.stays_property WHERE id = $1`, property)
	})
	svc := NewService(NewRepository(pool), NewAuthZ(pool), nil, noopStaffInviteMailer{}, "")
	return svc, pool, property
}

func TestLiveDB_AdminDecideKYB_CreatesRecordAndSnapshotsVerdict(t *testing.T) {
	svc, pool, property := kybDecisionFixture(t)
	ctx := context.Background()
	reviewer := uuid.New().String()

	// No stays_hotelier_kyb row exists yet: the decision must create it.
	if _, err := svc.AdminDecideKYB(ctx, property, reviewer, BusinessVerificationInput{
		LegalName: "Decision Test Ltd", BusinessType: "limited_company", RCNumber: "RC4421",
		TIN: "12345678-0001", DirectorName: "Femi Okoro", DirectorBVN: "12345678901",
	}, "approve", ""); err != nil {
		t.Fatalf("approve (insert path) failed: %v", err)
	}

	var status, kyc, doc, snap string
	var reviewedBy *string
	if err := pool.QueryRow(ctx, `
		SELECT k.status, k.kyc_status, k.business_doc_status, k.reviewed_by::text, p.kyb_status
		FROM public.stays_hotelier_kyb k JOIN public.stays_property p ON p.id = k.property_id
		WHERE k.property_id = $1`, property).Scan(&status, &kyc, &doc, &reviewedBy, &snap); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if status != "approved" || kyc != "approved" || doc != "approved" || snap != "approved" {
		t.Errorf("verdict not applied everywhere: status=%s kyc=%s doc=%s property.kyb_status=%s", status, kyc, doc, snap)
	}
	if reviewedBy == nil || *reviewedBy != reviewer {
		t.Errorf("reviewed_by = %v, want %s", reviewedBy, reviewer)
	}
}

func TestLiveDB_AdminDecideKYB_UpdatesSubmittedRecordAndKeepsUnsuppliedFields(t *testing.T) {
	svc, pool, property := kybDecisionFixture(t)
	ctx := context.Background()
	reviewer := uuid.New().String()

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_hotelier_kyb
			(property_id, legal_name, rc_number, director_bvn, status, kyc_status, business_doc_status, submitted_for_review_at)
		VALUES ($1, 'Submitted Ltd', 'RC9999', '12345678901', 'submitted', 'submitted', 'submitted', now())`, property); err != nil {
		t.Fatalf("seed submitted row: %v", err)
	}

	// Blank business fields must leave stored values untouched.
	if _, err := svc.AdminDecideKYB(ctx, property, reviewer, BusinessVerificationInput{}, "needs_changes", "CAC certificate is unreadable"); err != nil {
		t.Fatalf("needs_changes (update path) failed: %v", err)
	}

	var status, legal, rc, note string
	if err := pool.QueryRow(ctx, `
		SELECT status, legal_name, rc_number, reviewer_note FROM public.stays_hotelier_kyb WHERE property_id = $1`,
		property).Scan(&status, &legal, &rc, &note); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if status != "needs_changes" || legal != "Submitted Ltd" || rc != "RC9999" || note != "CAC certificate is unreadable" {
		t.Errorf("unexpected row after decision: status=%s legal=%s rc=%s note=%q", status, legal, rc, note)
	}

	// The review queue must list it by status with sensitive fields masked.
	items, err := svc.repo.ListKYBQueue(ctx, "needs_changes")
	if err != nil {
		t.Fatalf("ListKYBQueue: %v", err)
	}
	var found *KYBQueueItem
	for i := range items {
		if items[i].PropertyID == property {
			found = &items[i]
		}
	}
	if found == nil {
		t.Fatal("decided property missing from the needs_changes queue")
	}
	if found.RCNumberMasked != "RC ••••9999" || found.DirectorBVNLast4 != "8901" {
		t.Errorf("queue item not masked as expected: %+v", *found)
	}
}
