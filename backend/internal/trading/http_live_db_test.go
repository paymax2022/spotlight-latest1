package trading

// HTTP-level e2e for the AI-trading module. The service suites (gate_live_db_test.go
// and friends) call the services directly, so they never prove the mounted routes
// actually respond — the flag-gated path in finance_routes.go was unexercised from
// the wire. This drives the REAL gin routes over httptest: Module-KYC lifecycle,
// access-gated subscribe (idempotent), redeem, the /evaluate pipeline gate, and the
// §12 promotion ladder — same ordering and status codes the running API produces.
//
// Skipped unless TEST_DATABASE_URL is set — deliberately with NO fallback to
// DATABASE_URL, which the root .env points at the PRODUCTION Supabase pooler.
//
// Like every live-DB suite in this repo this needs `-p 1` in multi-package runs:
// internal/trading/wallet's resetFund TRUNCATEs the shared fund projection at
// suite start, so only the documented runner (`go test ./... -p 1`, Makefile
// `test`, CI go-verify) is safe — same constraint the standing-account suites
// already carry (see Makefile test target).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/testsupport"
)

// denyRBAC denies every CheckPermission — admin requests in this suite pass via
// the injected super-admin role (the local fast-path in RequirePermission), so a
// member hitting an admin route exercises exactly the production denial path.
type denyRBAC struct{ services.RBACService }

func (denyRBAC) CheckPermission(string, string, string, string) (bool, error) {
	return false, nil
}

// injectUser stands in for RequireAuthContext: it mirrors the id into "user_id"
// (what ginutil.UserID/requireUserID read) and sets the authUser context value
// (what RequirePermission reads) — same two keys the real middleware sets.
func injectUser(id string, roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("user_id", id)
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: id, Roles: roles})
		c.Next()
	}
}

// tradingRouter mounts the module exactly as finance_routes.go does (member +
// admin groups behind auth + user_id), with aiEnabled=true so /evaluate and the
// promotion-ladder routes exist.
func tradingRouter(pool *pgxpool.Pool, led *ledger.Service, memberID, adminID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	member := r.Group("/api/v1/trading")
	member.Use(injectUser(memberID))
	admin := r.Group("/api/v1/admin/trading")
	admin.Use(injectUser(adminID, "super-admin"))
	Register(member, admin, pool, denyRBAC{}, led, 2000, 0, true)
	return r
}

func do(t *testing.T, h http.Handler, method, path, body, idemKey string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *strings.Reader
	if body == "" {
		rdr = strings.NewReader("")
	} else {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("response not JSON: %v\nbody: %s", err, rec.Body.String())
	}
	return m
}

func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int, what string) map[string]any {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("%s = %d, want %d\nbody: %s", what, rec.Code, want, rec.Body.String())
	}
	return decode(t, rec)
}

