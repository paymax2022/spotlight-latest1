package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test that all admin console endpoints are accessible and return valid responses.
//
// ⚠️ GATED ON TEST_DATABASE_URL, DELIBERATELY WITH NO FALLBACK TO DATABASE_URL:
// the root .env points DATABASE_URL at the PRODUCTION Supabase pooler, and the
// DB-backed tests below INSERT fixtures. Run against a local database only:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/handlers/ -run TestAdminConsole -v
//
// The DB-backed endpoints here are GLOBAL reads (every user, every payout, every
// audit row) — there is no owner to scope them to. So these tests never assert a
// global row count: they seed uniquely-identifiable fixtures and assert those
// fixtures appear, correctly shaped, in the response. Asserting exact counts is
// what made the earlier revision of this file depend on a developer's populated
// database and skip silently in CI for months.

// adminTestPool dials the LOCAL test database, or skips.
func adminTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; admin console endpoints require a live database")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedAdminUser creates a throwaway auth.users row and returns its id.
//
// email is required even though the column is nullable: a trigger on auth.users
// (on_auth_user_created) mirrors the row into user_profiles, whose email column
// is NOT NULL. .invalid is reserved by RFC 2606, so a fixture address can never
// be a routable one.
//
// created_at is set explicitly rather than left to a default: GoTrue populates it
// from the application, so real Supabase declares auth.users.created_at with NO
// default (only the CI compat shim adds one). Leaving it NULL puts the fixture at
// the very END of ListUsers' created_at DESC NULLS LAST ordering, off page 1.
//
// The row is deleted on cleanup — user_profiles cascades from it — so repeated
// local runs against the same database stay stable.
func seedAdminUser(t *testing.T, pool *pgxpool.Pool, label string) (id string, email string) {
	t.Helper()
	ctx := context.Background()
	id = uuid.NewString()
	email = fmt.Sprintf("admin-console-%s-%s@example.invalid", label, id)
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, created_at) VALUES ($1, $2, now())`,
		id, email); err != nil {
		t.Fatalf("seed auth.users (%s): %v", label, err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM auth.users WHERE id = $1`, id); err != nil {
			t.Logf("cleanup auth.users %s: %v", id, err)
		}
	})
	return id, email
}

// seedAdminProfile fills in the user_profiles row the auth.users trigger created.
func seedAdminProfile(t *testing.T, pool *pgxpool.Pool, userID, fullName string, tier int) {
	t.Helper()
	res, err := pool.Exec(context.Background(), `
		UPDATE user_profiles SET full_name = $2, kyc_tier = $3, phone = '+2348000000000'
		 WHERE id = $1`, userID, fullName, tier)
	if err != nil {
		t.Fatalf("seed user_profiles %s: %v", userID, err)
	}
	// If the mirroring trigger ever stops firing, an UPDATE silently touching no
	// row would leave the assertions below asserting nothing.
	require.EqualValues(t, 1, res.RowsAffected(),
		"expected the auth.users trigger to have mirrored a user_profiles row for %s", userID)
}

// seedPendingKyc puts a user's profile into the state GetKYCQueue selects on.
//
// 'pending' — not 'submitted'. The store's predicate is
// `kyc_status IN ('submitted','pending')`, but user_profiles_kyc_status_check
// only permits unverified/pending/verified/failed/suspended, so 'submitted' can
// never match a row.
func seedPendingKyc(t *testing.T, pool *pgxpool.Pool, userID string, requestedTier int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		UPDATE user_profiles
		   SET kyc_status = 'pending',
		       kyc_requested_tier = $2,
		       document_type = 'NIN',
		       kyc_submitted_at = now()
		 WHERE id = $1`, userID, requestedTier); err != nil {
		t.Fatalf("seed pending kyc %s: %v", userID, err)
	}
}

// seedPayout inserts one pending payout for userID and returns its id.
func seedPayout(t *testing.T, pool *pgxpool.Pool, userID string, amountKobo int64) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	ref := "adm-test-" + id
	if _, err := pool.Exec(ctx, `
		INSERT INTO payouts (id, user_id, reference, amount_kobo, status,
		                     bank_name, account_number, idempotency_key)
		VALUES ($1, $2, $3, $4, 'pending', 'Test Bank', '0123456789', $3)`,
		id, userID, ref, amountKobo); err != nil {
		t.Fatalf("seed payout: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM payouts WHERE id = $1`, id); err != nil {
			t.Logf("cleanup payout %s: %v", id, err)
		}
	})
	return id
}

