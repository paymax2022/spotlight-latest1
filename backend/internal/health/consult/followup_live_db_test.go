package healthconsult

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TM-008 live-DB integration test: a provider schedules a follow-up from an
// in-progress consult; the new consult is SCHEDULED and LINKED to the parent (and,
// when supplied, to a referral on that parent). A non-provider cannot schedule one,
// and a follow-up cannot be scheduled before the consult starts.
//
// SKIPPED whenever TEST_DATABASE_URL is unset. Bring-up:
//
//	supabase start
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/consult/ -run TestFollowUp_LiveDB

func followUpLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB consult follow-up test; see bring-up note in followup_live_db_test.go")
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

func TestFollowUp_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := followUpLivePool(t)
	svc := NewService(pool, "test-av-key", nil)

	patientID := uuid.New().String()
	providerOwnerID := uuid.New().String()
	providerID := uuid.New().String()
	parentID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, providerOwnerID, providerOwnerID+"@seed.test")
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Clinic','APPROVED')`, providerID, providerOwnerID)
	seed(`INSERT INTO public.health_consults (id, provider_id, patient_id, state, recording_enabled)
	      VALUES ($1,$2,$3,'IN_PROGRESS',false)`, parentID, providerID, patientID)

	// Track follow-up consults created so cleanup removes children before the parent.
	var followUpIDs []string
	t.Cleanup(func() {
		bg := context.Background()
		for _, id := range followUpIDs {
			_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, id)
		}
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, parentID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, providerOwnerID)
	})

	// A non-provider may not schedule a follow-up.
	if _, err := svc.ScheduleFollowUp(ctx, patientID, parentID, FollowUpInput{}); err == nil {
		t.Fatal("only the provider may schedule a follow-up")
	}

	// The provider schedules a follow-up tied to a referral generated on this consult.
	ref, err := svc.CreateReferral(ctx, providerOwnerID, parentID, ReferralInput{
		Type: ReferralInPerson, Reason: "review in two weeks",
	})
	if err != nil {
		t.Fatalf("seed referral: %v", err)
	}
	fu, err := svc.ScheduleFollowUp(ctx, providerOwnerID, parentID, FollowUpInput{ReferralID: &ref.ID})
	if err != nil {
		t.Fatalf("provider follow-up must succeed: %v", err)
	}
	followUpIDs = append(followUpIDs, fu.ID)

	if fu.State != StateScheduled || fu.ParentConsultID == nil || *fu.ParentConsultID != parentID {
		t.Fatalf("follow-up must be SCHEDULED and linked to the parent, got %+v", fu)
	}
	if fu.PatientID != patientID || fu.ProviderID != providerID {
		t.Fatalf("follow-up must carry the same patient/provider, got %+v", fu)
	}

	// The link is persisted (readable back via load()).
	got, _, err := svc.load(ctx, fu.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ParentConsultID == nil || *got.ParentConsultID != parentID || got.ReferralID == nil || *got.ReferralID != ref.ID {
		t.Fatalf("persisted follow-up must link parent + referral, got %+v", got)
	}

	// A referral that does not belong to the parent consult is rejected.
	otherRef := uuid.New().String()
	if _, err := svc.ScheduleFollowUp(ctx, providerOwnerID, parentID, FollowUpInput{ReferralID: &otherRef}); err == nil {
		t.Fatal("a referral not on this consult must be rejected")
	}
}
