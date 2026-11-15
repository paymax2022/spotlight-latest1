package announcements

// announcements_live_db_test.go — the doctor portal's announcement banner has an
// authoring surface.
//
// The banner reads GET /api/v1/doctor/announcements/latest, which answers the
// newest unread doctor_notifications row of notif_type 'system'
// (internal/doctor/repository.go). Until now nothing in production could produce
// that row: the only doctor-facing notification writer is the support admin queue
// (internal/telemedadmin/support/store.go:371) and its notif_type values are
// 'support_response' and 'compliance'. So the banner was permanently empty and the
// admin console had nowhere to publish a platform notice.
//
// Publishing therefore fans one 'system' row out to every provider account — the
// audience is the portal, not the patient-facing directory, so a doctor still in
// onboarding is included.
//
// Most of this runs inside one transaction that is rolled back. The one test that
// proves the two halves meet reads back through the doctor service, which only
// takes a pool, so it commits for real and deletes its own rows.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/doctor"
)

func liveDSN(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set - skipping announcement live-DB test")
	}
	return url
}

func liveTx(t *testing.T) (pgx.Tx, context.Context) {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, liveDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.WithoutCancel(ctx)) })
	return tx, ctx
}

func mustExec(t *testing.T, ctx context.Context, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("%v\nSQL: %s", err, sql)
	}
}

// provider seeds an auth user with a doctor_profiles row — one portal account.
// Names are prefixed so a test can tell its own providers from the shared dev
// database's.
func provider(t *testing.T, ctx context.Context, tx pgx.Tx, name string) string {
	t.Helper()
	uid := uuid.NewString()
	mustExec(t, ctx, tx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		uid, uid+"@announce-test.invalid")
	mustExec(t, ctx, tx, `
		INSERT INTO doctor_profiles (user_id, name, email, verification, mdcn_number)
		VALUES ($1::uuid, $2, $2 || '@x.invalid', 'unsubmitted', $1::text)`,
		uid, name)
	return uid
}

