package connectconsole

// Live-DB tests for the console projections. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveDB(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping connect console live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

// testAdminID is a syntactically valid admin user id (audit rows store it as a uuid).
const testAdminID = "00000000-0000-4000-8000-0000000000ad"

type fakePerm struct {
	ok  bool
	err error
}

func (f fakePerm) CheckPermission(string, string, string, string) (bool, error) { return f.ok, f.err }

// seedUser creates an auth user, a platform_user and a Connect profile; returns the user id.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string, status string) string {
	t.Helper()
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO platform_users (id, email, first_name, last_name, status, user_type, password_hash, phone)
		 VALUES ($1::uuid, $2, 'Ada', 'Obi', $3, 'member', 'x', '+2348012345678')
		 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, email = EXCLUDED.email, phone = EXCLUDED.phone`, u, "ada."+u[:6]+"@example.com", status); err != nil {
		t.Skipf("cannot seed platform_users in this schema: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO connect_profiles (user_id, display_name, dob, city) VALUES ($1::uuid, $2, '1995-01-01', 'Lagos')`, u, name); err != nil {
		t.Skipf("cannot seed connect_profiles in this schema: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM connect_account_restrictions WHERE user_id = $1::uuid`, u)
		_, _ = pool.Exec(c, `DELETE FROM connect_verification WHERE user_id = $1::uuid`, u)
		_, _ = pool.Exec(c, `DELETE FROM connect_cases WHERE subject_id = $1::uuid`, u)
		_, _ = pool.Exec(c, `DELETE FROM connect_profiles WHERE user_id = $1::uuid`, u)
		_, _ = pool.Exec(c, `DELETE FROM platform_users WHERE id = $1::uuid`, u)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id = $1::uuid`, u)
	})
	return u
}

func get(t *testing.T, pool *pgxpool.Pool, perm PermissionChecker, path string) (int, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", testAdminID); c.Next() })
	h := NewHandler(NewService(pool), perm)
	r.GET("/users", h.ListUsers)
	r.GET("/users/:id", h.GetUser)
	r.GET("/dashboard", h.Dashboard)
	r.GET("/finance", h.Finance)
	r.GET("/voting", h.Contests)
	r.GET("/voting/:id", h.Contest)
	r.GET("/underage", h.Underage)
	r.GET("/media-review", h.MediaReview)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w.Code, w.Body.String()
}

func TestLive_UsersListAndDetailMaskPersonalData(t *testing.T) {
	pool, ctx := liveDB(t)
	name := "ConsoleTest" + uuid.NewString()[:8]
	u := seedUser(t, ctx, pool, name, "active")
	if _, err := pool.Exec(ctx, `INSERT INTO connect_verification (user_id, level, status) VALUES ($1::uuid, 'l1', 'l1_passed')`, u); err != nil {
		t.Fatal(err)
	}

	code, raw := get(t, pool, nil, "/users?s="+name)
	if code != http.StatusOK {
		t.Fatalf("list: %d %s", code, raw)
	}
	var list struct {
		Data []UserSummary `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &list)
	if len(list.Data) != 1 || list.Data[0].ID != u || list.Data[0].DisplayName != name || list.Data[0].Region != "Lagos" ||
		list.Data[0].Status != "active" || list.Data[0].Verification != "selfie" {
		t.Fatalf("list = %+v", list.Data)
	}

	code, raw = get(t, pool, nil, "/users/"+u)
	if code != http.StatusOK {
		t.Fatalf("detail: %d %s", code, raw)
	}
	for _, leak := range []string{"+2348012345678", "08012345678", "ada." + u[:6], "password"} { // the mask keeps the domain by design
		if strings.Contains(raw, leak) {
			t.Fatalf("detail leaks %q: %s", leak, raw)
		}
	}
	var d struct {
		Data UserDetail `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &d)
	if d.Data.EmailMasked == "" || !strings.Contains(d.Data.EmailMasked, "•••@example.com") || d.Data.PhoneMasked != "••••678" {
		t.Fatalf("masks = %q / %q", d.Data.EmailMasked, d.Data.PhoneMasked)
	}
	if d.Data.Devices == nil || d.Data.TierHistory == nil || d.Data.Modes == nil {
		t.Fatal("lists must be [] not null")
	}
}

func TestLive_UserStatusFilterAndRestrictions(t *testing.T) {
	pool, ctx := liveDB(t)
	tag := "ConsoleStat" + uuid.NewString()[:6]
	banned := seedUser(t, ctx, pool, tag+"-b", "active")
	susp := seedUser(t, ctx, pool, tag+"-s", "suspended")
	ok := seedUser(t, ctx, pool, tag+"-a", "active")
	if _, err := pool.Exec(ctx, `INSERT INTO connect_account_restrictions (user_id, type, active) VALUES ($1::uuid, 'banned', true)`, banned); err != nil {
		t.Fatal(err)
	}
	for status, want := range map[string]string{"banned": banned, "suspended": susp, "active": ok} {
		_, raw := get(t, pool, nil, "/users?status="+status+"&s="+tag+"&limit=50")
		var l struct {
			Data []UserSummary `json:"data"`
		}
		_ = json.Unmarshal([]byte(raw), &l)
		if len(l.Data) != 1 || l.Data[0].ID != want {
			t.Errorf("status=%s -> %+v, want only %s", status, l.Data, want)
		}
	}
	if code, _ := get(t, pool, nil, "/users?status=bogus"); code != http.StatusBadRequest {
		t.Fatalf("bad status -> %d", code)
	}
	// An expired restriction no longer counts.
	if _, err := pool.Exec(ctx, `UPDATE connect_account_restrictions SET expires_at = now() - interval '1 day' WHERE user_id = $1::uuid`, banned); err != nil {
		t.Fatal(err)
	}
	_, raw := get(t, pool, nil, "/users?status=banned&s="+tag)
	if strings.Contains(raw, banned) {
		t.Fatal("an expired ban still shows as banned")
	}
}

func TestLive_UserSearchTreatsWildcardsLiterally(t *testing.T) {
	pool, ctx := liveDB(t)
	tag := uuid.NewString()[:8]
	seedUser(t, ctx, pool, "Wild"+tag+"card", "active")
	_, raw := get(t, pool, nil, "/users?s=%25"+tag+"%25")
	var l struct {
		Data []UserSummary `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &l)
	if len(l.Data) != 0 {
		t.Fatalf("a literal %% search matched %d rows", len(l.Data))
	}
}