// seedAuditLog inserts one audit row and returns its id. actor_user_id is FK'd to
// platform_users, which is a different table from auth.users, so the actor gets
// seeded there.
func seedAuditLog(t *testing.T, pool *pgxpool.Pool, action string) string {
	t.Helper()
	ctx := context.Background()
	actorID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO platform_users (id, first_name, last_name, email)
		VALUES ($1, 'Audit', 'Actor', $2)`,
		actorID, "admin-console-actor-"+actorID+"@example.invalid"); err != nil {
		t.Fatalf("seed platform_users actor: %v", err)
	}
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO audit_logs (id, actor_user_id, action, module, resource_type,
		                        resource_id, old_values, new_values, severity)
		VALUES ($1, $2, $3, 'admin_console', 'fixture', $4, '{}'::jsonb, '{}'::jsonb, 'info')`,
		id, actorID, action, "res-"+id); err != nil {
		t.Fatalf("seed audit_logs: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `DELETE FROM audit_logs WHERE id = $1`, id); err != nil {
			t.Logf("cleanup audit_logs %s: %v", id, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM platform_users WHERE id = $1`, actorID); err != nil {
			t.Logf("cleanup platform_users %s: %v", actorID, err)
		}
	})
	return id
}

// seedCryptoOrder inserts one crypto order (the 'crypto' leg of the admin order
// union) and returns its id, the catalogue symbol, and the provider reference —
// the caller asserts the endpoint surfaces all three rather than hardcoding them.
func seedCryptoOrder(t *testing.T, pool *pgxpool.Pool, userID, status, side string, cashKobo int64) (id, symbol, providerRef string) {
	t.Helper()
	ctx := context.Background()
	assetID := uuid.NewString()
	// crypto_assets.symbol is UNIQUE, so the fixture asset needs a unique symbol.
	// is_active defaults to TRUE and packages run concurrently against one
	// database — an active fixture asset would show up in another suite's
	// catalogue listing, so it is created inactive. The order union LEFT JOINs
	// this row for its symbol, and a LEFT JOIN ignores is_active.
	symbol = "ADMTEST" + assetID[:8]
	if _, err := pool.Exec(ctx, `
		INSERT INTO crypto_assets (id, symbol, name, is_active)
		VALUES ($1, $2, 'Admin Console Fixture', false)`,
		assetID, symbol); err != nil {
		t.Fatalf("seed crypto_assets: %v", err)
	}
	id = uuid.NewString()
	providerRef = "prov-cr-" + id
	if _, err := pool.Exec(ctx, `
		INSERT INTO crypto_orders (id, user_id, asset_id, side, status, cash_kobo,
		                           units, price_kobo, idempotency_key, reference)
		VALUES ($1, $2, $3, $4, $5, $6, 1000, 500, $7, $8)`,
		id, userID, assetID, side, status, cashKobo, "adm-test-"+id, providerRef); err != nil {
		t.Fatalf("seed crypto_orders: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `DELETE FROM crypto_orders WHERE id = $1`, id); err != nil {
			t.Logf("cleanup crypto_orders %s: %v", id, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM crypto_assets WHERE id = $1`, assetID); err != nil {
			t.Logf("cleanup crypto_assets %s: %v", assetID, err)
		}
	})
	return id, symbol, providerRef
}

// seedInvestOrder inserts one stock order (the 'stock' leg of the admin order
// union) and returns its id, symbol and provider reference.
// invest_orders.user_id is text, not a uuid FK.
func seedInvestOrder(t *testing.T, pool *pgxpool.Pool, userID, status, side string, totalKobo int64) (id, symbol, providerRef string) {
	t.Helper()
	ctx := context.Background()
	assetID := uuid.NewString()
	symbol = "ADMT" + assetID[:6]
	// status defaults to 'active'; created inactive for the same reason the crypto
	// fixture asset is (see seedCryptoOrder). buy_enabled/sell_enabled already
	// default to false.
	if _, err := pool.Exec(ctx, `
		INSERT INTO invest_stock_assets (id, symbol, name, status)
		VALUES ($1, $2, 'Admin Console Fixture', 'inactive')`,
		assetID, symbol); err != nil {
		t.Fatalf("seed invest_stock_assets: %v", err)
	}
	id = uuid.NewString()
	providerRef = "prov-st-" + id
	if _, err := pool.Exec(ctx, `
		INSERT INTO invest_orders (id, user_id, stock_asset_id, symbol, side, status,
		                           amount_kobo, total_amount_kobo, idempotency_key,
		                           provider_reference)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
		id, userID, assetID, symbol, side, status, totalKobo, "adm-test-"+id,
		providerRef); err != nil {
		t.Fatalf("seed invest_orders: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `DELETE FROM invest_orders WHERE id = $1`, id); err != nil {
			t.Logf("cleanup invest_orders %s: %v", id, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM invest_stock_assets WHERE id = $1`, assetID); err != nil {
			t.Logf("cleanup invest_stock_assets %s: %v", assetID, err)
		}
	})
	return id, symbol, providerRef
}

