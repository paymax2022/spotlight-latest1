package compliance

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Live-DB suite: runs only with TEST_DATABASE_URL set, against a database that has
// the doctor/telemedicine schema. It creates (and removes) its own fixtures.

func liveDB(t *testing.T) (*pgxpool.Pool, *Repo) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping compliance live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool, NewRepo(pool)
}

type fixture struct {
	user string
}

// seedClinician inserts an approved, published, bookable clinician whose latest
// approved licence expires at expiry.
func seedClinician(t *testing.T, pool *pgxpool.Pool, expiry time.Time) fixture {
	t.Helper()
	ctx := context.Background()
	user := uuid.NewString()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	exec(`INSERT INTO auth.users (id) VALUES ($1)`, user)
	exec(`INSERT INTO doctor_profiles (user_id, name, verification, is_published, mdcn_number) VALUES ($1,'Dr Live Compliance','approved',true,'MDCN/LIVE')`, user)
	exec(`INSERT INTO doctors (user_id, name, specialty, consult_fee_kobo, is_available, is_online) VALUES ($1,'Dr Live Compliance','general',500000,true,true)`, user)
	exec(`INSERT INTO doctor_verifications (user_id, status, licence_expiry, mdcn_number, decided_at) VALUES ($1,'approved',$2,'MDCN/LIVE', now())`, user, expiry)
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM doctor_compliance_audit WHERE user_id = $1`,
			`DELETE FROM doctor_verifications WHERE user_id = $1`,
			`DELETE FROM doctors WHERE user_id = $1`,
			`DELETE FROM doctor_profiles WHERE user_id = $1`,
			`DELETE FROM auth.users WHERE id = $1`,
		} {
			_, _ = pool.Exec(context.Background(), q, user)
		}
	})
	return fixture{user: user}
}

func profileState(t *testing.T, pool *pgxpool.Pool, user string) (verification string, published, available, online bool) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `SELECT verification, is_published FROM doctor_profiles WHERE user_id=$1`, user).Scan(&verification, &published); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT is_available, is_online FROM doctors WHERE user_id=$1`, user).Scan(&available, &online); err != nil {
		t.Fatal(err)
	}
	return
}

func TestLive_SuspendDelistsAndAudits(t *testing.T) {
	pool, repo := liveDB(t)
	f := seedClinician(t, pool, time.Now().AddDate(1, 0, 0))
	ctx := context.Background()

	if _, err := repo.Reinstate(ctx, f.user, "admin-1", "not suspended yet", time.Now()); !errors.Is(err, ErrNotSuspended) {
		t.Fatalf("reinstating an approved clinician = %v, want ErrNotSuspended", err)
	}
	ch, err := repo.Suspend(ctx, f.user, "admin-1", "licence under investigation")
	if err != nil || ch.Status != StatusSuspended || ch.AuditID == "" {
		t.Fatalf("Suspend: %+v %v", ch, err)
	}
	v, pub, avail, online := profileState(t, pool, f.user)
	if v != "suspended" || pub || avail || online {
		t.Fatalf("after suspend: verification=%s published=%v available=%v online=%v", v, pub, avail, online)
	}
	var listed int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM doctors WHERE is_available = TRUE AND user_id = $1`, f.user).Scan(&listed); err != nil || listed != 0 {
		t.Fatalf("suspended clinician still on the patient list: %d %v", listed, err)
	}
	if _, err := repo.Suspend(ctx, f.user, "admin-1", "again"); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("double suspend = %v, want ErrNotApproved", err)
	}

	page, err := repo.Audit(ctx, AuditFilter{UserID: f.user, Action: ActionSuspend}, 10, 0)
	if err != nil || page.Total != 1 || string(page.Items[0].Detail) == "" {
		t.Fatalf("audit: %+v %v", page, err)
	}
	sus, err := repo.Suspended(ctx, 200, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, s := range sus.Items {
		if s.UserID == f.user {
			found = true
			if s.SuspendedBy == nil || *s.SuspendedBy != "admin" || s.Reason == nil || *s.Reason != "licence under investigation" {
				t.Fatalf("suspended row: %+v", s)
			}
		}
	}
	if !found {
		t.Fatal("suspended clinician missing from Suspended()")
	}

	// Reinstate: restores profile, leaves availability off for the clinician to re-enable.
	if _, err := repo.Reinstate(ctx, f.user, "admin-1", "cleared after review", time.Now()); err != nil {
		t.Fatalf("Reinstate: %v", err)
	}
	v, pub, avail, _ = profileState(t, pool, f.user)
	if v != "approved" || !pub || avail {
		t.Fatalf("after reinstate: verification=%s published=%v available=%v", v, pub, avail)
	}
}

func TestLive_ReinstateRefusedWhileLicenceExpired(t *testing.T) {
	pool, repo := liveDB(t)
	f := seedClinician(t, pool, time.Now().AddDate(0, 0, -5))
	ctx := context.Background()
	if _, err := repo.Suspend(ctx, f.user, "admin-1", "licence expired"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Reinstate(ctx, f.user, "admin-1", "please", time.Now()); !errors.Is(err, ErrLicenceExpired) {
		t.Fatalf("Reinstate = %v, want ErrLicenceExpired", err)
	}
	if v, _, _, _ := profileState(t, pool, f.user); v != "suspended" {
		t.Fatalf("refused reinstate must leave the clinician suspended, got %s", v)
	}
}

func TestLive_SuspendUnknownAndProfileless(t *testing.T) {
	pool, repo := liveDB(t)
	ctx := context.Background()
	if _, err := repo.Suspend(ctx, uuid.NewString(), "admin-1", "no such clinician"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown clinician = %v, want ErrNotFound", err)
	}
	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1)`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO doctors (user_id, name, specialty, consult_fee_kobo) VALUES ($1,'Dr Profileless','general',500000)`, user); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM doctors WHERE user_id=$1`, user)
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, user)
	})
	if _, err := repo.Suspend(ctx, user, "admin-1", "no profile to flag"); !errors.Is(err, ErrNoProfile) {
		t.Fatalf("profile-less clinician = %v, want ErrNoProfile (fail closed)", err)
	}
}

