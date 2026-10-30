package estate

// LIVE-DB UAT for the estate inbox archive, search, pin and retention surface
// (notifications_retention.go + supabase/migrations/20271099000070) —
// covers EST-UAT-0359 (read, archive, search older notifications; critical notices never lost) and the
// guard/behaviour split behind defect ESTD-D008.
//
// Follows notifications_live_db_test.go conventions: TEST_DATABASE_URL-gated, package `estate` so the
// unexported sweep entry point is reachable. Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/ -run 'TestLiveDB_Inbox|TestLiveDB_NotificationRetention|TestLiveDB_NotificationPurge' -v
//
// Fixtures are inserted straight into estate_notifications rather than through notify(): this file tests
// what happens to a row that is already old, already read, already pinned, and s.notify() applies member
// preferences and a dedupe window that would silently drop the very rows the case needs.

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type inboxSeed struct {
	category string
	title    string
	body     string
	ageDays  int
	read     bool
	pinned   bool
}

// seedInboxRow puts one notification in a recipient's inbox at a known age and state, and registers a
// cleanup that can actually delete it. The cleanup neutralises the guard first (un-pin, move to a category
// the estate does not protect, drop the policy) — which is itself the case's claim: a pinned or protected
// notice cannot be deleted until somebody changes that on purpose.
func seedInboxRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, userID string, s inboxSeed) string {
	t.Helper()
	id := uuid.New().String()
	var readAt any
	if s.read {
		readAt = time.Now().Add(-time.Duration(s.ageDays) * 24 * time.Hour)
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO estate_notifications (id, estate_id, user_id, category, title, body, read_at, pinned, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() - make_interval(days => $9))`,
		id, estateID, userID, s.category, s.title, s.body, readAt, s.pinned, s.ageDays)
	if err != nil {
		t.Fatalf("seed inbox row: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM estate_notification_retention_policies WHERE estate_id=$1`, estateID)
		_, _ = pool.Exec(c, `UPDATE estates SET legal_hold = FALSE WHERE id=$1`, estateID)
		_, _ = pool.Exec(c, `UPDATE estate_notifications SET pinned = FALSE, category = 'general',
		                             archived_at = NULL WHERE id=$1`, id)
		if _, err := pool.Exec(c, `DELETE FROM estate_notifications WHERE id=$1`, id); err != nil {
			t.Errorf("cleanup inbox row %s: %v", id, err)
		}
	})
	return id
}

func boolCol(t *testing.T, ctx context.Context, pool *pgxpool.Pool, notifID, col string) bool {
	t.Helper()
	var v bool
	q := `SELECT archived_at IS NOT NULL FROM estate_notifications WHERE id=$1`
	if col == "read" {
		q = `SELECT read_at IS NOT NULL FROM estate_notifications WHERE id=$1`
	}
	if col == "pinned" {
		q = `SELECT pinned FROM estate_notifications WHERE id=$1`
	}
	if err := pool.QueryRow(context.WithoutCancel(ctx), q, notifID).Scan(&v); err != nil {
		t.Fatalf("read inbox column %s: %v", col, err)
	}
	return v
}

