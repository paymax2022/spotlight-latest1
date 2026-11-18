package preconsult

// LIVE-DB integration test for the M2 consent write on the pre-consult draft save
// (backend/internal/health/preconsult/service.go SaveDraft).
//
// The wizard will not open the questionnaire until the bundle reports the ACTIVE
// consent version as accepted on the intake row, so this write IS the patient's
// "I agree" and has to be durable. Two failure modes it pins:
//   - a SaveDraft that accepted answers but silently dropped consent_version left
//     every patient looping back at M2 forever, with no way to reach the questions;
//   - a SaveDraft that stored whatever version the client sent would record
//     agreement to consent text the patient was never shown (Submit would only
//     discover the mismatch later, after the patient had already "agreed").
//
// Skipped unless TEST_DATABASE_URL is set, and unless the migration-seeded
// pre-consult schema + PRE_CONSULT_INTAKE consent rows exist. This test READS those
// shared seeds; it never writes, deactivates, or deletes them.
// Bring-up:
//	supabase start
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/preconsult/ -run TestSaveDraft_Consent_LiveDB

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthconsult "spotlight/backend/internal/health/consult"
	healthintake "spotlight/backend/internal/health/intake"
	"spotlight/backend/internal/testsupport"
)

func consentLiveService(t *testing.T) (*Service, *pgxpool.Pool, int) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB consent draft test; see bring-up note in consent_draft_live_db_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM health_intake_schemas WHERE slug=$1 AND active=true`, SchemaSlug,
	).Scan(&n); err != nil || n == 0 {
		t.Skipf("no active %q intake schema row (apply the pre-consult migrations): err=%v", SchemaSlug, err)
	}
	var activeVersion int
	if err := pool.QueryRow(ctx,
		`SELECT version FROM health_consent_version
		 WHERE consent_key='PRE_CONSULT_INTAKE' AND active=true AND locale='en'
		 ORDER BY version DESC LIMIT 1`,
	).Scan(&activeVersion); err != nil {
		t.Skipf("no active PRE_CONSULT_INTAKE consent row (apply the pre-consult migrations): %v", err)
	}

	svc := NewService(pool, healthintake.NewService(pool, nil), healthconsult.NewService(pool, "test-av-key", nil), nil)
	return svc, pool, activeVersion
}

type liveAppointment struct {
	apptID    string
	patientID string
}

// seedIntakeAppointment creates a CONFIRMED telemedicine appointment for a freshly
// seeded patient + provider owner, and registers teardown.
func seedIntakeAppointment(t *testing.T, pool *pgxpool.Pool) liveAppointment {
	t.Helper()
	ctx := context.Background()
	a := liveAppointment{apptID: uuid.New().String(), patientID: uuid.New().String()}
	ownerID := uuid.New().String()
	providerID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, a.patientID, a.patientID+"@seed.test")
	testsupport.CleanupUser(t, pool, a.patientID)
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ownerID, ownerID+"@seed.test")
	testsupport.CleanupUser(t, pool, ownerID)
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Intake Clinic','APPROVED')`, providerID, ownerID)
	start := time.Now().UTC()
	seed(`INSERT INTO public.health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
	      VALUES ($1,$2,$3,'PATIENT','TELE','CONFIRMED',$4,$5)`, a.apptID, providerID, a.patientID, start, start.Add(30*time.Minute))

	t.Cleanup(func() {
		bg := context.WithoutCancel(ctx)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_preconsult_intake WHERE appointment_id=$1`, a.apptID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE appointment_id=$1`, a.apptID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_appointments WHERE id=$1`, a.apptID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
	})
	return a
}

// dbConsent reads the consent columns straight off the link row, so an assertion can
// never be satisfied by whatever the service happened to hand back in memory.
func dbConsent(t *testing.T, pool *pgxpool.Pool, apptID string) (*int, *time.Time, string) {
	t.Helper()
	var v *int
	var at *time.Time
	var draft string
	if err := pool.QueryRow(context.Background(),
		`SELECT consent_version, consent_at, draft_json::text
		   FROM health_preconsult_intake WHERE appointment_id=$1`, apptID,
	).Scan(&v, &at, &draft); err != nil {
		t.Fatalf("read back consent: %v", err)
	}
	return v, at, draft
}

func ptrInt(i int) *int { return &i }

func TestSaveDraft_Consent_LiveDB(t *testing.T) {
	svc, pool, activeVersion := consentLiveService(t)
	ctx := context.Background()
	a := seedIntakeAppointment(t, pool)

	// 1. A plain autosave records the answers and records NO agreement: the patient
	//    has not ticked the box yet, so the bundle must still show M2 as unaccepted.
	it, err := svc.SaveDraft(ctx, a.patientID, a.apptID, map[string]any{"reason_for_visit": "headache"}, nil)
	if err != nil {
		t.Fatalf("autosave: %v", err)
	}
	if it.ConsentVersion != nil {
		t.Fatalf("a bare autosave must not record consent, got version %d", *it.ConsentVersion)
	}
	if v, at, draft := dbConsent(t, pool, a.apptID); v != nil || at != nil {
		t.Fatalf("link row must hold no consent after autosave, got version=%v at=%v", v, at)
	} else if !strings.Contains(draft, "headache") {
		t.Fatalf("autosave did not persist draft_json, got %s", draft)
	}

	// 2. Saving the ACTIVE version is the patient's "I agree" — it persists, and the
	//    returned row (what the bundle surfaces as consent.acceptedVersion) says so.
	agree := map[string]any{"reason_for_visit": "headache", "symptom_onset": "few_days"}
	it, err = svc.SaveDraft(ctx, a.patientID, a.apptID, agree, ptrInt(activeVersion))
	if err != nil {
		t.Fatalf("consent save: %v", err)
	}
	if it.ConsentVersion == nil || *it.ConsentVersion != activeVersion {
		t.Fatalf("intake should report the accepted version %d, got %+v", activeVersion, it.ConsentVersion)
	}
	v, at, _ := dbConsent(t, pool, a.apptID)
	if v == nil || *v != activeVersion {
		t.Fatalf("consent_version not persisted: %v", v)
	}
	if at == nil {
		t.Fatal("consent_at not stamped — the agreement has no timestamp")
	}

	// 3. The wizard autosaves on every keystroke AFTER the tick. COALESCE must keep
	//    the agreement it just recorded rather than wiping it back to NULL.
	if _, err = svc.SaveDraft(ctx, a.patientID, a.apptID, map[string]any{"reason_for_visit": "headache, worse at night"}, nil); err != nil {
		t.Fatalf("post-consent autosave: %v", err)
	}
	v, at, draft := dbConsent(t, pool, a.apptID)
	if v == nil || *v != activeVersion {
		t.Fatalf("autosave wiped the recorded consent version: %v", v)
	}
	if at == nil {
		t.Fatal("autosave wiped consent_at")
	}
	if !strings.Contains(draft, "worse at night") {
		t.Fatalf("autosave did not overwrite draft_json, got %s", draft)
	}

	// 4. A version that is not the active one is refused — and the refused write must
	//    not have landed either the bogus agreement or its answers.
	bogus := activeVersion + 1
	_, err = svc.SaveDraft(ctx, a.patientID, a.apptID, map[string]any{"reason_for_visit": "SHOULD NOT PERSIST"}, ptrInt(bogus))
	if err == nil {
		t.Fatalf("a stale client must not be able to record agreement to consent v%d (active is v%d)", bogus, activeVersion)
	}
	v, _, draft = dbConsent(t, pool, a.apptID)
	if v == nil || *v != activeVersion {
		t.Fatalf("refused save changed the accepted consent version to %v", v)
	}
	if strings.Contains(draft, "SHOULD NOT PERSIST") {
		t.Fatal("refused save still wrote draft_json — the guard ran after the write")
	}
}