func TestLive_SuspensionGuardBlocksSelfReEnable(t *testing.T) {
	pool, repo := liveDB(t)
	var hasGuard bool
	_ = pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='doctors_block_when_suspended_trg')`).Scan(&hasGuard)
	if !hasGuard {
		t.Skip("migration 20271099000090_telemedicine_suspension_guard not applied")
	}
	f := seedClinician(t, pool, time.Now().AddDate(1, 0, 0))
	ctx := context.Background()
	if _, err := repo.Suspend(ctx, f.user, "admin-1", "guard check"); err != nil {
		t.Fatal(err)
	}
	// The exact statement ToggleDoctorAvailability runs.
	if _, err := pool.Exec(ctx, `UPDATE doctors SET is_online=true, is_available=true WHERE user_id=$1`, f.user); err != nil {
		t.Fatal(err)
	}
	if _, _, avail, online := profileState(t, pool, f.user); avail || online {
		t.Fatalf("suspended clinician re-enabled themselves: available=%v online=%v", avail, online)
	}
}

func TestLive_ReadModels(t *testing.T) {
	pool, repo := liveDB(t)
	f := seedClinician(t, pool, time.Now().AddDate(0, 0, 20))
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO doctor_mandatory_training (user_id, module_id, title, status) VALUES ($1,'live-m1','Data protection','pending')`, f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO doctor_quality_scores (user_id, score, period_label) VALUES ($1, 42.5, 'live')`, f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO doctor_record_access_log (user_id, patient_id, action) VALUES ($1,'cccccccc-1111-2222-3333-444444444444','view')`, f.user); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM doctor_mandatory_training WHERE user_id=$1`,
			`DELETE FROM doctor_quality_scores WHERE user_id=$1`,
			`DELETE FROM doctor_record_access_log WHERE user_id=$1`,
		} {
			_, _ = pool.Exec(context.Background(), q, f.user)
		}
	})

	sum, err := repo.Summary(ctx)
	if err != nil || sum.LicencesExpiring30d < 1 || sum.TrainingPending < 1 {
		t.Fatalf("Summary: %+v %v", sum, err)
	}
	lic, err := repo.Licences(ctx, "30d", "Dr Live Compliance", 50, 0)
	if err != nil || lic.Total != 1 || lic.Items[0].Bucket != "30d" || lic.Items[0].DaysToExpiry < 19 {
		t.Fatalf("Licences: %+v %v", lic, err)
	}
	if none, err := repo.Licences(ctx, "expired", "Dr Live Compliance", 50, 0); err != nil || none.Total != 0 {
		t.Fatalf("expired bucket should be empty: %+v %v", none, err)
	}
	if _, err := repo.Licences(ctx, "bogus", "", 50, 0); !errors.Is(err, ErrValidation) {
		t.Fatalf("bogus bucket = %v", err)
	}
	tr, err := repo.Training(ctx, "pending", 200, 0)
	if err != nil || tr.Total < 1 {
		t.Fatalf("Training: %+v %v", tr, err)
	}
	q, err := repo.Quality(ctx, 200, 0)
	if err != nil || q.Total < 1 {
		t.Fatalf("Quality: %+v %v", q, err)
	}
	ra, err := repo.RecordAccess(ctx, f.user, "", 50, 0)
	if err != nil || ra.Total != 1 || ra.Items[0].PatientRef == nil || *ra.Items[0].PatientRef != "cccccccc..." {
		t.Fatalf("RecordAccess must return a masked patient ref only: %+v %v", ra, err)
	}
	if _, err := repo.DocAccess(ctx, 50, 0); err != nil {
		t.Fatalf("DocAccess: %v", err)
	}
}
