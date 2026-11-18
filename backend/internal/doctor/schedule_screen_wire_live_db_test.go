package doctor

// schedule_screen_wire_live_db_test.go — the doctor portal screens whose wire and
// storage disagreed, plus the announcement banner that was a hard nil.
//
// timezone.tsx reads settings.timezone and refuses to save while it is unset
// (`if (!tz) return`), so a payload without the key made the screen a dead end.
// reminders.tsx binds settings.reminders into one ReminderSettings object and
// posts { reminders }, while GET /schedule answered rows of doctor_reminders and
// PUT /schedule/reminders bound nothing (the whole body landed in `settings` and
// the enabled column was never sent).
//
// The announcement read answered nil for every doctor. The notice an operator
// broadcasts is already a doctor_notifications row of type 'system', and
// dismissing it used to write an audit row and change nothing.
//
// Runs only with TEST_DATABASE_URL set; owns and removes its fixtures.

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedProfile(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO doctor_profiles (user_id) VALUES ($1)`, userID); err != nil {
		t.Fatalf("seed doctor_profiles: %v", err)
	}
}

func storedTimezone(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	var tz string
	if err := pool.QueryRow(context.Background(),
		`SELECT timezone FROM doctor_profiles WHERE user_id = $1`, userID).Scan(&tz); err != nil {
		t.Fatalf("read stored timezone: %v", err)
	}
	return tz
}

// timezone.tsx picks the selected row from settings.timezone and refuses to save
// while it is falsy, so the key has to be on the schedule payload — and the
// availability row nested in the same payload must not contradict it.
func TestGetScheduleSettings_AnswersTheTimezoneTheScheduleIsSavedIn(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedProfile(t, pool, userID)
	svc := NewService(pool, nil, nil, nil)
	ctx := context.Background()

	if _, err := svc.SetTimezone(ctx, userID, "idem-tz-1",
		json.RawMessage(`{"timezone":"Europe/London"}`)); err != nil {
		t.Fatalf("PUT /schedule/timezone: %v", err)
	}
	res, err := svc.GetScheduleSettings(ctx, userID)
	if err != nil {
		t.Fatalf("GET /schedule: %v", err)
	}
	w := wire(t, res)
	if got := w["timezone"]; got != "Europe/London" {
		t.Errorf("timezone = %#v — timezone.tsx reads settings.timezone and saves nothing while it is unset", got)
	}
	schedule, ok := w["schedule"].(map[string]any)
	if !ok {
		t.Fatalf("schedule is %#v, want the availability row", w["schedule"])
	}
	if got := schedule["timezone"]; got != "Europe/London" {
		t.Errorf("schedule.timezone = %#v while the payload's timezone says Europe/London — one read cannot carry two zones", got)
	}
}

// SetTimezone validated only the empty string, so any other value reached the
// column and blew up later as a Postgres 22023 in whatever evaluated it. An
// unknown zone is the caller's to fix, not an outage.
func TestSetTimezone_RejectsAZonePostgresCannotApply(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedProfile(t, pool, userID)
	svc := NewService(pool, nil, nil, nil)
	ctx := context.Background()

	_, err := svc.SetTimezone(ctx, userID, "idem-tz-2",
		json.RawMessage(`{"timezone":"Mars/Olympus_Mons"}`))
	if !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("err = %v, want ErrInvalidTimezone", err)
	}
	if got := storedTimezone(t, pool, userID); got != "Africa/Lagos" {
		t.Errorf("stored timezone = %q after a rejected write — the column moved anyway", got)
	}
}

// The availability column is not the store the schedule screen writes, so a zone
// saved through PUT /schedule/timezone must still be accepted.
func TestSetTimezone_AcceptsAZonePostgresCanApply(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedProfile(t, pool, userID)

	if _, err := NewService(pool, nil, nil, nil).SetTimezone(context.Background(), userID, "idem-tz-3",
		json.RawMessage(`{"timezone":"Africa/Lagos"}`)); err != nil {
		t.Fatalf("a valid zone was rejected: %v", err)
	}
	if got := storedTimezone(t, pool, userID); got != "Africa/Lagos" {
		t.Errorf("stored timezone = %q", got)
	}
}

// reminders.tsx:22 binds settings.reminders into a single ReminderSettings form
// and :37 posts it back as { reminders }. An array of rows there leaves every
// field undefined and f.offsetsMins.includes(...) throws.
func TestGetScheduleSettings_AnswersTheRemindersObjectTheScreenEdits(t *testing.T) {
	pool, userID := newSchedDoctor(t)

	res, err := NewService(pool, nil, nil, nil).GetScheduleSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /schedule: %v", err)
	}
	w := wire(t, res)
	reminders, ok := w["reminders"].(map[string]any)
	if !ok {
		t.Fatalf("reminders is %#v — the screen binds it as one object, not the row list", w["reminders"])
	}
	if _, ok := reminders["enabled"].(bool); !ok {
		t.Errorf("reminders.enabled is %#v, want a boolean", reminders["enabled"])
	}
	if _, ok := reminders["offsetsMins"].([]any); !ok {
		t.Errorf("reminders.offsetsMins is %#v, want an array the screen can filter", reminders["offsetsMins"])
	}
	for _, key := range []string{"channelPush", "channelEmail", "channelSms"} {
		if _, ok := reminders[key].(bool); !ok {
			t.Errorf("reminders.%s is %#v, want a boolean", key, reminders[key])
		}
	}
}

// The write side: the screen posts { reminders: {...} }, which the old binder did
// not read — it stored the whole body in `settings` and left `enabled` at the
// SaveReminder default. The save must also answer what it stored.
func TestSaveReminderSettings_StoresTheObjectTheScreenPosts(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	svc := NewService(pool, nil, nil, nil)
	ctx := context.Background()

	saved, err := svc.SaveReminderSettings(ctx, userID, "idem-rm-1", json.RawMessage(
		`{"reminders":{"enabled":true,"offsetsMins":[60,15],"channelPush":true,"channelEmail":false,"channelSms":true}}`))
	if err != nil {
		t.Fatalf("PUT /schedule/reminders: %v", err)
	}
	echo, ok := wire(t, SaveReminderSettingsResult{Reminders: *saved})["reminders"].(map[string]any)
	if !ok {
		t.Fatalf("the save echoed %#v — the screen unwraps { reminders }", saved)
	}
	if echo["enabled"] != true || echo["channelSms"] != true || echo["channelEmail"] != false {
		t.Errorf("echo = %#v, want the booleans that were posted", echo)
	}
	offsets, ok := echo["offsetsMins"].([]any)
	if !ok || len(offsets) != 2 || offsets[0] != float64(60) || offsets[1] != float64(15) {
		t.Errorf("echo.offsetsMins = %#v, want [60 15]", echo["offsetsMins"])
	}

	res, err := svc.GetScheduleSettings(ctx, userID)
	if err != nil {
		t.Fatalf("GET /schedule: %v", err)
	}
	back, ok := wire(t, res)["reminders"].(map[string]any)
	if !ok {
		t.Fatalf("reminders is %#v after a save", wire(t, res)["reminders"])
	}
	if !reflect.DeepEqual(back["offsetsMins"], echo["offsetsMins"]) || back["enabled"] != echo["enabled"] {
		t.Errorf("read back %#v, saved %#v", back, echo)
	}
}

// seedSystemNotification writes the platform-announcement row an operator authors
// through doctor_notifications (notif_type defaults to 'system').
func seedSystemNotification(t *testing.T, pool *pgxpool.Pool, userID, notifType, title, body, detail, age string, read bool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO doctor_notifications (id, user_id, notif_type, title, body, detail, read, created_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now() - $8::interval)`,
		id, userID, notifType, title, body, detail, read, age); err != nil {
		t.Fatalf("seed doctor_notifications: %v", err)
	}
	return id
}

