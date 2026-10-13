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
	h := NewHandler(NewService(pool), perm)
	r.GET("/users", h.ListUsers)
	r.GET("/users/:id", h.GetUser)
	r.GET("/dashboard", func(c *gin.Context) { c.Set("user_id", "admin-1"); h.Dashboard(c) })
	r.GET("/finance", h.Finance)
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
