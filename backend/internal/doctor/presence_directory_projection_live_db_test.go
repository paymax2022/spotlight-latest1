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
// column true — SetProfileVerification (repository_mdcn_review.go:179) writes only
// doctor_profiles, so the directory row's is_available comes from RegisterDoctor
// (service.go:133) while doctors.is_online keeps the FALSE default its row was
// born with, and the one statement that does write it (ToggleDoctorAvailability,
// service.go:269) has no client caller at all. So a doctor could sit at
// "Online · Accepting instant" while every patient saw "0 online", forever and
// silently.
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

// ── reconcile_doctors_presence() ───────────────────────────────────────────
// The projection in SetPresence is forward-only: a doctor who was already at
// presence='online' when it shipped keeps the doctors.is_online=false default
// their row was born with, so the patient rail stays short until they happen to
// toggle. reconcile_doctors_presence() repairs those rows. It is not in a
// hand-written migration body because a bare UPDATE cannot be asserted on: the
// function is what makes the repair testable, and what an operator can re-run.

// staleOnlineDirectory simulates the shipped state: the profile says online, the
// directory row says offline, and nothing has projected since.
func staleOnlineDirectory(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`UPDATE doctor_profiles SET presence='online', is_online=true WHERE user_id=$1`, userID)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
}

func reconcile(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var repaired int
	if err := pool.QueryRow(context.Background(),
		`SELECT public.reconcile_doctors_presence()`).Scan(&repaired); err != nil {
		t.Fatalf("reconcile_doctors_presence(): %v", err)
	}
	return repaired
}

// repairWouldChange evaluates the repair's own predicate for ONE doctor, which is
// what the returned count is supposed to measure. Asserted per row because the
// count is global and a shared dev database holds other authors' fixtures: state
// can look settled while the predicate still matches, and that gap is precisely
// the suspended-doctors-online row below.
//
// A suspended profile is excluded on purpose. Its directory flags are forced false
// by doctors_block_when_suspended, not derived from presence, so "disagrees with
// presence" is the correct steady state for it — the repair must leave it alone.
func repairWouldChange(t *testing.T, pool *pgxpool.Pool, userID string) bool {
	t.Helper()
	var matches bool
	err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (
		    SELECT 1
		    FROM doctors d
		    JOIN doctor_profiles p ON p.user_id = d.user_id
		    WHERE d.user_id = $1
		      AND p.verification <> 'suspended'
		      AND d.is_online IS DISTINCT FROM (p.presence = 'online')
		)`, userID).Scan(&matches)
	if err != nil {
		t.Fatalf("repair predicate: %v", err)
	}
	return matches
}

func TestLiveDB_ReconcilePresenceListsAnOnlineDoctorTheProjectionMissed(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)
	staleOnlineDirectory(t, pool, userID)

	if !repairWouldChange(t, pool, userID) {
		t.Fatal("fixture is not stale by the repair's own predicate — the repair this test proves would be unobservable")
	}

	// Lower-bounded, not exact: the count covers every stale row in the database,
	// and this fixture must appear in it. A function whose body silently stopped
	// matching anything would otherwise pass on state alone.
	if n := reconcile(t, pool); n < 1 {
		t.Errorf("reconcile_doctors_presence() reported %d rows repaired with at least one stale row present", n)
	}

	dir, ok := readDirectoryPresence(t, pool, userID)
	if !ok {
		t.Fatal("the doctor's directory row vanished")
	}
	if !dir.online {
		t.Error("directory is_online=false after the repair, though the profile presence is online")
	}
	if !dir.available {
		t.Error("the repair changed the listing flag — it owns presence only")
	}
	if repairWouldChange(t, pool, userID) {
		t.Error("the row still matches the repair's predicate after being repaired")
	}
}

// The repair is bidirectional: a directory row left true by the old
// ToggleDoctorAvailability path must stop advertising a doctor who is now away.
func TestLiveDB_ReconcilePresenceUnlistsAStaleOnlineRow(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)

	if _, err := pool.Exec(context.Background(),
		`UPDATE doctors SET is_online=true WHERE user_id=$1`, userID); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE doctor_profiles SET presence='away', is_online=false WHERE user_id=$1`, userID); err != nil {
		t.Fatalf("fixture: %v", err)
	}

	if n := reconcile(t, pool); n < 1 {
		t.Errorf("reconcile_doctors_presence() reported %d rows repaired with at least one stale row present", n)
	}

	if dir, _ := readDirectoryPresence(t, pool, userID); dir.online {
		t.Error("directory is_online=true for a doctor whose presence is away")
	}
	if dir, _ := readDirectoryPresence(t, pool, userID); !dir.available {
		t.Error("taking a stale-online doctor off the rail delisted them")
	}
	if repairWouldChange(t, pool, userID) {
		t.Error("the row still matches the repair's predicate after being repaired")
	}
}