func countInbox(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT count(*) FROM estate_notifications WHERE estate_id=$1`, estateID).Scan(&n); err != nil {
		t.Fatalf("count inbox: %v", err)
	}
	return n
}

func newInboxFixture(t *testing.T) (*Service, *pgxpool.Pool, context.Context, string, string, string) {
	t.Helper()
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	return svc, pool, ctx, estateID, admin, resident
}

// TestLiveDB_Inbox_PagingAndPinnedFirst — EST-UAT-0359 "older notifications … fall off the inbox".
// Five rows, a page of two, and the total the old LIMIT 50 used to hide.
func TestLiveDB_Inbox_PagingAndPinnedFirst(t *testing.T) {
	svc, pool, ctx, estateID, _, resident := newInboxFixture(t)

	seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Newest notice", ageDays: 1, read: true})
	pinned := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Oldest but pinned", ageDays: 200, read: true, pinned: true})
	seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "payment", title: "Middle notice", ageDays: 100, read: true})

	page, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Limit: 2})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if page.Total != 3 {
		t.Errorf("total = %d, want 3 (the count must survive paging)", page.Total)
	}
	if len(page.Items) != 2 {
		t.Fatalf("page items = %d, want 2", len(page.Items))
	}
	if page.Items[0].ID != pinned {
		t.Errorf("first row = %s (%s), want the pinned notice %s", page.Items[0].ID, page.Items[0].Title, pinned)
	}
	rest, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("ListNotifications offset: %v", err)
	}
	if len(rest.Items) != 1 {
		t.Fatalf("second page items = %d, want 1", len(rest.Items))
	}
	// Category filter + the read state that the payload used to drop.
	pay, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Category: "payment"})
	if err != nil {
		t.Fatalf("category filter: %v", err)
	}
	if len(pay.Items) != 1 || pay.Items[0].ReadAt == nil {
		t.Errorf("payment filter = %+v, want one row carrying read_at", pay.Items)
	}
	if _, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{State: "sideways"}); !errors.Is(err, ErrInvalidNotificationState) {
		t.Errorf("bogus state error = %v, want ErrInvalidNotificationState", err)
	}
}

// TestLiveDB_Inbox_ArchiveRoundTrip — EST-UAT-0359 archive: reversible, and the read state survives both
// directions.
func TestLiveDB_Inbox_ArchiveRoundTrip(t *testing.T) {
	svc, pool, ctx, estateID, _, resident := newInboxFixture(t)
	id := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "announcement", title: "Gate works", body: "Water off Saturday", ageDays: 3, read: true})

	n, err := svc.SetNotificationArchived(ctx, estateID, resident, id, true)
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	if n.ArchivedAt == nil || n.ReadAt == nil {
		t.Errorf("archived row lost a timestamp: archived=%v read=%v", n.ArchivedAt, n.ReadAt)
	}

	active, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{})
	if err != nil {
		t.Fatalf("active read: %v", err)
	}
	if active.Total != 0 {
		t.Errorf("archived row still in the active inbox (total=%d)", active.Total)
	}
	archived, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{State: stateArchived})
	if err != nil {
		t.Fatalf("archived read: %v", err)
	}
	if archived.Total != 1 || archived.Items[0].ID != id {
		t.Errorf("archived view = %+v, want the one row", archived.Items)
	}
	if both, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{State: stateAll}); err != nil || both.Total != 1 {
		t.Errorf("all-state read = (%+v, %v), want one row", both, err)
	}

	back, err := svc.SetNotificationArchived(ctx, estateID, resident, id, false)
	if err != nil {
		t.Fatalf("un-archive: %v", err)
	}
	if back.ArchivedAt != nil {
		t.Errorf("un-archived row still stamped %v", back.ArchivedAt)
	}
	if !boolCol(t, ctx, pool, id, "read") {
		t.Errorf("un-archiving cleared the read state — it must not")
	}
}

// TestLiveDB_Inbox_Search — EST-UAT-0359 "search older notifications".
func TestLiveDB_Inbox_Search(t *testing.T) {
	svc, pool, ctx, estateID, _, resident := newInboxFixture(t)
	byBody := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "announcement", title: "Notice", body: "Lift outage in Block C", ageDays: 60, read: true})
	seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "announcement", title: "Unrelated", body: "Quiet bin collection", ageDays: 60, read: true})
	// An archived row is only reachable by searching the archive half — the point of the two views.
	archived := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Lift maintenance plan", ageDays: 70, read: true})
	if _, err := svc.SetNotificationArchived(ctx, estateID, resident, archived, true); err != nil {
		t.Fatalf("archive for search: %v", err)
	}

	active, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Query: "Lift"})
	if err != nil {
		t.Fatalf("search active: %v", err)
	}
	if len(active.Items) != 1 || active.Items[0].ID != byBody {
		t.Errorf("active search = %+v, want the body match only", active.Items)
	}
	older, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Query: "lift", State: stateArchived})
	if err != nil {
		t.Fatalf("search archived: %v", err)
	}
	if len(older.Items) != 1 || older.Items[0].ID != archived {
		t.Errorf("archived search = %+v, want the archived title match (search is case-insensitive)", older.Items)
	}
	if _, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Query: "l"}); !errors.Is(err, ErrInvalidNotificationQuery) {
		t.Errorf("one-character search error = %v, want ErrInvalidNotificationQuery", err)
	}
	if _, err := svc.ListNotifications(ctx, estateID, resident, NotificationFilter{Limit: 5000}); !errors.Is(err, ErrInvalidNotificationLimit) {
		t.Errorf("oversized limit error = %v, want ErrInvalidNotificationLimit", err)
	}
}

// TestLiveDB_Inbox_ReadStamps — the read state is evidence of one sight, not of every sight.
func TestLiveDB_Inbox_ReadStamps(t *testing.T) {
	svc, pool, ctx, estateID, _, resident := newInboxFixture(t)
	unread := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "meeting", title: "AGM reminder", ageDays: 2})
	seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "meeting", title: "Second AGM reminder", ageDays: 2})

	first, err := svc.MarkNotificationRead(ctx, estateID, resident, unread)
	if err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if first.ReadAt == nil {
		t.Fatal("read_at still null after marking read")
	}
	again, err := svc.MarkNotificationRead(ctx, estateID, resident, unread)
	if err != nil {
		t.Fatalf("mark read twice: %v", err)
	}
	if !again.ReadAt.Equal(*first.ReadAt) {
		t.Errorf("read stamp moved on re-read: %v → %v", first.ReadAt, again.ReadAt)
	}
	if _, err := svc.MarkNotificationRead(ctx, estateID, resident, uuid.New().String()); !errors.Is(err, ErrNotificationNotFound) {
		t.Errorf("unknown row error = %v, want ErrNotificationNotFound", err)
	}

	n, err := svc.MarkAllNotificationsRead(ctx, estateID, resident)
	if err != nil {
		t.Fatalf("mark all: %v", err)
	}
	if n != 1 {
		t.Errorf("mark all stamped %d rows, want the one remaining unread", n)
	}
}

// TestLiveDB_Inbox_WritesScopedToOwner — a notification is one recipient's copy. Nobody can archive or
// pin a row that is not theirs, and an error must not confirm that it exists.
func TestLiveDB_Inbox_WritesScopedToOwner(t *testing.T) {
	svc, pool, ctx, estateID, admin, resident := newInboxFixture(t)
	theirs := seedInboxRow(t, ctx, pool, estateID, admin, inboxSeed{category: "general", title: "Admin's own notice", ageDays: 2, read: true})

	if _, err := svc.SetNotificationArchived(ctx, estateID, resident, theirs, true); !errors.Is(err, ErrNotificationNotFound) {
		t.Errorf("archiving another user's row = %v, want ErrNotificationNotFound", err)
	}
	if _, err := svc.MarkNotificationRead(ctx, estateID, resident, theirs); !errors.Is(err, ErrNotificationNotFound) {
		t.Errorf("marking another user's row read = %v, want ErrNotificationNotFound", err)
	}
	// A member pinning somebody else's copy is refused by the admin assert, not silently allowed.
	other := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, other, "resident")
	theirsOther := seedInboxRow(t, ctx, pool, estateID, other, inboxSeed{category: "general", title: "Third party notice", ageDays: 2})
	pin := true
	_ = pin
	if _, err := svc.SetNotificationPinned(ctx, estateID, resident, other, theirsOther, true); err == nil {
		t.Error("a member pinned another resident's notice; only an estate admin may")
	}
	// The admin may, and it is the retention rule that then refuses to delete it.
	if _, err := svc.SetNotificationPinned(ctx, estateID, admin, other, theirsOther, true); err != nil {
		t.Errorf("admin pin: %v", err)
	}
	if !boolCol(t, ctx, pool, theirsOther, "pinned") {
		t.Error("admin pin did not land")
	}
}

// TestLiveDB_NotificationRetentionPolicy_DefaultsThenWritten — EST-UAT-0359 "retention policy".
func TestLiveDB_NotificationRetentionPolicy_DefaultsThenWritten(t *testing.T) {
	svc, pool, ctx, estateID, admin, resident := newInboxFixture(t)

	p, err := svc.GetNotificationRetentionPolicy(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("default policy read: %v", err)
	}
	if !p.Defaulted || p.ArchiveAfterDays != notifDefaultArchiveDays || p.PurgeAfterDays != nil ||
		strings.Join(p.KeepCategories, ",") != "security,system" {
		t.Errorf("defaults = %+v, want 90 days / never purge / security,system / defaulted", p)
	}
	if _, err := svc.GetNotificationRetentionPolicy(ctx, estateID, resident); err == nil {
		t.Error("a resident read the estate's retention policy; it is an admin setting")
	}

	twoHundred := 200
	threeHundred := 300
	fifty := 50
	badCat := []string{"emergencz"}
	zero := 0

	// The database refuses this shape too (estate_nrp_purge_after_archive); the service refuses it first
	// so the caller gets a sentence instead of a SQLSTATE.
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin,
		SetNotificationRetentionPolicyRequest{ArchiveAfterDays: &twoHundred, PurgeAfterDays: &fifty}); !errors.Is(err, ErrInvalidRetentionPolicy) {
		t.Errorf("purge-before-archive error = %v, want ErrInvalidRetentionPolicy", err)
	}
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin,
		SetNotificationRetentionPolicyRequest{KeepCategories: badCat}); !errors.Is(err, ErrInvalidNotifCategory) {
		t.Errorf("unknown category error = %v, want ErrInvalidNotifCategory", err)
	}
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin,
		SetNotificationRetentionPolicyRequest{ArchiveAfterDays: &zero}); !errors.Is(err, ErrInvalidRetentionPolicy) {
		t.Errorf("zero-day archive error = %v, want ErrInvalidRetentionPolicy", err)
	}
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, resident,
		SetNotificationRetentionPolicyRequest{ArchiveAfterDays: &twoHundred}); err == nil {
		t.Error("a resident wrote the estate's retention policy")
	}

	keep := []string{"security", "system", "payment"}
	written, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin, SetNotificationRetentionPolicyRequest{
		ArchiveAfterDays: &twoHundred, PurgeAfterDays: &threeHundred, KeepCategories: keep,
	})
	if err != nil {
		t.Fatalf("write policy: %v", err)
	}
	if written.Defaulted || written.ArchiveAfterDays != twoHundred || written.PurgeAfterDays == nil || *written.PurgeAfterDays != threeHundred {
		t.Errorf("written policy = %+v, want 200/300 and not defaulted", written)
	}
	if n := auditCount(t, ctx, pool, estateID, estateID, "NOTIFICATION_RETENTION_SET"); n != 1 {
		t.Errorf("NOTIFICATION_RETENTION_SET audit rows = %d, want 1", n)
	}
	// PATCH semantics: the fields that are sent change, the ones that are not keep their written values,
	// and keep_categories is a replacement rather than a merge — otherwise an estate could protect a
	// category and never undo it through this API.
	after, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin,
		SetNotificationRetentionPolicyRequest{ArchiveAfterDays: &threeHundred, PurgeAfterDays: &threeHundred})
	if err != nil {
		t.Fatalf("patch policy: %v", err)
	}
	if after.ArchiveAfterDays != threeHundred || after.PurgeAfterDays == nil || *after.PurgeAfterDays != threeHundred {
		t.Errorf("patched days = %+v, want 300/300", after)
	}
	if strings.Join(after.KeepCategories, ",") != "security,system,payment" {
		t.Errorf("keep_categories after a patch = %v, want the written set", after.KeepCategories)
	}
	only := []string{"payment"}
	narrowed, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin,
		SetNotificationRetentionPolicyRequest{KeepCategories: only})
	if err != nil {
		t.Fatalf("narrow keep list: %v", err)
	}
	if strings.Join(narrowed.KeepCategories, ",") != "payment" {
		t.Errorf("keep_categories after a narrower list = %v, want exactly [payment]", narrowed.KeepCategories)
	}
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT keep_categories FROM estate_notification_retention_policies WHERE estate_id=$1`, estateID).Scan(&after.KeepCategories); err != nil {
		t.Fatalf("read stored list: %v", err)
	}
	if strings.Join(after.KeepCategories, ",") != "payment" {
		t.Errorf("stored keep_categories = %v, want the replaced list on the row too", after.KeepCategories)
	}
}