// adminGet issues an authenticated admin GET and returns the recorder.
func adminGet(t *testing.T, r *gin.Engine, path, role string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", path, nil)
	req.Header.Set("X-Admin-Role", role)
	r.ServeHTTP(w, req)
	return w
}

func setupAdminConsoleRouter(t *testing.T) *gin.Engine {
	t.Helper()
	return setupAdminConsoleRouterWithPool(t, adminTestPool(t))
}

func setupAdminConsoleRouterWithPool(t *testing.T, pool *pgxpool.Pool) *gin.Engine {
	t.Helper()
	r := gin.New()
	handler := NewAdminConsoleHandler(NewAdminStore(pool))

	// Simulate the middleware that validates X-Admin-Role
	r.Use(func(c *gin.Context) {
		role := c.GetHeader("X-Admin-Role")
		if role == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing X-Admin-Role"})
			c.Abort()
			return
		}
		c.Set("adminRole", role)
		c.Next()
	})

	// Register all routes
	admin := r.Group("/api/v1/admin")
	admin.GET("/dashboard", handler.Dashboard)
	admin.GET("/users", handler.GetUsers)
	admin.GET("/users/:id", handler.GetUser)
	admin.GET("/kyc", handler.GetKycQueue)
	admin.POST("/kyc/:id/review", handler.ReviewKyc)
	admin.GET("/assets", handler.GetAssetControls)
	admin.PATCH("/assets/:id", handler.UpdateAssetControl)
	admin.GET("/orders", handler.GetOrders)
	admin.GET("/withdrawals", handler.GetWithdrawalQueue)
	admin.POST("/withdrawals/:ref/review", handler.ReviewWithdrawal)
	admin.GET("/reconciliation", handler.GetReconciliation)
	admin.GET("/providers", handler.GetProviders)
	admin.GET("/risk-limits", handler.GetRiskLimits)
	admin.PATCH("/risk-limits/:id", handler.UpdateRiskLimit)
	admin.GET("/fees", handler.GetFees)
	admin.PATCH("/fees/:id", handler.UpdateFee)
	admin.GET("/feature-flags", handler.GetFeatureFlags)
	admin.PATCH("/feature-flags/:key", handler.SetFeatureFlag)
	admin.GET("/approvals", handler.GetApprovals)
	admin.POST("/approvals/:id/approve", handler.Approve)
	admin.POST("/approvals/:id/reject", handler.RejectApproval)
	admin.GET("/audit", handler.GetAudit)
	admin.GET("/admins", handler.GetAdmins)

	return r
}

