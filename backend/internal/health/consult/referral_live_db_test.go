package healthconsult

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// TM-007 live-DB integration test: a clinician generates a referral from a consult;
// only the provider may issue it; participants (not strangers) can read it.
//
// SKIPPED whenever TEST_DATABASE_URL is unset. Bring-up:
//
//	supabase start
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/consult/ -run TestReferral_LiveDB

func referralLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB consult referral test; see bring-up note in referral_live_db_test.go")
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

func TestReferral_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := referralLivePool(t)
	svc := NewService(pool, "test-av-key", nil)

	patientID := uuid.New().String()
	providerOwnerID := uuid.New().String()
	providerID := uuid.New().String()
	consultID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patientID, patientID+"@seed.test")
	testsupport.CleanupUser(t, pool, patientID)
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, providerOwnerID, providerOwnerID+"@seed.test")
	testsupport.CleanupUser(t, pool, providerOwnerID)
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Clinic','APPROVED')`, providerID, providerOwnerID)
	seed(`INSERT INTO public.health_consults (id, provider_id, patient_id, state, recording_enabled)
	      VALUES ($1,$2,$3,'IN_PROGRESS',false)`, consultID, providerID, patientID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, consultID) // cascades referrals
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, providerOwnerID)
	})

	// A non-provider may not issue a referral.
	if _, err := svc.CreateReferral(ctx, patientID, consultID, ReferralInput{Type: ReferralInPerson, Reason: "x"}); err == nil {
		t.Fatal("only the provider may issue a referral")
	}

	// The provider issues a specialty referral.
	r, err := svc.CreateReferral(ctx, providerOwnerID, consultID, ReferralInput{
		Type: ReferralSpecialty, Specialty: "Cardiology", Reason: "systolic murmur, refer for echo",
	})
	if err != nil {
		t.Fatalf("provider referral must succeed: %v", err)
	}
	if r.Type != ReferralSpecialty || r.Specialty != "Cardiology" || r.PatientID != patientID {
		t.Fatalf("referral fields not persisted as expected: %+v", r)
	}

	// The patient can read the referral; a stranger cannot.
	if refs, err := svc.Referrals(ctx, patientID, consultID, false); err != nil || len(refs) != 1 {
		t.Fatalf("patient must read 1 referral, got %d err=%v", len(refs), err)
	}
	if _, err := svc.Referrals(ctx, uuid.New().String(), consultID, false); err == nil {
		t.Fatal("a non-participant must not read referrals")
	}
}
