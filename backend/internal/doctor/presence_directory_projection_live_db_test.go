package doctor

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Live-DB suite for the provider presence toggle's effect on the PATIENT side.
//
// The bug these pin: the doctor's own app reads doctor_profiles (GET /profile),
// and PUT /presence wrote ONLY that table. The patient-facing "Available now"
// rail is telemedicine ListDoctors, which selects d.is_online FROM doctors and
// adds `d.is_online = TRUE` under available_now
// (backend/internal/telemedicine/service.go:180,215). Nothing has ever set that
// column true — the approval projection (repository_mdcn_review.go:246) lists a
// doctor with is_available but never carries presence, doctors.is_online
// defaults to false, and the one statement that does write it
// (PATCH /telemedicine/doctor/availability) has no client caller at all. So a
// doctor could sit at "Online · Accepting instant" while every patient saw
// "0 online", forever and silently.
//
// The fixture below is the state approval actually leaves behind, so these tests
// fail on the real wire, not on a hand-made one. Runs only with
// TEST_DATABASE_URL set; owns and cleans its rows.

// livePresenceDB opens the same directory the patient list reads. Self-contained
// on purpose: this suite must compile and run without borrowing another file's
// fixtures.
func livePresenceDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping presence-projection live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type directoryPresence struct {
	online    bool
	available bool
}

// seedPublishedDoctor is an approved, listed doctor who is offline: what
// SetProfileVerification("approve") leaves in the two tables.
func seedPublishedDoctor(t *testing.T, pool *pgxpool.Pool) (userID, profileDoctorID string) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.NewString()
	profileDoctorID = uuid.NewString()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	exec(`INSERT INTO auth.users (id) VALUES ($1)`, userID)
	exec(`INSERT INTO doctor_profiles (user_id, name, specialty_id, fee_kobo, years_experience,
	                                   mdcn_number, verification, is_published, presence, is_online)
	      VALUES ($1,'Dr Ada Presence','cardiology',750000,9,'MDCN/LIVE/2','approved',true,'offline',false)`, userID)
	exec(`INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo, is_available, is_online)
	      VALUES ($1,$2,'Dr Ada Presence','cardiology',750000,true,false)`, profileDoctorID, userID)
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM doctors WHERE user_id = $1`,
			`DELETE FROM doctor_profiles WHERE user_id = $1`,
			`DELETE FROM auth.users WHERE id = $1`,
		} {
			_, _ = pool.Exec(context.Background(), q, userID)
		}
	})
	return userID, profileDoctorID
}

// seedUnlistedDoctor: approved and published in profile terms but with NO
// directory row — a doctor approved before the projection existed, or one the
// console has since delisted.
func seedUnlistedDoctor(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1)`, userID); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO doctor_profiles (user_id, name, verification, is_published, presence, is_online)
	                             VALUES ($1,'Dr Unlisted','approved',true,'offline',false)`, userID); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM doctors WHERE user_id = $1`,
			`DELETE FROM doctor_profiles WHERE user_id = $1`,
			`DELETE FROM auth.users WHERE id = $1`,
		} {
			_, _ = pool.Exec(context.Background(), q, userID)
		}
	})
	return userID
}

// readDirectoryPresence reads exactly the two flags the patient list filters on.
func readDirectoryPresence(t *testing.T, pool *pgxpool.Pool, userID string) (directoryPresence, bool) {
	t.Helper()
	var d directoryPresence
	err := pool.QueryRow(context.Background(),
		`SELECT is_online, is_available FROM doctors WHERE user_id=$1`, userID).
		Scan(&d.online, &d.available)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return directoryPresence{}, false
		}
		t.Fatalf("read directory presence: %v", err)
	}
	return d, true
}

func readProfilePresence(t *testing.T, pool *pgxpool.Pool, userID string) (string, bool) {
	t.Helper()
	var presence string
	var online bool
	err := pool.QueryRow(context.Background(),
		`SELECT presence, is_online FROM doctor_profiles WHERE user_id=$1`, userID).
		Scan(&presence, &online)
	if err != nil {
		t.Fatalf("read profile presence: %v", err)
	}
	return presence, online
}

func presenceService(pool *pgxpool.Pool) *Service {
	return NewService(pool, nil, nil, nil)
}

func setPresence(t *testing.T, pool *pgxpool.Pool, userID, presence string) error {
	t.Helper()
	return presenceService(pool).SetPresence(context.Background(), userID, PresenceRequest{Presence: presence})
}