// TestLiveDB_NotificationRetentionSweep — what the schedule may and may not touch. This estate has no
// policy row at all, so it also pins the claim that an absent policy means the documented defaults
// (90-day archive, never purge, security+system protected) rather than a schedule that silently does
// nothing.
func TestLiveDB_NotificationRetentionSweep(t *testing.T) {
	svc, pool, ctx, estateID, admin, resident := newInboxFixture(t)

	old := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Sweep: plain old read", ageDays: 200, read: true})
	unread := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Sweep: old unread", ageDays: 200})
	pinned := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Sweep: old pinned", ageDays: 200, read: true, pinned: true})
	critical := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "security", title: "Sweep: old security", ageDays: 200, read: true})

	res, err := svc.ApplyNotificationRetention(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("apply retention: %v", err)
	}
	if res["notifications_archived"] != 1 || res["notifications_purged"] != 0 {
		t.Errorf("sweep counters = %v, want 1 archived / 0 purged", res)
	}
	for id, want := range map[string]bool{old: true, unread: false, pinned: false, critical: false} {
		if got := boolCol(t, ctx, pool, id, "archived"); got != want {
			t.Errorf("row %s archived = %v, want %v", id, got, want)
		}
	}

	// Idempotent: a second run in the same window has nothing left to do.
	res2, err := svc.ApplyNotificationRetention(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("apply retention twice: %v", err)
	}
	if res2["notifications_archived"] != 0 || res2["notifications_purged"] != 0 {
		t.Errorf("second sweep = %v, want both counters 0", res2)
	}
	if n := auditCount(t, ctx, pool, estateID, estateID, "NOTIFICATION_RETENTION_RUN"); n != 2 {
		t.Errorf("NOTIFICATION_RETENTION_RUN audit rows = %d, want 2", n)
	}
	if _, err := svc.ApplyNotificationRetention(ctx, estateID, resident); err == nil {
		t.Error("a resident ran the estate's retention sweep")
	}
}