// providerOnPool does the same against a pool, and removes the account and every
// notification it receives when the test ends.
func providerOnPool(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		uid, uid+"@announce-test.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO doctor_profiles (user_id, name, email, verification, mdcn_number)
		VALUES ($1::uuid, $2, $2 || '@x.invalid', 'unsubmitted', $1::text)`,
		uid, name); err != nil {
		t.Fatalf("seed doctor_profiles: %v", err)
	}
	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		for _, q := range []string{
			`DELETE FROM doctor_notifications WHERE user_id = $1::uuid`,
			`DELETE FROM doctor_profiles WHERE user_id = $1::uuid`,
			`DELETE FROM auth.users WHERE id = $1`,
		} {
			if _, err := pool.Exec(cctx, q, uid); err != nil {
				t.Logf("cleanup %q: %v", q, err)
			}
		}
	})
	return uid
}

// rowReader lets one helper read the fan-out from either a pool or the test's
// open transaction.
type rowReader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func notifRows(t *testing.T, ctx context.Context, q rowReader, campaign string) []map[string]any {
	t.Helper()
	rows, err := q.Query(ctx, `
		SELECT user_id::text, notif_type, title, body, read, detail
		FROM doctor_notifications
		WHERE detail->>'campaign_id' = $1`, campaign)
	if err != nil {
		t.Fatalf("read notifications: %v", err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var (
			uid, typ string
			title    *string
			body     *string
			read     bool
			detail   []byte
		)
		if err := rows.Scan(&uid, &typ, &title, &body, &read, &detail); err != nil {
			t.Fatalf("scan: %v", err)
		}
		var d map[string]any
		if err := json.Unmarshal(detail, &d); err != nil {
			t.Fatalf("detail %s: %v", detail, err)
		}
		o := map[string]any{"user_id": uid, "notif_type": typ, "read": read, "detail": d}
		if title != nil {
			o["title"] = *title
		}
		if body != nil {
			o["body"] = *body
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

// testAdmin stands in for the signed-in console operator. It is a real uuid
// because the trail records it as one; it owns no user_profiles row, which the
// audit insert must tolerate.
var testAdmin = uuid.NewString()

func publish(t *testing.T, ctx context.Context, tx pgx.Tx, req PublishRequest) (*Published, error) {
	t.Helper()
	return NewStoreOn(tx).Publish(ctx, testAdmin, req)
}

// The gap being closed: publishing puts a banner in front of every provider.
func TestPublish_FansOneSystemRowOutToEveryProvider(t *testing.T) {
	tx, ctx := liveTx(t)
	a := provider(t, ctx, tx, "zz-announce-a")
	b := provider(t, ctx, tx, "zz-announce-b")

	got, err := publish(t, ctx, tx, PublishRequest{
		Title: "Scheduled maintenance",
		Body:  "Consultations pause tonight 23:00-01:00 WAT.",
		Tone:  "warning",
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if got.Recipients < 2 {
		t.Errorf("recipients = %d, want at least the 2 providers seeded here", got.Recipients)
	}

	rows := notifRows(t, ctx, tx, got.ID)
	seen := map[string]bool{}
	for _, r := range rows {
		seen[r["user_id"].(string)] = true
		if r["notif_type"] != "system" {
			t.Errorf("row for %s has notif_type %v — the doctor banner only reads 'system'",
				r["user_id"], r["notif_type"])
		}
		if r["title"] != "Scheduled maintenance" {
			t.Errorf("row for %s has title %q", r["user_id"], r["title"])
		}
		if r["body"] != "Consultations pause tonight 23:00-01:00 WAT." {
			t.Errorf("row for %s has body %q", r["user_id"], r["body"])
		}
		if r["read"] != false {
			t.Errorf("row for %s is already read — a fresh announcement must be unread to show",
				r["user_id"])
		}
		d := r["detail"].(map[string]any)
		if d["tone"] != "warning" {
			t.Errorf("row for %s has detail tone %v", r["user_id"], d["tone"])
		}
	}
	if !seen[a] || !seen[b] {
		t.Errorf("providers missing from the fan-out: a=%v b=%v (%d rows)", seen[a], seen[b], len(rows))
	}
}

// The proof that matters: the doctor-side read answers what the admin published.
// The doctor service takes a pool, so this one commits and cleans up after itself.
func TestPublish_BannerReadMeetsTheAuthoringSurface(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, liveDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	uid := providerOnPool(t, ctx, pool, "zz-announce-reader")
	if _, err := pool.Exec(ctx, `DELETE FROM doctor_notifications WHERE user_id = $1::uuid AND notif_type = 'system'`, uid); err != nil {
		t.Fatalf("clear existing banners: %v", err)
	}

	got, err := NewStore(pool).Publish(ctx, testAdmin, PublishRequest{
		Title: "New payout schedule", Body: "Settlements now run twice weekly.",
		Tone: "success", CtaLabel: "See details", CtaRoute: "/(doctor)/payout-schedule",
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		_, _ = pool.Exec(cctx, `DELETE FROM admin_audit_logs WHERE target_id = $1::uuid`, got.ID)
	})

	ann, err := doctor.NewService(pool, nil, nil, nil).GetLatestAnnouncement(ctx, uid)
	if err != nil {
		t.Fatalf("GET /announcements/latest after an admin published: %v", err)
	}
	if ann.Title != "New payout schedule" || ann.Body != "Settlements now run twice weekly." {
		t.Errorf("banner shows %q / %q, want the title and body the admin authored",
			ann.Title, ann.Body)
	}
	if ann.Tone != "success" {
		t.Errorf("banner tone = %q, want success — the tone the admin chose must survive the fan-out", ann.Tone)
	}
	if ann.CTALabel == nil || *ann.CTALabel != "See details" ||
		ann.CTARoute == nil || *ann.CTARoute != "/(doctor)/payout-schedule" {
		t.Errorf("banner cta = %v / %v, want the authored label and route", ann.CTALabel, ann.CTARoute)
	}
	if !ann.Dismissible {
		t.Error("banner is not dismissible; the author did not ask for a forced notice")
	}
}

// The provider-side read rewrites an unrecognised tone to "info" rather than
// failing, so a typo would publish, reach every provider, and quietly lose the
// emphasis the author chose. The authoring surface is the last place that can
// still say no.
func TestPublish_UnknownToneIsRejected(t *testing.T) {
	tx, ctx := liveTx(t)
	provider(t, ctx, tx, "zz-announce-tone")

	for _, tone := range []string{"danger", "INFO", "critical"} {
		_, err := publish(t, ctx, tx, PublishRequest{Title: "t", Body: "b", Tone: tone})
		if !errors.Is(err, ErrValidation) {
			t.Errorf("tone %q: err = %v, want ErrValidation", tone, err)
		}
	}
	for _, tone := range []string{"info", "success", "warning"} {
		if _, err := publish(t, ctx, tx, PublishRequest{Title: "t", Body: "b", Tone: tone}); err != nil {
			t.Errorf("tone %q: %v, want it accepted", tone, err)
		}
	}
}

// An empty banner is worse than none: the row would render a title-less box for
// every provider.
func TestPublish_RequiresTitleAndBody(t *testing.T) {
	tx, ctx := liveTx(t)
	provider(t, ctx, tx, "zz-announce-empty")

	cases := []struct {
		name string
		req  PublishRequest
	}{
		{"no title", PublishRequest{Body: "something"}},
		{"blank title", PublishRequest{Title: "   ", Body: "something"}},
		{"no body", PublishRequest{Title: "Notice"}},
		{"blank body", PublishRequest{Title: "Notice", Body: "  "}},
		{"neither", PublishRequest{}},
	}
	for _, tc := range cases {
		if _, err := publish(t, ctx, tx, tc.req); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: err = %v, want ErrValidation", tc.name, err)
		}
	}
}

// A CTA is a label plus a route. The banner renders the label and pushes the
// route, so a label with nowhere to go is a button that does nothing.
func TestPublish_CtaLabelNeedsARoute(t *testing.T) {
	tx, ctx := liveTx(t)
	provider(t, ctx, tx, "zz-announce-cta")

	if _, err := publish(t, ctx, tx, PublishRequest{
		Title: "See this", Body: "b", Tone: "info", CtaLabel: "Open"}); !errors.Is(err, ErrValidation) {
		t.Errorf("label without a route: err = %v, want ErrValidation", err)
	}
	if _, err := publish(t, ctx, tx, PublishRequest{
		Title: "See this", Body: "b", Tone: "info", CtaRoute: "/(doctor)/x"}); !errors.Is(err, ErrValidation) {
		t.Errorf("route without a label: err = %v, want ErrValidation", err)
	}
	got, err := publish(t, ctx, tx, PublishRequest{
		Title: "See this", Body: "b", Tone: "info", CtaLabel: "Open", CtaRoute: "/(doctor)/x"})
	if err != nil {
		t.Fatalf("a complete cta: %v", err)
	}
	rows := notifRows(t, ctx, tx, got.ID)
	for _, r := range rows {
		d := r["detail"].(map[string]any)
		if d["ctaLabel"] != "Open" || d["ctaRoute"] != "/(doctor)/x" {
			t.Errorf("row for %s has cta %v / %v, want Open / /(doctor)/x",
				r["user_id"], d["ctaLabel"], d["ctaRoute"])
		}
	}
}

// Publishing with no provider account to reach is not an error — the console has
// to show what it did, including who received it.
func TestPublish_AlwaysReturnsACampaignIdentity(t *testing.T) {
	tx, ctx := liveTx(t)
	provider(t, ctx, tx, "zz-announce-id")

	got, err := publish(t, ctx, tx, PublishRequest{Title: "Hello", Body: "World", Tone: "info"})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if got.ID == "" {
		t.Error("published campaign has no id — the console cannot list or trail it")
	}
	if got.PublishedAt.IsZero() {
		t.Error("published campaign has no timestamp — the console cannot order it")
	}
}

// A platform-wide notice is an admin action with no single doctor to trail, so it
// goes in the console's generic audit table: one row for the action, campaign id
// as the target, the authored text as the new value.
func TestPublish_WritesAdminAuditTrail(t *testing.T) {
	tx, ctx := liveTx(t)
	provider(t, ctx, tx, "zz-announce-audit")

	got, err := publish(t, ctx, tx, PublishRequest{
		Title: "Fee change", Body: "Consult fees update on the 1st.", Tone: "info"})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	var (
		actionType, targetTable string
		newValue                []byte
	)
	err = tx.QueryRow(ctx, `
		SELECT action_type, target_table, new_value
		FROM admin_audit_logs WHERE target_id = $1::uuid`, got.ID).
		Scan(&actionType, &targetTable, &newValue)
	if err != nil {
		t.Fatalf("trail row for the published campaign: %v", err)
	}
	if targetTable != "doctor_notifications" {
		t.Errorf("target_table = %q, want doctor_notifications", targetTable)
	}
	var nv map[string]any
	if err := json.Unmarshal(newValue, &nv); err != nil {
		t.Fatalf("new_value %s: %v", newValue, err)
	}
	if nv["title"] != "Fee change" {
		t.Errorf("new_value title = %v, want the authored title", nv["title"])
	}
	if nv["recipients"] == nil {
		t.Error("new_value records no recipient count — the trail should say how far this reached")
	}
}

// The console must be able to show what has already gone out, newest first, one
// row per publication rather than one per doctor.
func TestList_GroupsByCampaignNewestFirst(t *testing.T) {
	tx, ctx := liveTx(t)
	provider(t, ctx, tx, "zz-announce-list-1")
	provider(t, ctx, tx, "zz-announce-list-2")

	first, err := publish(t, ctx, tx, PublishRequest{
		Title: "First notice", Body: "one", Tone: "info"})
	if err != nil {
		t.Fatalf("publish first: %v", err)
	}
	second, err := publish(t, ctx, tx, PublishRequest{
		Title: "Second notice", Body: "two", Tone: "success"})
	if err != nil {
		t.Fatalf("publish second: %v", err)
	}

	items, err := NewStoreOn(tx).List(ctx, 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	// The dev database is shared, so find our two campaigns rather than assert the
	// whole list — but their order and their recipient counts must be right.
	idx := map[string]int{}
	for i, it := range items {
		idx[it.ID] = i
	}
	a, okA := idx[first.ID]
	b, okB := idx[second.ID]
	if !okA || !okB {
		t.Fatalf("published campaigns missing from List (first=%v second=%v of %d rows)", okA, okB, len(items))
	}
	if b >= a {
		t.Errorf("second notice is listed at %d, first at %d — newest must come first", b, a)
	}
	if items[b].Title != "Second notice" || items[a].Title != "First notice" {
		t.Errorf("titles do not match their campaigns: %q / %q", items[a].Title, items[b].Title)
	}
	for _, i := range []int{a, b} {
		if items[i].Recipients < 2 {
			t.Errorf("campaign %q reports %d recipients, want at least the 2 providers seeded",
				items[i].Title, items[i].Recipients)
		}
	}
}