func TestLive_UserDetailRejectsBadAndUnknownIDs(t *testing.T) {
	pool, _ := liveDB(t)
	for _, id := range []string{"not-a-uuid", uuid.NewString()} {
		if code, _ := get(t, pool, nil, "/users/"+id); code != http.StatusNotFound {
			t.Errorf("%s -> %d", id, code)
		}
	}
}

func TestLive_DashboardGatesMoneyTilesOnTheGiftingPermission(t *testing.T) {
	pool, _ := liveDB(t)
	for name, p := range map[string]PermissionChecker{"no checker": nil, "denied": fakePerm{ok: false}, "error": fakePerm{err: context.Canceled}} {
		code, raw := get(t, pool, p, "/dashboard")
		if code != http.StatusOK {
			t.Fatalf("%s: %d %s", name, code, raw)
		}
		if !strings.Contains(raw, `"gift_volume_today_kobo":null`) || !strings.Contains(raw, `"gift_volume_30d_kobo":null`) {
			t.Errorf("%s: money tiles must be null without the permission: %s", name, raw)
		}
	}
	code, raw := get(t, pool, fakePerm{ok: true}, "/dashboard")
	if code != http.StatusOK || strings.Contains(raw, `"gift_volume_today_kobo":null`) {
		t.Fatalf("permitted caller must see numbers: %d %s", code, raw)
	}
	var d struct {
		Data Dashboard `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &d)
	if d.Data.Activity == nil {
		t.Fatal("activity must be [] not null")
	}
}

func TestLive_DashboardCountsQueues(t *testing.T) {
	pool, ctx := liveDB(t)
	svc := NewService(pool)
	before, err := svc.GetDashboard(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	u := seedUser(t, ctx, pool, "Dash"+uuid.NewString()[:6], "active")
	if _, err := pool.Exec(ctx, `INSERT INTO connect_verification (user_id, level, status) VALUES ($1::uuid, 'l1', 'pending')`, u); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO connect_cases (subject_id, type, status, severity) VALUES ($1::uuid, 'scam', 'open', 'high')`, u); err != nil {
		t.Fatal(err)
	}
	after, err := svc.GetDashboard(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.IdentityQueue != before.IdentityQueue+1 || after.OpenCases != before.OpenCases+1 {
		t.Fatalf("queue counts: identity %d->%d cases %d->%d", before.IdentityQueue, after.IdentityQueue, before.OpenCases, after.OpenCases)
	}
	found := false
	for _, a := range after.Activity {
		if a.Kind == "case_opened" || a.Kind == "identity_review" {
			found = true
		}
		if strings.Contains(a.Label, u) {
			t.Errorf("activity label leaks a user id: %q", a.Label)
		}
	}
	if !found {
		t.Fatal("recent case/identity events missing from activity")
	}
}

func TestLive_FinanceSummaryHasNullsForUndefinedTilesAndIntegerKobo(t *testing.T) {
	pool, _ := liveDB(t)
	code, raw := get(t, pool, nil, "/finance")
	if code != http.StatusOK {
		t.Fatalf("%d %s", code, raw)
	}
	for _, field := range []string{"take_rate_30d_kobo", "float_balance_kobo", "ledger_debits_kobo", "ledger_credits_kobo"} {
		if !strings.Contains(raw, `"`+field+`":null`) {
			t.Errorf("%s must be null (no agreed definition), got %s", field, raw)
		}
	}
	var f struct {
		Data FinanceSummary `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &f); err != nil || f.Data.GiftVolume30dKobo < 0 || f.Data.PendingPayoutsKobo < 0 {
		t.Fatalf("finance = %+v %v", f.Data, err)
	}
}

// Review: balances and lifetime gift totals are money; a caller with only connect.users.view must not see them.
func TestLive_UserMoneyFieldsAreWithheldWithoutTheGiftingPermission(t *testing.T) {
	pool, ctx := liveDB(t)
	name := "ConsoleMoney" + uuid.NewString()[:6]
	u := seedUser(t, ctx, pool, name, "active")
	for permName, p := range map[string]PermissionChecker{"no checker": nil, "denied": fakePerm{ok: false}, "error": fakePerm{err: context.Canceled}} {
		_, raw := get(t, pool, p, "/users?s="+name)
		if !strings.Contains(raw, `"wallet_balance_kobo":null`) {
			t.Errorf("%s: list balance must be null: %s", permName, raw)
		}
		_, raw = get(t, pool, p, "/users/"+u)
		for _, f := range []string{"wallet_balance_kobo", "lifetime_gift_sent_kobo", "lifetime_gift_received_kobo"} {
			if !strings.Contains(raw, `"`+f+`":null`) {
				t.Errorf("%s: detail %s must be null: %s", permName, f, raw)
			}
		}
	}
	_, raw := get(t, pool, fakePerm{ok: true}, "/users/"+u)
	if strings.Contains(raw, `"wallet_balance_kobo":null`) || strings.Contains(raw, `"lifetime_gift_sent_kobo":null`) {
		t.Fatalf("a permitted caller must see numbers: %s", raw)
	}
}

func TestLive_UnderageQueueMapsStatusAndMasksTheDOB(t *testing.T) {
	pool, ctx := liveDB(t)
	u := seedUser(t, ctx, pool, "Minor"+uuid.NewString()[:6], "active")
	var flagID string
	if err := pool.QueryRow(ctx, `INSERT INTO connect_underage_flags (user_id, reason, dob, status) VALUES ($1::uuid, 'under_18_at_age_gate', '2009-03-14', 'queued') RETURNING id::text`, u).Scan(&flagID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM connect_underage_flags WHERE user_id = $1::uuid`, u)
	})

	code, raw := get(t, pool, nil, "/underage?limit=200")
	if code != http.StatusOK {
		t.Fatalf("%d %s", code, raw)
	}
	for _, leak := range []string{"2009-03-14", "2009", "03-14"} {
		if strings.Contains(raw, leak) {
			t.Fatalf("response leaks the date of birth (%q)", leak)
		}
	}
	var l struct {
		Data []UnderageFlag `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &l)
	var got *UnderageFlag
	for i := range l.Data {
		if l.Data[i].ID == flagID {
			got = &l.Data[i]
		}
	}
	if got == nil || got.Status != "open" || got.Signal != "dob_under_18" || got.DeclaredDOBMsk != "20••-••-14" || got.UserID != u || got.CaseID != nil {
		t.Fatalf("flag = %+v", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE connect_underage_flags SET status = 'banned' WHERE id = $1::uuid`, flagID); err != nil {
		t.Fatal(err)
	}
	_, banned := get(t, pool, nil, "/underage?status=confirmed_minor&limit=200")
	_, open := get(t, pool, nil, "/underage?status=open&limit=200")
	if !strings.Contains(banned, flagID) || strings.Contains(open, flagID) {
		t.Fatal("status mapping/filter wrong after the ban")
	}
	if code, _ := get(t, pool, nil, "/underage?status=bogus"); code != http.StatusBadRequest {
		t.Fatalf("bad status -> %d", code)
	}
}