// TestLiveDB_NotificationRetentionPurge — purging is opt-in, and the guard outlives the sweep.
func TestLiveDB_NotificationRetentionPurge(t *testing.T) {
	svc, pool, ctx, estateID, admin, resident := newInboxFixture(t)

	days := 1
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin, SetNotificationRetentionPolicyRequest{
		ArchiveAfterDays: &days, PurgeAfterDays: &days,
	}); err != nil {
		t.Fatalf("short policy: %v", err)
	}

	// The one row with nothing protecting it: archived on the first pass, deleted on the second.
	seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Purge: plain", ageDays: 30, read: true})
	pinned := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Purge: pinned", ageDays: 30, read: true, pinned: true})
	critical := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "system", title: "Purge: system", ageDays: 30, read: true})
	before := countInbox(t, ctx, pool, estateID)
	// Archive pass, then age the stamps past the purge horizon and let the second pass delete.
	if _, err := svc.ApplyNotificationRetention(ctx, estateID, admin); err != nil {
		t.Fatalf("archive pass: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE estate_notifications SET archived_at = NOW() - interval '5 days'
	                             WHERE estate_id=$1 AND archived_at IS NOT NULL`, estateID); err != nil {
		t.Fatalf("age the archive stamps: %v", err)
	}
	res, err := svc.ApplyNotificationRetention(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("purge pass: %v", err)
	}
	if res["notifications_purged"] != 1 {
		t.Errorf("purged = %v, want exactly the one unprotected archived row", res)
	}
	// The pinned notice and the protected `system` category are the two things the case says must never
	// be lost, so neither the archive pass nor the purge pass may touch them.
	if boolCol(t, ctx, pool, pinned, "archived") {
		t.Error("the sweep archived a pinned notice")
	}
	if boolCol(t, ctx, pool, critical, "archived") {
		t.Error("the sweep archived a protected-category notice")
	}
	if n := countInbox(t, ctx, pool, estateID); n != before-1 {
		t.Errorf("row count after purge = %d, want %d", n, before-1)
	}

	// The same guard applies to a DELETE that is not the sweep at all — and it has to name the reason it
	// refused. The combined message used to blame the keep list for a pinned row whose category was not
	// protected, which sends an operator to change a policy that protects nothing.
	if _, err := pool.Exec(ctx, `DELETE FROM estate_notifications WHERE id=$1`, pinned); err == nil {
		t.Error("a direct DELETE removed a pinned notice")
	} else if !strings.Contains(err.Error(), "retained beyond the sweep because it is pinned") {
		t.Errorf("pin guard message = %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM estate_notifications WHERE id=$1`, critical); err == nil {
		t.Error("a direct DELETE removed a protected-category notice")
	} else if !strings.Contains(err.Error(), "retained beyond the sweep because its category system is protected") {
		t.Errorf("category guard message = %v", err)
	}
	// Bringing both back within reach of a delete is the only way a purge happens — by decision, not by
	// accident — and the test's own cleanup relies on it.
	if _, err := pool.Exec(ctx, `UPDATE estate_notifications SET pinned = FALSE, category='general', archived_at=NULL
	                             WHERE id IN ($1,$2)`, pinned, critical); err != nil {
		t.Fatalf("neutralise fixtures: %v", err)
	}
}