func TestLiveDB_TradingHTTP_EndToEnd(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping trading HTTP e2e")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	// A member fixture (tier 3: wallet-enabled, no daily cap) and an admin.
	member := uuid.NewString()
	admin := uuid.NewString()
	for _, u := range []string{member, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	testsupport.CleanupUsers(t, pool, member, admin)
	testsupport.SetKycTier(t, ctx, pool, member, testsupport.KycTierUnlimited)

	// Fund the member wallet through the ledger (provider_clearing → user_wallet).
	src, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	if err := led.Credit(ctx, member, "seed", "seed:trading-http:"+uuid.NewString(), src.ID, 5_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	router := tradingRouter(pool, led, member, admin)
	strategyID := "e2e-" + uuid.NewString()
	prices := `[` + strings.TrimRight(strings.Repeat("100,", 30), ",") + `]`

	// 1. Member starts at NOT_STARTED and has no access.
	m := wantStatus(t, do(t, router, http.MethodGet, "/api/v1/trading/kyc/status", "", ""), 200, "kyc status")
	if m["status"] != "NOT_STARTED" || m["has_access"] != false {
		t.Fatalf("fresh member status = %v", m)
	}

	// 2. Money path is access-gated BEFORE module-KYC approval.
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/subscribe", `{"amount_kobo":1000000}`, "gated:"+uuid.NewString()), 403, "subscribe without module KYC")
	if m["code"] != "MODULE_KYC_REQUIRED" {
		t.Fatalf("gate code = %v", m)
	}

	// 3. Module-KYC lifecycle over HTTP: submit → queue → review → approve.
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/kyc/submit", "", ""), 200, "kyc submit")
	q := wantStatus(t, do(t, router, http.MethodGet, "/api/v1/admin/trading/kyc/queue", "", ""), 200, "admin queue")
	found := false
	for _, r := range q["data"].([]any) {
		if r.(map[string]any)["user_id"] == member {
			found = true
		}
	}
	if !found {
		t.Fatalf("submitted member missing from review queue: %v", q["data"])
	}
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/kyc/"+member+"/review", "", ""), 200, "admin start review")
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/kyc/"+member+"/approve", `{"reason_code":"e2e"}`, ""), 200, "admin approve")
	m = wantStatus(t, do(t, router, http.MethodGet, "/api/v1/trading/kyc/status", "", ""), 200, "kyc status after approve")
	if m["has_access"] != true {
		t.Fatalf("member approved but has_access=false")
	}

	// 4. Idempotency-Key is required on money mutations.
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/subscribe", `{"amount_kobo":1000000}`, ""), 400, "subscribe without idem key")

	// 5. Subscribe mints units at par NAV and the ledger wallet leg debits cash.
	subKey := "e2e-http-sub:" + uuid.NewString()
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/subscribe", `{"amount_kobo":2000000}`, subKey), 200, "subscribe")
	if m["units_minted"].(float64) <= 0 {
		t.Fatalf("subscribe minted %v units", m["units_minted"])
	}
	// Replay: same key returns the pinned result, never double-mints.
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/subscribe", `{"amount_kobo":2000000}`, subKey), 200, "subscribe replay")
	if m["units_minted"].(float64) != 2000000 {
		t.Fatalf("replayed subscribe minted %v", m["units_minted"])
	}
	if bal, err := led.GetBalance(ctx, member); err != nil || bal != 3_000_000 {
		t.Fatalf("wallet balance after subscribe = %v err=%v, want 3000000", bal, err)
	}
	m = wantStatus(t, do(t, router, http.MethodGet, "/api/v1/trading/wallet", "", ""), 200, "position")
	if m["units"].(float64) != 2000000 {
		t.Fatalf("position units = %v", m["units"])
	}

	// 6. Redeem burns units → cash; over-redeem and key-collision both fail closed.
	redKey := "e2e-http-red:" + uuid.NewString()
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/redeem", `{"units":1000000}`, redKey), 200, "redeem")
	if m["cash_kobo"].(float64) != 1000000 {
		t.Fatalf("redeem cash = %v", m["cash_kobo"])
	}
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/redeem", `{"units":99999999}`, "over:"+uuid.NewString()), 409, "over-redeem")
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/wallet/redeem", `{"units":1}`, subKey), 409, "idem key reuse across kinds")
	if bal, err := led.GetBalance(ctx, member); err != nil || bal != 4_000_000 {
		t.Fatalf("wallet balance after redeem = %v err=%v, want 4000000", bal, err)
	}

	// 7. The member surface never reaches the admin routes: same user id on the
	// admin group, but no permission — RequirePermission + denyRBAC fail closed.
	memberSide := gin.New()
	mem2 := memberSide.Group("/api/v1/trading")
	mem2.Use(injectUser(member))
	adm2 := memberSide.Group("/api/v1/admin/trading")
	adm2.Use(injectUser(member))
	Register(mem2, adm2, pool, denyRBAC{}, led, 2000, 0, true)
	wantStatus(t, do(t, memberSide, http.MethodGet, "/api/v1/admin/trading/kyc/queue", "", ""), 403, "member on admin route")

	// 8. /evaluate is strategy-stage gated: unregistered → 403; paper → 200.
	evalBody := fmt.Sprintf(`{"strategy_id":%q,"asset":"BTC","prices":%s,"liquidity_score_bps":8000}`, strategyID, prices)
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/evaluate", evalBody, ""), 403, "evaluate unregistered strategy")
	if m["code"] != "STRATEGY_NOT_ELIGIBLE" {
		t.Fatalf("evaluate gate code = %v", m)
	}
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/promotions/"+strategyID+"/register", "", ""), 200, "register strategy")
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/promotions/"+strategyID+"/promote", `{"to_stage":"paper","maker_id":"`+uuid.NewString()+`"}`, ""), 200, "promote to paper")
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/trading/evaluate", evalBody, ""), 200, "evaluate paper strategy")
	if m["executed"] != false || m["stage"] != "paper" {
		t.Fatalf("evaluate response = %v", m)
	}

	// 9. Ladder gate: paper→shadow without a validation verdict is denied 403.
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/promotions/"+strategyID+"/promote", `{"to_stage":"shadow","maker_id":"`+uuid.NewString()+`"}`, ""), 403, "promote without readiness")
	if m["code"] != "LADDER_DENIED" {
		t.Fatalf("ladder denial code = %v", m)
	}
	wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/promotions/"+strategyID+"/readiness", `{"validation_passed":true,"track_record_days":30}`, ""), 200, "set readiness")
	m = wantStatus(t, do(t, router, http.MethodPost, "/api/v1/admin/trading/promotions/"+strategyID+"/halt", `{"reason":"e2e"}`, ""), 200, "halt")
	if m["stage"] != "halted" {
		t.Fatalf("halt stage = %v", m)
	}
}