func TestLive_MediaReviewListsMetadataOnlyAndPendingFirst(t *testing.T) {
	pool, ctx := liveDB(t)
	name := "Media" + uuid.NewString()[:6]
	u := seedUser(t, ctx, pool, name, "active")
	var profileID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM connect_profiles WHERE user_id = $1::uuid`, u).Scan(&profileID); err != nil {
		t.Fatal(err)
	}
	var approvedID, pendingID string
	if err := pool.QueryRow(ctx, `INSERT INTO connect_profile_media (profile_id, url, kind, moderation_status, sort_order) VALUES ($1::uuid, 'r2://secret-media-key-1', 'clip', 'approved', 5) RETURNING id::text`, profileID).Scan(&approvedID); err != nil {
		t.Fatalf("cannot seed connect_profile_media: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO connect_profile_media (profile_id, url, kind, moderation_status, sort_order) VALUES ($1::uuid, 'r2://secret-media-key-2', 'photo', 'pending', 0) RETURNING id::text`, profileID).Scan(&pendingID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM connect_profile_media WHERE profile_id = $1::uuid`, profileID)
	})

	code, raw := get(t, pool, nil, "/media-review?limit=200")
	if code != http.StatusOK {
		t.Fatalf("%d %s", code, raw)
	}
	if strings.Contains(raw, "secret-media-key") || strings.Contains(raw, "r2://") || strings.Contains(raw, `"url"`) {
		t.Fatal("the media URL leaked")
	}
	var l struct {
		Data []MediaReviewItem `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &l)
	idx := map[string]int{}
	for i, it := range l.Data {
		idx[it.ID] = i
		if it.ID == pendingID && (it.State != "pending" || it.MediaKind != "profile_photo" || it.Handle != name || it.UserID != u) {
			t.Fatalf("pending item = %+v", it)
		}
		if it.ID == approvedID && (it.State != "approved" || it.MediaKind != "gallery") {
			t.Fatalf("approved item = %+v", it)
		}
	}
	if _, ok := idx[pendingID]; !ok {
		t.Fatal("pending item missing")
	}
	if idx[pendingID] > idx[approvedID] {
		t.Fatal("pending items must sort before approved ones")
	}
	_, only := get(t, pool, nil, "/media-review?state=approved&limit=200")
	if !strings.Contains(only, approvedID) || strings.Contains(only, pendingID) {
		t.Fatal("state filter wrong")
	}
	if code, _ := get(t, pool, nil, "/media-review?state=bogus"); code != http.StatusBadRequest {
		t.Fatalf("bad state -> %d", code)
	}
}