// TestLiveDB_NotificationPurgeGuard_LegalHold — the estate-level half of "critical notices never lost".
func TestLiveDB_NotificationPurgeGuard_LegalHold(t *testing.T) {
	svc, pool, ctx, estateID, admin, resident := newInboxFixture(t)

	days := 1
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin, SetNotificationRetentionPolicyRequest{
		ArchiveAfterDays: &days, PurgeAfterDays: &days,
	}); err != nil {
		t.Fatalf("short policy: %v", err)
	}
	plain := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Hold: plain", ageDays: 30, read: true})

	if _, err := pool.Exec(ctx, `UPDATE estates SET legal_hold = TRUE WHERE id=$1`, estateID); err != nil {
		t.Fatalf("set legal hold: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM estate_notifications WHERE id=$1`, plain); err == nil {
		t.Error("a held estate let a notification be purged")
	} else if !strings.Contains(err.Error(), "legal hold") {
		t.Errorf("legal-hold guard message = %v", err)
	}
	// The sweep declines a held estate rather than raising through it, so one held estate cannot break
	// the scheduler for everybody else.
	res, err := svc.ApplyNotificationRetention(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("sweep under legal hold: %v", err)
	}
	if res["notifications_archived"] != 0 || res["notifications_purged"] != 0 {
		t.Errorf("sweep under legal hold = %v, want both counters 0", res)
	}
	if boolCol(t, ctx, pool, plain, "archived") {
		t.Error("a held estate had its inbox archived")
	}
	if countInbox(t, ctx, pool, estateID) != 1 {
		t.Error("a held estate lost its inbox row")
	}

	// Clearing the hold re-opens the schedule — the decline was the hold, not a permanent exemption. The
	// row is archived, and its fresh archive stamp is nowhere near the 1-day purge horizon.
	if _, err := pool.Exec(ctx, `UPDATE estates SET legal_hold = FALSE WHERE id=$1`, estateID); err != nil {
		t.Fatalf("clear legal hold: %v", err)
	}
	res, err = svc.ApplyNotificationRetention(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("sweep after hold cleared: %v", err)
	}
	if res["notifications_archived"] != 1 || res["notifications_purged"] != 0 {
		t.Errorf("sweep after hold cleared = %v, want 1 archived / 0 purged", res)
	}
	if !boolCol(t, ctx, pool, plain, "archived") {
		t.Error("the row stayed out of the archive once the hold was cleared")
	}
}

