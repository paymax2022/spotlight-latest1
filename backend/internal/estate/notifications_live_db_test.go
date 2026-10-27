package estate

// LIVE-DB UAT for the estate notification layer (service_extras.go notify) and
// its emission points — covers EST-UAT-0348 (visitor arrival alert on gate
// scan/check-in), EST-UAT-0350 (overdue-invoice arrears reminder from the
// maintenance job), EST-UAT-0355 (queue-replay dedupe) and EST-UAT-0357
// (member notification preferences with safety/legal override).
// Follows meetings_live_db_test.go conventions: TEST_DATABASE_URL-gated,
// package `estate` so notify() is reachable directly.
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/ -run 'TestLiveDB_Notify|TestLiveDB_Scan|TestLiveDB_CheckIn|TestLiveDB_Maintenance' -v

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func notifCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT count(*) FROM estate_notifications WHERE user_id=$1`, userID).Scan(&n); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	return n
}

func setMemberSetting(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, userID, col string, val bool) {
	t.Helper()
	// col is a test-local literal — never external input.
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO estate_member_settings (estate_id, user_id, `+col+`)
		 VALUES ($1,$2,$3)
		 ON CONFLICT (estate_id, user_id) DO UPDATE SET `+col+`=EXCLUDED.`+col,
		estateID, userID, val); err != nil {
		t.Fatalf("set member setting %s: %v", col, err)
	}
}

// TestLiveDB_Notify_PreferenceGateAndSafetyOverride — EST-UAT-0357.
func TestLiveDB_Notify_PreferenceGateAndSafetyOverride(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	// Mute announcements: the notice must be suppressed entirely.
	setMemberSetting(t, ctx, pool, estateID, resident, "notify_announcements", false)
	before := notifCount(t, ctx, pool, resident)
	svc.notify(ctx, estateID, resident, NotifAnnouncement, "Estate notice", "AGM this Saturday", nil)
	if got := notifCount(t, ctx, pool, resident); got != before {
		t.Fatalf("muted announcement was delivered: rows %d → %d", before, got)
	}

	// Unmute → delivers again.
	setMemberSetting(t, ctx, pool, estateID, resident, "notify_announcements", true)
	svc.notify(ctx, estateID, resident, NotifAnnouncement, "Estate notice", "Water maintenance Tuesday", nil)
	if got := notifCount(t, ctx, pool, resident); got != before+1 {
		t.Fatalf("unmuted announcement not delivered: rows %d, want %d", got, before+1)
	}

	// Safety override: even with notify_security=false an emergency alert must
	// still land (required safety/legal notices bypass consent).
	setMemberSetting(t, ctx, pool, estateID, resident, "notify_security", false)
	svc.notify(ctx, estateID, resident, NotifEmergencyAlert, "Emergency: fire", "Fire reported at gate 2", nil)
	if got := notifCount(t, ctx, pool, resident); got != before+2 {
		t.Fatalf("emergency alert suppressed by security mute: rows %d, want %d", got, before+2)
	}
}

// TestLiveDB_Notify_PushDisabledKeepsFeed — EST-UAT-0357 push channel toggle.
func TestLiveDB_Notify_PushDisabledKeepsFeed(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()

	var pushes atomic.Int32
	svc := newMeetingsTestService(pool).WithNotifier(NotifierFunc(func(ctx context.Context, n EstateNotification) error {
		pushes.Add(1)
		return nil
	}))

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	setMemberSetting(t, ctx, pool, estateID, resident, "push_enabled", false)
	before := notifCount(t, ctx, pool, resident)
	svc.notify(ctx, estateID, resident, NotifTaskAssigned, "New task", "Feed-only while push off", nil)
	if got := notifCount(t, ctx, pool, resident); got != before+1 {
		t.Fatalf("feed row missing when push disabled: rows %d, want %d", got, before+1)
	}
	if got := pushes.Load(); got != 0 {
		t.Fatalf("push sent despite push_enabled=false: %d", got)
	}

	setMemberSetting(t, ctx, pool, estateID, resident, "push_enabled", true)
	svc.notify(ctx, estateID, resident, NotifTaskAssigned, "New task", "Push enabled now", nil)
	if got := pushes.Load(); got != 1 {
		t.Fatalf("push not sent when push_enabled=true: %d", got)
	}
}

// TestLiveDB_Notify_DedupeReplay — EST-UAT-0355: a replayed queue event must
// not double-deliver the identical notification.
func TestLiveDB_Notify_DedupeReplay(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()

	var pushes atomic.Int32
	svc := newMeetingsTestService(pool).WithNotifier(NotifierFunc(func(ctx context.Context, n EstateNotification) error {
		pushes.Add(1)
		return nil
	}))

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	before := notifCount(t, ctx, pool, resident)
	// Same event replayed twice.
	svc.notify(ctx, estateID, resident, NotifMeetingReminder, "Meeting tomorrow", "AGM starts 10:00", nil)
	svc.notify(ctx, estateID, resident, NotifMeetingReminder, "Meeting tomorrow", "AGM starts 10:00", nil)
	if got := notifCount(t, ctx, pool, resident); got != before+1 {
		t.Fatalf("replayed notification double-delivered: rows %d, want %d", got, before+1)
	}
	if got := pushes.Load(); got != 1 {
		t.Fatalf("replayed notification double-pushed: %d, want 1", got)
	}
	// A different body is a different event — must not be collapsed.
	svc.notify(ctx, estateID, resident, NotifMeetingReminder, "Meeting tomorrow", "AGM moved to 11:00", nil)
	if got := notifCount(t, ctx, pool, resident); got != before+2 {
		t.Fatalf("distinct notification wrongly deduped: rows %d, want %d", got, before+2)
	}
}