// Review: reads of the child-safety queues are audited (who looked, which filter, how many rows).
func TestLive_UnderageAndMediaReadsAreAudited(t *testing.T) {
	pool, ctx := liveDB(t)
	// connect_audit_log.actor_id references auth.users, as it does for every real admin.
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'console-audit-admin@seed.test') ON CONFLICT DO NOTHING`, testAdminID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1::uuid`, testAdminID)
	})
	_, _ = pool.Exec(ctx, `DELETE FROM connect_audit_log WHERE actor_id = $1::uuid`, testAdminID)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM connect_audit_log WHERE actor_id = $1::uuid`, testAdminID)
	})
	get(t, pool, nil, "/underage?status=open")
	get(t, pool, nil, "/media-review?state=pending")
	for _, action := range []string{"connect.underage.list", "connect.media_review.list"} {
		var n int
		var detail string
		if err := pool.QueryRow(ctx, `SELECT count(*), COALESCE(max(new_value::text), '') FROM connect_audit_log WHERE actor_id = $1::uuid AND action = $2`, testAdminID, action).Scan(&n, &detail); err != nil {
			t.Fatal(err)
		}
		if n != 1 || !strings.Contains(detail, `"rows"`) {
			t.Errorf("%s: audit rows=%d detail=%q", action, n, detail)
		}
	}
	// A rejected request is not a read and is not audited.
	get(t, pool, nil, "/underage?status=bogus")
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM connect_audit_log WHERE actor_id = $1::uuid AND action = 'connect.underage.list'`, testAdminID).Scan(&n)
	if n != 1 {
		t.Errorf("a 400 was audited as a read: %d rows", n)
	}
}