// TestLiveDB_NotificationRetention_PlatformSweep — the scheduler entry point (estateID ""), which walks
// every estate that has an inbox and each estate's own policy.
func TestLiveDB_NotificationRetention_PlatformSweep(t *testing.T) {
	svc, pool, ctx, estateID, admin, resident := newInboxFixture(t)

	old := seedInboxRow(t, ctx, pool, estateID, resident, inboxSeed{category: "general", title: "Platform sweep: old read", ageDays: 200, read: true})
	// A never-purge policy: the platform entry point may archive, it may not delete.
	archive := 2
	if _, err := svc.SetNotificationRetentionPolicy(ctx, estateID, admin,
		SetNotificationRetentionPolicyRequest{ArchiveAfterDays: &archive}); err != nil {
		t.Fatalf("policy: %v", err)
	}
	// Counted rather than hardcoded at 1: an estate can acquire rows from elsewhere (a lifecycle transition
	// writes its owner a `system` notice), and this assertion is about nothing being *deleted*, not about
	// the seed having a particular size.
	before := countInbox(t, ctx, pool, estateID)
	counts, err := svc.runRetentionSweep(ctx, "")
	if err != nil {
		t.Fatalf("platform sweep: %v", err)
	}
	if counts["notifications_archived"] < 1 {
		t.Errorf("platform sweep counters = %v, want at least this estate's row archived", counts)
	}
	// The never-purge guarantee is asserted on this estate's rows, not on the flattened total.
	// runRetentionSweep("") sums every estate it walks — right for a maintenance report, worthless as a
	// per-estate guarantee: on a shared local database some other estate with an armed purge horizon and old
	// archived rows (an HTTP lane's leftover, for instance) puts a non-zero number in that total, and the
	// test then fails over data it never created. It did exactly that on the first re-run of this suite.
	// Reading `by_estate` instead would not fix it either: asking the function for this estate's document
	// means calling the function, and the second sweep would archive the row again and report 0.
	if n := countInbox(t, ctx, pool, estateID); n != before {
		t.Errorf("platform sweep left %d rows in an estate holding %d before it ran — a never-purge policy deleted something", n, before)
	}
	if !boolCol(t, ctx, pool, old, "archived") {
		t.Error("the platform-wide sweep missed the estate's eligible row")
	}
	var purgeDays *int
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT purge_after_days FROM estate_notification_retention_policies WHERE estate_id=$1`, estateID).
		Scan(&purgeDays); err != nil {
		t.Fatalf("read back the policy: %v", err)
	}
	if purgeDays != nil {
		t.Errorf("purge_after_days = %d, want NULL — the sweep is not the only place a schedule can change", *purgeDays)
	}
}