// Re-running must settle, not wander. The row is asserted against the repair's own
// predicate as well as its flags: state alone can look settled while the predicate
// still matches, which leaves the function counting the same row on every pass.
func TestLiveDB_ReconcilePresenceSecondPassChangesNothing(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)
	staleOnlineDirectory(t, pool, userID)

	reconcile(t, pool)
	first, _ := readDirectoryPresence(t, pool, userID)
	if repairWouldChange(t, pool, userID) {
		t.Fatalf("the first pass left the row matching the repair's predicate: %+v", first)
	}

	reconcile(t, pool)
	second, _ := readDirectoryPresence(t, pool, userID)

	if first != second {
		t.Errorf("directory row moved from %+v to %+v on a repair that had nothing left to fix", first, second)
	}
	if !second.online {
		t.Error("the second pass dropped an online doctor off the rail")
	}
}

// A profile with no directory row must stay that way: inserting one here would list
// a doctor nobody approved. The repair joins on user_id, so it matches nothing.
func TestLiveDB_ReconcilePresenceNeverCreatesDirectoryRow(t *testing.T) {
	pool := livePresenceDB(t)
	userID := seedUnlistedDoctor(t, pool)
	staleOnlineDirectory(t, pool, userID)

	reconcile(t, pool)

	if _, ok := readDirectoryPresence(t, pool, userID); ok {
		t.Error("the repair created a patient-directory row for an unlisted doctor")
	}
	if presence, online := readProfilePresence(t, pool, userID); presence != "online" || !online {
		t.Errorf("the repair changed the profile itself (%q, online=%v) — it owns doctors rows only", presence, online)
	}
}

// Presence must never be the way around a suspension, and the repair must not
// become one either. A suspended profile CAN hold presence='online': the licence
// auto-suspend sweep (repository_mdcn_review.go:238) writes verification +
// is_published only, and PUT /presence (handler_account_tail.go:325) has no
// suspension guard, so a doctor suspended while online keeps saying online.
//
// The directory row must stay offline AND keep its listing flag. Writing it would
// fire doctors_block_when_suspended, which forces is_available false as a
// side effect of any is_online write — so a repair that "just" sets presence here
// silently delists the doctor, the one thing this migration disclaims. The row is
// therefore skipped outright, not written to false.
func TestLiveDB_ReconcilePresenceNeverOnlinesASuspendedDoctor(t *testing.T) {
	pool := livePresenceDB(t)
	userID, _ := seedPublishedDoctor(t, pool)
	staleOnlineDirectory(t, pool, userID)

	if _, err := pool.Exec(context.Background(),
		`UPDATE doctor_profiles SET verification='suspended' WHERE user_id=$1`, userID); err != nil {
		t.Fatalf("suspend fixture: %v", err)
	}
	before, ok := readDirectoryPresence(t, pool, userID)
	if !ok {
		t.Fatal("no directory row to protect")
	}
	if before.online || !before.available {
		t.Fatalf("fixture is not a suspended-but-listed doctor: %+v", before)
	}

	reconcile(t, pool)

	dir, _ := readDirectoryPresence(t, pool, userID)
	if dir.online {
		t.Error("the repair put a suspended doctor in the patient online rail")
	}
	if !dir.available {
		t.Errorf("the repair delisted a suspended doctor (%+v → %+v): it wrote the row, so doctors_block_when_suspended forced is_available false", before, dir)
	}
}