// Every dashboard number is a PLATFORM-WIDE aggregate, so this asserts lower
// bounds against seeded fixtures rather than exact values or a before/after
// delta. `go test ./...` runs packages concurrently against one database and
// several other suites seed auth.users and post ledger entries, so an exact
// count — or a delta across two requests — would be flaky by construction.
//
// The bug this guards is a 500: the aggregate query referenced orders.amount_kobo,
// a column public.orders does not have, so the endpoint failed unconditionally.
func TestAdminConsole_Dashboard(t *testing.T) {
	pool := adminTestPool(t)
	r := setupAdminConsoleRouterWithPool(t, pool)

	userID, _ := seedAdminUser(t, pool, "dash")
	seedPendingKyc(t, pool, userID, 2)
	// activeOrders counts the trading union's non-terminal states. Seeded so a
	// regression to a lower-case 'pending' comparison — which the status
	// normalisation in tradingOrdersSQL made dead — shows up as a zero here.
	seedCryptoOrder(t, pool, userID, "pending", "buy", 75_000)

	w := adminGet(t, r, "/api/v1/admin/dashboard", "SuperAdmin")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &data))

	require.Contains(t, data, "users")
	require.Contains(t, data, "openKyc")
	require.Contains(t, data, "revenueToday")

	users, ok := data["users"].(float64)
	require.True(t, ok, "users must be numeric, got %#v", data["users"])
	assert.GreaterOrEqual(t, users, float64(1), "the seeded auth.users row must be counted")

	openKyc, ok := data["openKyc"].(float64)
	require.True(t, ok, "openKyc must be numeric, got %#v", data["openKyc"])
	assert.GreaterOrEqual(t, openKyc, float64(1), "the seeded pending-KYC profile must be counted")

	// tradingVolume comes from the ledger and moves underneath this test as other
	// suites run, so only presence and type are asserted.
	assert.IsType(t, float64(0), data["failedOrders"])
	assert.Contains(t, data, "tradingVolume")

	// ActiveOrders is computed but not exposed in the dashboard JSON, so assert it
	// on the store directly — otherwise the trading-union half of the aggregate
	// query has no coverage at all.
	stats, err := NewAdminStore(pool).GetDashboardStats(context.Background())
	require.NoError(t, err)
	assert.GreaterOrEqual(t, stats.ActiveOrders, int64(1),
		"the seeded pending crypto order must count as active — a lower-case 'pending' comparison would make this 0")
	assert.GreaterOrEqual(t, stats.TotalUsers, int64(1))
	assert.GreaterOrEqual(t, stats.KYCPending, int64(1))
}

// GetUsers returns a PAGE ENVELOPE ({users,total,limit,offset}), not a bare
// array — the earlier revision of this test unmarshalled into []map and asserted
// three hardcoded mock users, so it could not have passed against any real
// database.
func TestAdminConsole_GetUsers(t *testing.T) {
	pool := adminTestPool(t)
	r := setupAdminConsoleRouterWithPool(t, pool)

	type seeded struct {
		id, email, name string
		tier            int
	}
	want := make([]seeded, 0, 3)
	for i, name := range []string{"Alice Fixture", "Bob Fixture", "Carol Fixture"} {
		id, email := seedAdminUser(t, pool, fmt.Sprintf("users%d", i))
		seedAdminProfile(t, pool, id, name, i)
		want = append(want, seeded{id: id, email: email, name: name, tier: i})
	}

	// The store orders by created_at DESC, so the rows just seeded are the newest
	// and sit on the first page; the explicit limit keeps that true on a database
	// with a large ambient user table.
	w := adminGet(t, r, "/api/v1/admin/users?limit=500", "SuperAdmin")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var page struct {
		Users []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Email   string `json:"email"`
			Status  string `json:"status"`
			KycTier int    `json:"kycTier"`
		} `json:"users"`
		Total  int64 `json:"total"`
		Limit  int   `json:"limit"`
		Offset int   `json:"offset"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Equal(t, 500, page.Limit)
	assert.Equal(t, 0, page.Offset)
	assert.GreaterOrEqual(t, page.Total, int64(len(want)), "total must count at least the seeded users")

	byID := map[string]int{}
	for i, u := range page.Users {
		byID[u.ID] = i
	}
	for _, exp := range want {
		idx, found := byID[exp.id]
		if !assert.True(t, found, "seeded user %s (%s) missing from the page", exp.id, exp.email) {
			continue
		}
		got := page.Users[idx]
		assert.Equal(t, exp.email, got.Email)
		assert.Equal(t, exp.name, got.Name, "full_name must come from the joined user_profiles row")
		assert.Equal(t, exp.tier, got.KycTier)
		// raw_user_meta_data carries no status for these fixtures, so the store's
		// COALESCE default must surface rather than an empty string.
		assert.Equal(t, "active", got.Status)
	}
}

func TestAdminConsole_GetUser(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/users/usr_001", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var user map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &user)
	assert.NoError(t, err)
	assert.Equal(t, "usr_001", user["id"])
	assert.Equal(t, "Alice Johnson", user["name"])
}

// GetKycQueue returns {"cases":[...]}, not a bare array.
func TestAdminConsole_GetKycQueue(t *testing.T) {
	pool := adminTestPool(t)
	r := setupAdminConsoleRouterWithPool(t, pool)

	tierOf := map[string]int{}
	for i, tier := range []int{1, 2} {
		id, _ := seedAdminUser(t, pool, fmt.Sprintf("kyc%d", i))
		seedAdminProfile(t, pool, id, fmt.Sprintf("Kyc Fixture %d", i), 0)
		seedPendingKyc(t, pool, id, tier)
		tierOf[id] = tier
	}

	w := adminGet(t, r, "/api/v1/admin/kyc", "ComplianceAdmin")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var body struct {
		Cases []struct {
			ID     string `json:"id"`
			UserID string `json:"userId"`
			Name   string `json:"name"`
			Status string `json:"status"`
			Tier   int    `json:"tier"`
		} `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))

	got := map[string]int{}
	statuses := map[string]string{}
	for _, c := range body.Cases {
		got[c.UserID] = c.Tier
		statuses[c.UserID] = c.Status
	}
	for id, tier := range tierOf {
		if !assert.Contains(t, got, id, "submitted KYC profile %s missing from the queue", id) {
			continue
		}
		assert.Equal(t, tier, got[id])
		assert.Equal(t, fmt.Sprintf("pending_tier%d", tier), statuses[id],
			"the store maps kyc_requested_tier onto a pending_tierN status")
	}
}