// Review: a soft-deleted profile's name is never shown on a flag, and its media is never queued.
func TestLive_DeletedProfilesAreNotNamedAndTheirMediaIsExcluded(t *testing.T) {
	pool, ctx := liveDB(t)
	name := "Gone" + uuid.NewString()[:6]
	u := seedUser(t, ctx, pool, name, "active")
	var profileID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM connect_profiles WHERE user_id = $1::uuid`, u).Scan(&profileID); err != nil {
		t.Fatal(err)
	}
	var flagID, mediaID string
	if err := pool.QueryRow(ctx, `INSERT INTO connect_underage_flags (user_id, reason, dob, status) VALUES ($1::uuid, 'under_18_at_age_gate', '2010-01-02', 'queued') RETURNING id::text`, u).Scan(&flagID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO connect_profile_media (profile_id, url, kind, moderation_status, sort_order) VALUES ($1::uuid, 'r2://gone', 'photo', 'pending', 0) RETURNING id::text`, profileID).Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM connect_underage_flags WHERE user_id = $1::uuid`, u)
		_, _ = pool.Exec(c, `DELETE FROM connect_profile_media WHERE profile_id = $1::uuid`, profileID)
	})
	if _, err := pool.Exec(ctx, `UPDATE connect_profiles SET deleted_at = now() WHERE id = $1::uuid`, profileID); err != nil {
		t.Fatal(err)
	}
	_, raw := get(t, pool, nil, "/underage?limit=200")
	if strings.Contains(raw, name) {
		t.Fatal("a deleted profile's display name appears on the flag")
	}
	if !strings.Contains(raw, flagID) {
		t.Fatal("the flag itself must still be listed (a deleted account can still be a suspected minor)")
	}
	_, raw = get(t, pool, nil, "/media-review?limit=200")
	if strings.Contains(raw, mediaID) {
		t.Fatal("a deleted profile's media is still queued")
	}
}

func seedContest(t *testing.T, ctx context.Context, pool *pgxpool.Pool, title, status, opens, closes string) string {
	t.Helper()
	var id string
	q := `INSERT INTO connect_contests (title, status, opens_at, closes_at) VALUES ($1, $2, NULLIF($3,'')::timestamptz, NULLIF($4,'')::timestamptz) RETURNING id::text`
	if err := pool.QueryRow(ctx, q, title, status, opens, closes).Scan(&id); err != nil {
		t.Fatalf("seed contest: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM contestants WHERE connect_contest_id = $1::uuid`, id)
		_, _ = pool.Exec(c, `DELETE FROM connect_contests WHERE id = $1::uuid`, id) // cascades votes
	})
	return id
}