// The banner used to be a hard nil. The announcement is a row of the
// notifications table the admin plane already writes, so the read must project it.
func TestGetLatestAnnouncement_SurfacesTheNewestUnreadPlatformNotice(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedSystemNotification(t, pool, userID, "system", "Older notice", "body", `{}`, "2 days", false)
	id := seedSystemNotification(t, pool, userID, "system", "Scheduled maintenance",
		"Teleconsults pause 02:00-03:00 WAT.", `{"tone":"warning","ctaLabel":"Read more","ctaRoute":"notifications"}`, "1 hour", false)

	got, err := NewService(pool, nil, nil, nil).GetLatestAnnouncement(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /announcements/latest: %v", err)
	}
	w := wire(t, got)
	if w["id"] != id {
		t.Errorf("id = %#v, want the newest notice %q", w["id"], id)
	}
	if w["title"] != "Scheduled maintenance" || w["body"] != "Teleconsults pause 02:00-03:00 WAT." {
		t.Errorf("title/body = %#v / %#v", w["title"], w["body"])
	}
	if w["tone"] != "warning" {
		t.Errorf("tone = %#v, want the detail's warning", w["tone"])
	}
	if w["dismissible"] != true {
		t.Errorf("dismissible = %#v — the banner's dismiss button reads it", w["dismissible"])
	}
	if _, ok := w["publishedAt"].(string); !ok {
		t.Errorf("publishedAt is %#v, want the row's created_at", w["publishedAt"])
	}
}

// Support replies and compliance notices already have their own list; turning
// them into a dashboard banner would double-report them.
func TestGetLatestAnnouncement_IgnoresSupportAndComplianceRows(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedSystemNotification(t, pool, userID, "support_response", "Ticket answered", "body", `{}`, "1 hour", false)
	seedSystemNotification(t, pool, userID, "compliance", "Safety report", "body", `{}`, "2 hours", false)

	got, err := NewService(pool, nil, nil, nil).GetLatestAnnouncement(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /announcements/latest: %v", err)
	}
	if got != nil {
		t.Errorf("announcement = %#v, want nil — that row already appears in the notifications list", got)
	}
}

// Dismissing used to write an audit row and change nothing, so the banner came
// straight back on the next refetch.
func TestDismissAnnouncement_MarksTheNoticeRead(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	id := seedSystemNotification(t, pool, userID, "system", "Policy update", "body", `{}`, "1 hour", false)
	svc := NewService(pool, nil, nil, nil)
	ctx := context.Background()

	if err := svc.DismissAnnouncement(ctx, userID, id); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	var read bool
	if err := pool.QueryRow(ctx, `SELECT read FROM doctor_notifications WHERE id = $1`, id).Scan(&read); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !read {
		t.Error("the notification is still unread after a dismiss — the banner returns on the next refetch")
	}
	got, err := svc.GetLatestAnnouncement(ctx, userID)
	if err != nil {
		t.Fatalf("GET /announcements/latest: %v", err)
	}
	if got != nil {
		t.Errorf("announcement = %#v after dismissing it", got)
	}
}