func TestAdminConsole_ReviewKyc(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"decision":"approve","reason":"All checks passed"}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/kyc/kyc_001/review", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "ComplianceAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "approve", result["status"])
}

func TestAdminConsole_GetAssets(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/assets", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var assets []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &assets)
	assert.NoError(t, err)
	// require, not assert: assert.Len records the failure and carries on, so the
	// indexed read below would panic on a short slice and take the whole package
	// down instead of failing this one test.
	require.Len(t, assets, 3) // BTC, ETH, AAPL
	assert.Equal(t, "BTC", assets[0]["symbol"])
}

func TestAdminConsole_UpdateAsset(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"buyEnabled":false,"feeBps":100}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/assets/ast_001", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "RiskAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, false, result["buyEnabled"])
	assert.Equal(t, float64(100), result["feeBps"])
}

// Orders span two tables — crypto_orders and invest_orders — because there is no
// single trading `orders` table (public.orders is the restaurant module's). Both
// legs of that union are seeded so a regression to a single-table query fails
// here rather than 500ing in production.
//
// The endpoint caps at LIMIT 100 ordered by created_at DESC. That is safe to
// assert against under concurrent packages because the fixtures are seeded
// immediately before the read: only 100+ orders created inside that millisecond
// window could displace them.
func TestAdminConsole_GetOrders(t *testing.T) {
	pool := adminTestPool(t)
	r := setupAdminConsoleRouterWithPool(t, pool)

	userID, email := seedAdminUser(t, pool, "orders")
	failedCrypto, cryptoSymbol, cryptoProviderRef := seedCryptoOrder(t, pool, userID, "failed", "sell", 250_000)
	pendingCrypto, _, _ := seedCryptoOrder(t, pool, userID, "pending", "buy", 125_000)
	filledStock, stockSymbol, stockProviderRef := seedInvestOrder(t, pool, userID, "Filled", "buy", 900_000)
	// 'Submitted' is a real invest.OrderStatus but is NOT in the console's
	// AdminOrderStatus union, so it must be folded onto 'Processing' — a raw
	// leak here would render an unstyled status pill in the app.
	submittedStock, _, _ := seedInvestOrder(t, pool, userID, "Submitted", "sell", 400_000)

	type order struct {
		Ref         string `json:"ref"`
		User        string `json:"user"`
		Kind        string `json:"kind"`
		Status      string `json:"status"`
		Side        string `json:"side"`
		Symbol      string `json:"symbol"`
		ProviderRef string `json:"providerRef"`
		Amount      struct {
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
		} `json:"amount"`
	}
	get := func(query string) map[string]order {
		t.Helper()
		w := adminGet(t, r, "/api/v1/admin/orders"+query, "SuperAdmin")
		require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
		var got []order
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		byRef := map[string]order{}
		for _, o := range got {
			byRef[o.Ref] = o
		}
		return byRef
	}

	all := get("?filter=all")
	require.Contains(t, all, failedCrypto, "crypto leg of the order union is missing")
	require.Contains(t, all, filledStock, "stock leg of the order union is missing")
	assert.Contains(t, all, pendingCrypto)

	assert.Equal(t, "crypto", all[failedCrypto].Kind)
	assert.Equal(t, int64(250_000), all[failedCrypto].Amount.Amount)
	assert.Equal(t, email, all[failedCrypto].User, "email is joined from auth.users")

	assert.Equal(t, "stock", all[filledStock].Kind)
	assert.Equal(t, int64(900_000), all[filledStock].Amount.Amount)
	assert.Equal(t, email, all[filledStock].User,
		"invest_orders.user_id is text, so the email join must compare auth.users.id as text")

	// side / symbol / providerRef were hardcoded to "buy" / "" / "" behind
	// Phase-2 TODOs. The console renders side as the trade direction, prints
	// providerRef on every row, and its search box filters on symbol and
	// providerRef — so hardcoded values made search dead and mislabelled sells.
	// Distinct fixture values per leg prove each field is really projected.
	assert.Equal(t, "sell", all[failedCrypto].Side, "crypto side must come from the row, not a hardcoded 'buy'")
	assert.Equal(t, "buy", all[pendingCrypto].Side)
	assert.Equal(t, "buy", all[filledStock].Side)
	assert.Equal(t, "sell", all[submittedStock].Side)

	assert.Equal(t, cryptoSymbol, all[failedCrypto].Symbol,
		"crypto symbol must come from the crypto_assets LEFT JOIN")
	assert.Equal(t, stockSymbol, all[filledStock].Symbol,
		"stock symbol must come from invest_orders.symbol")

	assert.Equal(t, cryptoProviderRef, all[failedCrypto].ProviderRef,
		"crypto providerRef must come from crypto_orders.reference")
	assert.Equal(t, stockProviderRef, all[filledStock].ProviderRef,
		"stock providerRef must come from invest_orders.provider_reference")

	// Status must land on the console's AdminOrderStatus union. The client keys
	// ORDER_STATUS_STYLE off these exact strings, so casing is a contract, not a
	// cosmetic detail: crypto's lower-case states are mapped UP, and invest
	// states outside the union are folded onto the nearest member.
	assert.Equal(t, "Failed", all[failedCrypto].Status, "crypto 'failed' must map to 'Failed'")
	assert.Equal(t, "Pending", all[pendingCrypto].Status, "crypto 'pending' must map to 'Pending'")
	assert.Equal(t, "Filled", all[filledStock].Status)
	assert.Equal(t, "Processing", all[submittedStock].Status,
		"invest 'Submitted' is outside AdminOrderStatus and must fold onto 'Processing'")

	// The failed/pending filters mirror the console's KPI tiles: failed counts
	// Failed+Reversed, pending counts Pending+Processing.
	failed := get("?filter=failed")
	assert.Contains(t, failed, failedCrypto)
	assert.NotContains(t, failed, pendingCrypto, "?filter=failed must exclude pending orders")
	assert.NotContains(t, failed, filledStock, "?filter=failed must exclude filled orders")
	assert.Equal(t, "Failed", failed[failedCrypto].Status)

	pending := get("?filter=pending")
	assert.Contains(t, pending, pendingCrypto)
	assert.Contains(t, pending, submittedStock, "?filter=pending must include Processing orders")
	assert.NotContains(t, pending, failedCrypto)
	assert.NotContains(t, pending, filledStock)

	stock := get("?filter=stock")
	assert.Contains(t, stock, filledStock)
	assert.NotContains(t, stock, failedCrypto, "?filter=stock must exclude crypto orders")
}