// seedVisitorPass inserts an active visitor pass for issuedBy.
func seedVisitorPass(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, issuedBy string) string {
	t.Helper()
	qr := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO visitor_passes (estate_id, issued_by, visitor_name, purpose, qr_code, valid_from, valid_until, status)
		 VALUES ($1,$2,'UAT Visitor','site visit',$3, NOW()-interval '1 hour', NOW()+interval '4 hours','active')`,
		estateID, issuedBy, qr); err != nil {
		t.Fatalf("seed visitor pass: %v", err)
	}
	return qr
}

// TestLiveDB_ScanVisitorPass_NotifiesIssuer — EST-UAT-0348 (QR pass path).
func TestLiveDB_ScanVisitorPass_NotifiesIssuer(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	qr := seedVisitorPass(t, ctx, pool, estateID, resident)

	before := notifCount(t, ctx, pool, resident)
	if _, err := svc.ScanVisitorPass(ctx, estateID, admin, qr); err != nil {
		t.Fatalf("ScanVisitorPass: %v", err)
	}
	if got := notifCount(t, ctx, pool, resident); got != before+1 {
		t.Fatalf("issuer not alerted on gate scan: rows %d, want %d", got, before+1)
	}
	var cat, title string
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT category, title FROM estate_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
		resident).Scan(&cat, &title); err != nil {
		t.Fatalf("read notification: %v", err)
	}
	if cat != "security" {
		t.Errorf("visitor-arrived category = %q, want security", cat)
	}
}

// seedAccessCode inserts an active visitor access code for issuedBy.
func seedAccessCode(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, issuedBy string) string {
	t.Helper()
	code := uuid.New().String()[:6]
	if _, err := pool.Exec(ctx,
		`INSERT INTO visitor_access_codes (estate_id, issued_by, visitor_name, purpose, numeric_code, valid_from, valid_until, max_uses, status)
		 VALUES ($1,$2,'UAT Guest','delivery',$3, NOW()-interval '1 hour', NOW()+interval '4 hours', 1,'active')`,
		estateID, issuedBy, code); err != nil {
		t.Fatalf("seed access code: %v", err)
	}
	return code
}

// TestLiveDB_CheckInVisitor_NotifiesIssuer — EST-UAT-0348 (guard check-in path).
func TestLiveDB_CheckInVisitor_NotifiesIssuer(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	code := seedAccessCode(t, ctx, pool, estateID, resident)

	before := notifCount(t, ctx, pool, resident)
	if _, err := svc.CheckInVisitor(ctx, estateID, admin, GuardCheckinRequest{NumericCode: code}); err != nil {
		t.Fatalf("CheckInVisitor: %v", err)
	}
	if got := notifCount(t, ctx, pool, resident); got != before+1 {
		t.Fatalf("issuer not alerted on guard check-in: rows %d, want %d", got, before+1)
	}
}

// TestLiveDB_Reminders_TargetNonResponders — EST-UAT-0351 (meeting RSVP) and
// EST-UAT-0352 (election nonvoters): reminders reach only those who have not
// responded, and election reminders carry no ballot data.
func TestLiveDB_Reminders_TargetNonResponders(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	answered := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, answered, "resident")
	silent := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, silent, "resident")

	// Meeting: 'answered' RSVPs yes, 'silent' does not respond.
	meetingID := seedMeeting(t, ctx, pool, estateID, admin, "scheduled")
	if err := svc.RSVP(ctx, estateID, answered, meetingID, "yes"); err != nil {
		t.Fatalf("RSVP: %v", err)
	}
	bAnswered := notifCount(t, ctx, pool, answered)
	bSilent := notifCount(t, ctx, pool, silent)
	n, err := svc.SendMeetingReminder(ctx, estateID, admin, meetingID)
	if err != nil {
		t.Fatalf("SendMeetingReminder: %v", err)
	}
	// Only the nonresponder is reminded (the admin member also hasn't RSVP'd,
	// so n == members minus the one who answered).
	if n < 1 {
		t.Fatalf("no nonresponders reminded")
	}
	if got := notifCount(t, ctx, pool, silent); got != bSilent+1 {
		t.Errorf("nonresponder not reminded: rows %d, want %d", got, bSilent+1)
	}
	if got := notifCount(t, ctx, pool, answered); got != bAnswered {
		t.Errorf("RSVP'd member wrongly reminded: rows %d, want %d", got, bAnswered)
	}

	// Election under a 2-candidate minimum — seed directly to control status.
	electionID := uuid.New().String()
	candA, candB := uuid.New().String(), uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO elections (id, estate_id, title, starts_at, ends_at, status, created_by)
		 VALUES ($1,$2,'Chair vote', NOW()-interval '1 hour', NOW()+interval '1 day','open',$3)`,
		electionID, estateID, admin); err != nil {
		t.Fatalf("seed election: %v", err)
	}
	for _, c := range [][2]string{{candA, electionID}, {candB, electionID}} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO election_candidates (id, election_id, name) VALUES ($1,$2,$3)`, c[0], c[1], "cand-"+c[0][:6]); err != nil {
			t.Fatalf("seed candidate: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM elections WHERE id=$1`, electionID)
	})
	// 'answered' casts a ballot; 'silent' does not. Seeded the way estate_cast_vote
	// writes it since ESTB-D003: participation in election_votes (no choice column
	// value) and the choice in the anonymous election_ballots table.
	if _, err := pool.Exec(ctx,
		`SELECT estate_cast_vote($1,$2,$3)`, electionID, answered, candA); err != nil {
		t.Fatalf("seed vote: %v", err)
	}
	bAnswered = notifCount(t, ctx, pool, answered)
	bSilent = notifCount(t, ctx, pool, silent)
	if _, err := svc.SendElectionReminders(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("SendElectionReminders: %v", err)
	}
	if got := notifCount(t, ctx, pool, silent); got != bSilent+1 {
		t.Errorf("nonvoter not reminded: rows %d, want %d", got, bSilent+1)
	}
	if got := notifCount(t, ctx, pool, answered); got != bAnswered {
		t.Errorf("voter wrongly reminded: rows %d, want %d", got, bAnswered)
	}
	// Privacy: the reminder payload must not contain any candidate reference.
	var body string
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT COALESCE(body,'') FROM estate_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
		silent).Scan(&body); err != nil {
		t.Fatalf("read reminder: %v", err)
	}
	for _, c := range []string{candA, candB} {
		if body == c {
			t.Errorf("election reminder leaked candidate id %s", c)
		}
	}
}