func TestLive_ContestStatusIsDerivedFromTheWindow(t *testing.T) {
	pool, ctx := liveDB(t)
	tag := "VoteStat" + uuid.NewString()[:6]
	draft := seedContest(t, ctx, pool, tag+"-draft", "draft", "", "")
	live := seedContest(t, ctx, pool, tag+"-live", "open", "2020-01-01T00:00:00Z", "2099-01-01T00:00:00Z")
	soon := seedContest(t, ctx, pool, tag+"-soon", "open", "2099-01-01T00:00:00Z", "")
	over := seedContest(t, ctx, pool, tag+"-over", "open", "2020-01-01T00:00:00Z", "2021-01-01T00:00:00Z")
	closed := seedContest(t, ctx, pool, tag+"-closed", "closed", "", "")
	want := map[string]string{draft: "scheduled", live: "live", soon: "scheduled", over: "closed", closed: "closed"}
	_, raw := get(t, pool, fakePerm{ok: true}, "/voting?limit=200")
	var l struct {
		Data []ContestSummary `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &l)
	got := map[string]string{}
	for _, c := range l.Data {
		got[c.ID] = c.Status
		if c.IntegrityScore != nil || c.FlagsOpen != nil {
			t.Errorf("integrity must be null: %+v", c)
		}
	}
	for id, st := range want {
		if got[id] != st {
			t.Errorf("contest %s status %q want %q", id, got[id], st)
		}
	}
	for status, ids := range map[string][]string{"live": {live}, "scheduled": {draft, soon}, "closed": {over, closed}} {
		_, only := get(t, pool, fakePerm{ok: true}, "/voting?status="+status+"&limit=200")
		for _, id := range ids {
			if !strings.Contains(only, id) {
				t.Errorf("status=%s filter missing %s", status, id)
			}
		}
		for _, other := range []string{live, draft, over} {
			in := false
			for _, id := range ids {
				in = in || id == other
			}
			if !in && strings.Contains(only, other) {
				t.Errorf("status=%s returned %s", status, other)
			}
		}
	}
	_, fin := get(t, pool, nil, "/voting?status=finalized&limit=200")
	if strings.Contains(fin, tag) {
		t.Fatal("finalized has no stored equivalent and must list nothing of ours")
	}
	if code, _ := get(t, pool, nil, "/voting?status=bogus"); code != http.StatusBadRequest {
		t.Fatalf("bad status -> %d", code)
	}
}

func TestLive_ContestTalliesEntrantsAndMoneyGating(t *testing.T) {
	pool, ctx := liveDB(t)
	id := seedContest(t, ctx, pool, "VoteTally"+uuid.NewString()[:6], "open", "2020-01-01T00:00:00Z", "")
	var contestantID string
	if err := pool.QueryRow(ctx, `INSERT INTO contestants (name, connect_contest_id) VALUES ('Ada Roster', $1::uuid) RETURNING id::text`, id).Scan(&contestantID); err != nil {
		t.Fatalf("seed contestant: %v", err)
	}
	var idle string
	if err := pool.QueryRow(ctx, `INSERT INTO contestants (name, connect_contest_id) VALUES ('Idle Roster', $1::uuid) RETURNING id::text`, id).Scan(&idle); err != nil {
		t.Fatal(err)
	}
	voter := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, voter, voter+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1::uuid`, voter) })
	for _, v := range []struct {
		ref       string
		paid      bool
		qty, kobo int
	}{{contestantID, true, 3, 30000}, {contestantID, false, 2, 0}, {"poll-label", true, 1, 10000}} {
		if _, err := pool.Exec(ctx, `INSERT INTO connect_votes (contest_id, voter_id, option_ref, paid, quantity, amount_kobo) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)`,
			id, voter, v.ref, v.paid, v.qty, v.kobo); err != nil {
			t.Fatalf("seed vote: %v", err)
		}
	}

	_, raw := get(t, pool, fakePerm{ok: true}, "/voting/"+id)
	var d struct {
		Data ContestDetail `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &d)
	c := d.Data
	if c.PaidVotes != 4 || c.FreeVotes != 2 || c.PaidVoteVolumeKobo == nil || *c.PaidVoteVolumeKobo != 40000 {
		t.Fatalf("totals = %+v", c.ContestSummary)
	}
	names := map[string]ContestEntrant{}
	for _, e := range c.Entrants {
		names[e.Name] = e
	}
	if names["Ada Roster"].PaidVotes != 3 || names["Ada Roster"].FreeVotes != 2 || names["Ada Roster"].TallyKobo == nil || *names["Ada Roster"].TallyKobo != 30000 {
		t.Fatalf("roster entrant = %+v", names["Ada Roster"])
	}
	if _, ok := names["Idle Roster"]; !ok {
		t.Fatal("a roster contestant with no votes must still be listed")
	}
	if _, ok := names["poll-label"]; !ok {
		t.Fatal("an off-roster option must still be listed")
	}
	if c.Entrants[0].Name != "Ada Roster" {
		t.Fatalf("entrants must be ordered by votes: %+v", c.Entrants)
	}
	if c.Flags == nil || len(c.Flags) != 0 {
		t.Fatalf("flags must be []: %v", c.Flags)
	}
	// Without the gifting permission every money figure is withheld.
	for name, p := range map[string]PermissionChecker{"none": nil, "denied": fakePerm{ok: false}, "error": fakePerm{err: context.Canceled}} {
		_, raw := get(t, pool, p, "/voting/"+id)
		if !strings.Contains(raw, `"paid_vote_volume_kobo":null`) || strings.Contains(raw, `"tally_kobo":30000`) || strings.Contains(raw, `"tally_kobo":10000`) {
			t.Errorf("%s: money not withheld: %s", name, raw)
		}
		if !strings.Contains(raw, `"paid_votes":4`) {
			t.Errorf("%s: vote counts are not money and must remain: %s", name, raw)
		}
	}
	for _, bad := range []string{"not-a-uuid", uuid.NewString()} {
		if code, _ := get(t, pool, nil, "/voting/"+bad); code != http.StatusNotFound {
			t.Errorf("%s -> %d", bad, code)
		}
	}
	_ = idle
}