func TestAdminConsole_GetWithdrawals(t *testing.T) {
	pool := adminTestPool(t)
	r := setupAdminConsoleRouterWithPool(t, pool)

	userID, email := seedAdminUser(t, pool, "wd")
	wantAmount := map[string]int64{
		seedPayout(t, pool, userID, 500_000):   500_000,
		seedPayout(t, pool, userID, 1_250_000): 1_250_000,
	}

	w := adminGet(t, r, "/api/v1/admin/withdrawals", "SuperAdmin")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var withdrawals []struct {
		Reference string `json:"reference"`
		User      string `json:"user"`
		Status    string `json:"status"`
		Address   string `json:"address"`
		Amount    struct {
			Amount int64 `json:"amount"`
		} `json:"amount"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &withdrawals))

	byRef := map[string]int{}
	for i, wd := range withdrawals {
		byRef[wd.Reference] = i
	}
	for id, amount := range wantAmount {
		idx, found := byRef[id]
		if !assert.True(t, found, "seeded payout %s missing from the withdrawal queue", id) {
			continue
		}
		assert.Equal(t, amount, withdrawals[idx].Amount.Amount)
		assert.Equal(t, "pending", withdrawals[idx].Status)
		assert.Equal(t, email, withdrawals[idx].User)
		assert.Equal(t, "0123456789", withdrawals[idx].Address)
	}
}

func TestAdminConsole_ReviewWithdrawal(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"decision":"approve","reason":"Risk score acceptable"}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/withdrawals/WD-001-XYZ/review", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "approve", result["status"])
}

func TestAdminConsole_GetReconciliation(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/reconciliation", nil)
	req.Header.Set("X-Admin-Role", "FinanceAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var recon map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &recon)
	assert.NoError(t, err)
	assert.Contains(t, recon, "exceptions")
}

func TestAdminConsole_GetProviders(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/providers", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var providers []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &providers)
	assert.NoError(t, err)
	require.Len(t, providers, 3) // require: guards the indexed read below
	assert.Equal(t, "healthy", providers[0]["status"])
}

func TestAdminConsole_GetRiskLimits(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/risk-limits", nil)
	req.Header.Set("X-Admin-Role", "RiskAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var limits []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &limits)
	assert.NoError(t, err)
	assert.Len(t, limits, 3)
}

func TestAdminConsole_UpdateRiskLimit(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"valueMinor":20000000}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/risk-limits/rl_001", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "RiskAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, float64(20000000), result["valueMinor"])
}

func TestAdminConsole_GetFees(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/fees", nil)
	req.Header.Set("X-Admin-Role", "FinanceAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var fees []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &fees)
	assert.NoError(t, err)
	assert.Len(t, fees, 3)
}

func TestAdminConsole_UpdateFee(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"bps":100}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/fees/fee_001", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "FinanceAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, float64(100), result["bps"])
}

func TestAdminConsole_GetFeatureFlags(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/feature-flags", nil)
	req.Header.Set("X-Admin-Role", "ProductAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var flags []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &flags)
	assert.NoError(t, err)
	assert.Len(t, flags, 4)
}

func TestAdminConsole_SetFeatureFlag(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"enabled":true}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/feature-flags/ENABLE_STOCK_TRADING", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "ProductAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, true, result["enabled"])
}

func TestAdminConsole_GetApprovals(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/approvals", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var approvals []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &approvals)
	assert.NoError(t, err)
	require.Len(t, approvals, 2) // require: guards the indexed read below
	assert.Equal(t, "pending", approvals[0]["status"])
}

func TestAdminConsole_Approve(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/approvals/app_001/approve", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "approved", result["status"])
}

func TestAdminConsole_RejectApproval(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	body := []byte(`{"reason":"Insufficient supporting documentation"}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/approvals/app_001/reject", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "rejected", result["status"])
}

// The audit read is LIMIT 100 ordered by created_at DESC, so freshly-seeded rows
// are always on the first page.
func TestAdminConsole_GetAudit(t *testing.T) {
	pool := adminTestPool(t)
	r := setupAdminConsoleRouterWithPool(t, pool)

	wantAction := map[string]string{
		seedAuditLog(t, pool, "fixture.approve"): "fixture.approve",
		seedAuditLog(t, pool, "fixture.reject"):  "fixture.reject",
	}

	w := adminGet(t, r, "/api/v1/admin/audit", "SuperAdmin")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var entries []struct {
		ID       string `json:"id"`
		Actor    string `json:"actor"`
		Action   string `json:"action"`
		Module   string `json:"module"`
		Severity string `json:"severity"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &entries))

	byID := map[string]int{}
	for i, e := range entries {
		byID[e.ID] = i
	}
	for id, action := range wantAction {
		idx, found := byID[id]
		if !assert.True(t, found, "seeded audit row %s missing from the audit read", id) {
			continue
		}
		assert.Equal(t, action, entries[idx].Action)
		assert.Equal(t, "admin_console", entries[idx].Module)
		assert.Equal(t, "info", entries[idx].Severity)
		assert.NotEmpty(t, entries[idx].Actor, "actor_user_id must survive the projection")
	}
}

func TestAdminConsole_GetAdmins(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/admins", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var admins []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &admins)
	assert.NoError(t, err)
	assert.Len(t, admins, 3)
}

func TestAdminConsole_MissingRole(t *testing.T) {
	r := setupAdminConsoleRouter(t)
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/dashboard", nil)
	// No X-Admin-Role header
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
