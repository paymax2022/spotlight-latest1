package healthlab

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LR-006 live-DB integration test for the versioned lab-result amendment.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (same env-gate as the
// FX / crypto live-DB suites). Bring-up:
//
//	supabase start   # or any Postgres with the migrations applied
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/lab/ -run TestAmendResult_LiveDB
//
// It seeds a minimal RELEASED order with one NORMAL result, then amends it to a
// CRITICAL corrected value and asserts the never-destructive version chain:
//   - a NEW row at version 2 carries the correction (returned + read as latest),
//   - the prior version 1 row is RETAINED unchanged and marked superseded,
//   - loadResults surfaces only the current version,
//   - the corrected critical result re-notifies the patient/clinician (HL-7).

func amendLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB lab amendment test; see bring-up note in amend_live_db_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// amendFakeProv is a verified-scientist gate that always approves.
type amendFakeProv struct{}

func (amendFakeProv) IsApprovedLab(context.Context, string) (bool, error) { return true, nil }
func (amendFakeProv) VerifiedLabOwner(context.Context, string, string) (bool, error) {
	return true, nil
}
func (amendFakeProv) IsVerifiedScientist(context.Context, string, string) (bool, error) {
	return true, nil
}
func (amendFakeProv) IsVerifiedPhlebotomist(context.Context, string, string) (bool, error) {
	return true, nil
}

// amendFakeNotify records the HL-7 human-escalation calls.
type amendFakeNotify struct {
	calls      int
	lastStatus string
}

func (n *amendFakeNotify) NotifyCriticalResult(_ context.Context, _, _, status string) error {
	n.calls++
	n.lastStatus = status
	return nil
}

func TestAmendResult_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := amendLivePool(t)

	patientID := uuid.New().String()
	scientistID := uuid.New().String()
	providerID := uuid.New().String()
	testID := uuid.New().String()
	orderID := uuid.New().String()
	priorResultID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, scientistID, scientistID+"@seed.test")
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'LAB','lab','Seed Lab','APPROVED')`, providerID, scientistID)
	seed(`INSERT INTO public.lab_tests (id, lab_provider_id, name, price_kobo) VALUES ($1,$2,'Widget Panel',150000)`, testID, providerID)
	seed(`INSERT INTO public.lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
	      VALUES ($1,$2,$3,'RELEASED','WALK_IN',150000,$4)`, orderID, patientID, providerID, "idem-"+orderID)
	// The original released result: NORMAL, value 5.0.
	seed(`INSERT INTO public.lab_results
	        (id, order_id, test_id, test_name, value, unit, ref_range, status, validated_by, version, released_by, released_at)
	      VALUES ($1,$2,$3,'Widget Panel','5.0','x','0-6','NORMAL',$4,1,$4,now())`,
		priorResultID, orderID, testID, scientistID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.lab_results WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.lab_orders WHERE id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.lab_tests WHERE id=$1`, testID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, scientistID)
	})

	notify := &amendFakeNotify{}
	// escrow/dispatch/payout/vault/audit are unused by AmendResult → nil.
	svc := NewService(pool, nil, nil, amendFakeProv{}, nil, notify, nil, nil)

	// Guard: an amendment must state why.
	if _, err := svc.AmendResult(ctx, scientistID, orderID, AmendResultInput{TestID: testID, Value: "9.9", Status: ResultCritical}); err != ErrNoAmendmentReason {
		t.Fatalf("empty reason should be rejected with ErrNoAmendmentReason, got %v", err)
	}

	// Amend the released result to a CRITICAL corrected value.
	got, err := svc.AmendResult(ctx, scientistID, orderID, AmendResultInput{
		TestID:   testID,
		Value:    "9.9",
		Unit:     "x",
		RefRange: "0-6",
		Status:   ResultCritical,
		Reason:   "instrument recalibration — original run invalid",
	})
	if err != nil {
		t.Fatalf("AmendResult: %v", err)
	}
	if got.Version != 2 || got.Value != "9.9" || got.Status != ResultCritical {
		t.Fatalf("amended result = v%d %q [%s], want v2 \"9.9\" [CRITICAL]", got.Version, got.Value, got.Status)
	}
	if got.ID == priorResultID {
		t.Fatal("amendment must be a NEW row, not the same id as the prior version")
	}

	// loadResults surfaces ONLY the current version.
	latest, err := svc.loadResults(ctx, orderID)
	if err != nil {
		t.Fatal(err)
	}
	if len(latest) != 1 {
		t.Fatalf("loadResults must return only the current version, got %d rows", len(latest))
	}
	if latest[0].Version != 2 || latest[0].Value != "9.9" || latest[0].Status != ResultCritical {
		t.Fatalf("current result = v%d %q [%s], want v2 \"9.9\" [CRITICAL]", latest[0].Version, latest[0].Value, latest[0].Status)
	}

	// The prior version is RETAINED unchanged and marked superseded (never mutated).
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.lab_results WHERE order_id=$1`, orderID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("both versions must be retained, got %d rows", count)
	}
	var priorValue, priorStatus string
	var supersededBy *string
	if err := pool.QueryRow(ctx, `SELECT value, status, superseded_by FROM public.lab_results WHERE id=$1`, priorResultID).
		Scan(&priorValue, &priorStatus, &supersededBy); err != nil {
		t.Fatal(err)
	}
	if priorValue != "5.0" || priorStatus != "NORMAL" {
		t.Fatalf("prior version must be retained unchanged, got %q [%s]", priorValue, priorStatus)
	}
	if supersededBy == nil || *supersededBy != got.ID {
		t.Fatalf("prior version must point at the amending version %s, got %v", got.ID, supersededBy)
	}

	// HL-7: the corrected critical result re-notified the patient/clinician.
	if notify.calls != 1 || notify.lastStatus != "CRITICAL" {
		t.Fatalf("critical amendment must re-notify once with CRITICAL, got calls=%d status=%q", notify.calls, notify.lastStatus)
	}
}