// TestLiveDB_RepairUpdate_NotifiesReporter — EST-UAT-0353: a work-order status
// change reaches only the requester.
func TestLiveDB_RepairUpdate_NotifiesReporter(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	reporter := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, reporter, "resident")
	other := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, other, "resident")

	repairID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_repair_requests (id, estate_id, reporter_id, category, description, status)
		 VALUES ($1,$2,$3,'plumbing','Leaking pipe under the sink','reported')`,
		repairID, estateID, reporter); err != nil {
		t.Fatalf("seed repair: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estate_repair_requests WHERE id=$1`, repairID)
	})

	bReporter := notifCount(t, ctx, pool, reporter)
	bOther := notifCount(t, ctx, pool, other)
	if _, err := svc.AddRepairUpdate(ctx, estateID, admin, repairID, AddRepairUpdateRequest{Status: "in_progress", Note: "Vendor assigned"}); err != nil {
		t.Fatalf("AddRepairUpdate: %v", err)
	}
	if got := notifCount(t, ctx, pool, reporter); got != bReporter+1 {
		t.Errorf("reporter not notified of status change: rows %d, want %d", got, bReporter+1)
	}
	if got := notifCount(t, ctx, pool, other); got != bOther {
		t.Errorf("non-requester received another resident's repair update: rows %d, want %d", got, bOther)
	}
}

// TestLiveDB_Maintenance_OverdueNotifies — EST-UAT-0350: when the maintenance
// job flips a pending invoice past due, the payer gets an arrears reminder.
func TestLiveDB_Maintenance_OverdueNotifies(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	// A pending invoice already past its due date — creates no notification at
	// insert time because we bypass CreateInvoice (seeded state = "invoice was
	// issued before, nobody got an overdue reminder yet").
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_dues_invoices (estate_id, resident_id, category, amount_kobo, due_date, status)
		 VALUES ($1,$2,'service_charge', 1500000, NOW()-interval '2 days','pending')`,
		estateID, resident); err != nil {
		t.Fatalf("seed invoice: %v", err)
	}

	before := notifCount(t, ctx, pool, resident)
	res, err := svc.RunEstateMaintenance(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("RunEstateMaintenance: %v", err)
	}
	if res["invoices_marked_overdue"] < 1 {
		t.Fatalf("no invoice flipped overdue: %v", res)
	}
	if got := notifCount(t, ctx, pool, resident); got != before+1 {
		t.Fatalf("no arrears reminder sent: rows %d, want %d", got, before+1)
	}
	var status string
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT status FROM estate_dues_invoices WHERE estate_id=$1 AND resident_id=$2`,
		estateID, resident).Scan(&status); err != nil {
		t.Fatalf("read invoice: %v", err)
	}
	if status != "overdue" {
		t.Errorf("invoice status = %q, want overdue", status)
	}
}