// The patient rail: doctors.filter(d => d.isOnline) at
// app/services/telemedicine/index.tsx:32, i.e. the count the toggle must move.
func TestLiveDB_SetPresenceOnlineListsDoctorInPatientDirectory(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)

	if err := setPresence(t, pool, userID, "online"); err != nil {
		t.Fatalf("SetPresence: %v", err)
	}

	dir, ok := readDirectoryPresence(t, pool, userID)
	if !ok {
		t.Fatal("published doctor has no directory row")
	}
	if !dir.online {
		t.Error("directory is_online=false after the doctor went online — patients count 0 online while the provider app says Online")
	}
	_, profileOnline := readProfilePresence(t, pool, userID)
	if !profileOnline {
		t.Error("doctor_profiles.is_online disagrees with its own presence column")
	}
}

func TestLiveDB_SetPresenceOfflineRemovesDoctorFromOnlineRail(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)

	if err := setPresence(t, pool, userID, "online"); err != nil {
		t.Fatalf("SetPresence online: %v", err)
	}
	if err := setPresence(t, pool, userID, "offline"); err != nil {
		t.Fatalf("SetPresence offline: %v", err)
	}

	if dir, _ := readDirectoryPresence(t, pool, userID); dir.online {
		t.Error("directory is_online=true after the doctor went offline — a stale online row books a doctor who is away")
	}
	if presence, _ := readProfilePresence(t, pool, userID); presence != "offline" {
		t.Errorf("profile presence = %q, want offline", presence)
	}
}

// busy/away are not "online": doctors.is_online is the ONLY flag available_now
// filters on, so both must agree with the profile's own derivation
// (is_online = presence = 'online').
func TestLiveDB_SetPresenceBusyAndAwayAreNotOnlineAnywhere(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)

	for _, presence := range []string{"busy", "away"} {
		if err := setPresence(t, pool, userID, presence); err != nil {
			t.Fatalf("SetPresence %s: %v", presence, err)
		}
		if dir, _ := readDirectoryPresence(t, pool, userID); dir.online {
			t.Errorf("%s: directory is_online=true — the online rail would show a doctor who is %s", presence, presence)
		}
		if _, profileOnline := readProfilePresence(t, pool, userID); profileOnline {
			t.Errorf("%s: doctor_profiles.is_online=true", presence)
		}
	}
}

// doctors.is_available is the LISTING flag (approval sets it true, refusal and
// compliance suspension set it false), not a presence flag. Going offline must
// never delist: ListDoctors filters `d.is_available = TRUE` on every request.
func TestLiveDB_SetPresenceLeavesDirectoryListingAlone(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)

	for _, presence := range []string{"online", "offline", "away"} {
		if err := setPresence(t, pool, userID, presence); err != nil {
			t.Fatalf("SetPresence %s: %v", presence, err)
		}
		dir, _ := readDirectoryPresence(t, pool, userID)
		if !dir.available {
			t.Errorf("%s: directory is_available=false — toggling presence delisted the doctor", presence)
		}
	}
}

// Presence must not CREATE a directory row: an unlisted profile going online has
// nothing to list, and inserting one would bypass the review gate the row's
// existence stands for.
func TestLiveDB_SetPresenceNeverCreatesDirectoryRow(t *testing.T) {
	pool := livePresenceDB(t)
	userID := seedUnlistedDoctor(t, pool)

	if err := setPresence(t, pool, userID, "online"); err != nil {
		t.Fatalf("SetPresence for an unlisted doctor: %v", err)
	}
	if _, ok := readDirectoryPresence(t, pool, userID); ok {
		t.Error("going online created a patient-directory row for an unlisted doctor")
	}
	if _, online := readProfilePresence(t, pool, userID); !online {
		t.Error("the doctor's own profile did not record the presence change")
	}
}

func TestLiveDB_SetPresenceWithoutProfileStillReportsNotFound(t *testing.T) {
	pool := livePresenceDB(t)

	// No seed: the uuid belongs to nothing. Cleanup would find no rows either.
	if err := setPresence(t, pool, uuid.NewString(), "online"); !errors.Is(err, ErrNotFound) {
		t.Errorf("SetPresence err = %v, want ErrNotFound", err)
	}
}

// Suspension is enforced by doctors_block_when_suspended_trg (BEFORE UPDATE OF
// is_online) as well as by the compliance repo. The projection must not become
// the way around it.
func TestLiveDB_SetPresenceSuspendedDoctorStaysOfflineInDirectory(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)

	if _, err := pool.Exec(context.Background(),
		`UPDATE doctor_profiles SET verification='suspended' WHERE user_id=$1`, userID); err != nil {
		t.Fatalf("suspend fixture: %v", err)
	}

	if err := setPresence(t, pool, userID, "online"); err != nil {
		t.Fatalf("SetPresence: %v", err)
	}
	dir, _ := readDirectoryPresence(t, pool, userID)
	if dir.online {
		t.Error("a suspended doctor is online in the patient directory")
	}
}
