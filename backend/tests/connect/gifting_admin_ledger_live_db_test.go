package connect_test

// ---------------------------------------------------------------------------
// CONNECT-001 (P0 blocker) — the admin "Gift transactions ledger" page
// (frontend-admin/app/admin/connect/gifting/page.tsx, via
// connectAdminService.ts listGifts() -> GET /api/connect/admin/gifts) 404'd
// in production: connectgifting.Register() only ever wired the MEMBER group
// (/gifts, /gifts/sent, /gifts/catalog); there was no admin registration.
//
// This live-DB test proves, against a real Postgres + the real RBAC RPCs
// (user_has_permission), the three things that actually matter for the fix:
//
//   1. The admin list route (connectgifting.RegisterAdmin -> ListAdmin) reads
//      REAL connect_gifts rows (seeded here, not mocked) and maps them into
//      the shape the admin UI expects.
//   2. RBAC actually blocks a caller without connect.gifting.view — a plain
//      registered user, not just "no token".
//   3. The status / limit_state filters the UI sends behave correctly,
//      including the deliberate limit_state short-circuit (see admin.go:
//      every row is "within" by construction, so any other requested value
//      must come back empty).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
//	export SUPABASE_URL="http://127.0.0.1:54321"
//	export SUPABASE_SERVICE_ROLE_KEY="<local service role key>"
//	cd backend && go test ./tests/connect/... -run TestGiftingAdminLedger -v
// ---------------------------------------------------------------------------

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

	connectgifting "spotlight/backend/internal/connect/gifting"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/repositories"
	"spotlight/backend/internal/services"
)

func giftingSupabaseForTest(t *testing.T) *integrations.SupabaseRestClient {
	t.Helper()
	url := strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY"))
	if url == "" || key == "" {
		t.Skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping live-DB gifting admin ledger test")
	}
	return integrations.NewSupabaseRestClient(url, key)
}

type giftingAdminRow struct {
	ID          string `json:"id"`
	Reference   string `json:"reference"`
	SenderID    string `json:"sender_id"`
	RecipientID string `json:"recipient_id"`
	GiftLabel   string `json:"gift_label"`
	AmountKobo  int64  `json:"amount_kobo"`
	FeeKobo     int64  `json:"fee_kobo"`
	LimitState  string `json:"limit_state"`
	Status      string `json:"status"`
}

func TestGiftingAdminLedger_ListsRealRowsEnforcesRBACAndFilters(t *testing.T) {
	ctx := context.Background()
	pool := blockLiveDBPool(t)
	t.Cleanup(pool.Close)
	supabase := giftingSupabaseForTest(t)

	// --- Seed two auth.users (the gift parties) + two platform_users (the
	// admin caller and the blocked, permission-less caller) ---
	sender := uuid.NewString()
	recipient := uuid.NewString()
	for _, u := range []string{sender, recipient} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@gifting-admin.test"); err != nil {
			t.Fatalf("seed auth user %s: %v", u, err)
		}
	}

	adminCaller := seedGiftingAdminPlatformUser(t, ctx, pool)
	plainCaller := seedGiftingAdminPlatformUser(t, ctx, pool)

	var moderatorRoleID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM roles WHERE slug = 'connect-moderator'`).Scan(&moderatorRoleID); err != nil {
		t.Fatalf("lookup connect-moderator role (expects migration 20260627000000_connect_rbac.sql applied): %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_roles (user_id, role_id, scope_type, is_active) VALUES ($1,$2,'global',true)
		ON CONFLICT (user_id, role_id, scope_type, scope_id) DO NOTHING`,
		adminCaller, moderatorRoleID); err != nil {
		t.Fatalf("grant connect-moderator to admin caller: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2`, adminCaller, moderatorRoleID)
	})

	// Sanity check: the migration this test exercises must actually be
	// applied, or connect.gifting.view does not exist and every check below
	// would trivially "pass" as a false negative (permission always denied).
	var permCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM permissions WHERE slug = 'connect.gifting.view'`).Scan(&permCount); err != nil {
		t.Fatalf("check connect.gifting.view permission exists: %v", err)
	}
	if permCount == 0 {
		t.Fatal("connect.gifting.view permission not found — run supabase/migrations/20270301000000_connect_gifting_admin_rbac.sql against the test DB first")
	}

	// --- Seed two real connect_gifts rows directly (the money path itself —
	// Service.Send / the ledger transfer — is covered by other tests; this
	// test is about the ADMIN READ surface reading what Send() would have
	// written) ---
	sentRef := "connect:gift:test:" + uuid.NewString()
	reversedRef := "connect:gift:test:" + uuid.NewString()
	var sentID, reversedID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO connect_gifts (sender_id, recipient_id, gift_code, amount_kobo, status, idempotency_key, ledger_ref)
		VALUES ($1,$2,'crown',500000,'sent',$3,$4) RETURNING id::text`,
		sender, recipient, "idem-"+uuid.NewString(), sentRef).Scan(&sentID); err != nil {
		t.Fatalf("seed sent gift: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO connect_gifts (sender_id, recipient_id, gift_code, amount_kobo, status, idempotency_key, ledger_ref)
		VALUES ($1,$2,NULL,150000,'reversed',$3,$4) RETURNING id::text`,
		sender, recipient, "idem-"+uuid.NewString(), reversedRef).Scan(&reversedID); err != nil {
		t.Fatalf("seed reversed gift: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM connect_gifts WHERE id IN ($1,$2)`, sentID, reversedID)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id IN ($1,$2)`, sender, recipient)
	})

	// --- Wire the exact same stack production uses: real RBAC (PostgREST +
	// user_has_permission RPC) + connectgifting.RegisterAdmin ---
	rbacRepo := repositories.NewRBACSupabaseRepository(supabase)
	rbacSvc := services.NewRBACService(rbacRepo)
	guard := func(permission string) gin.HandlerFunc { return middleware.RequirePermission(rbacSvc, permission) }

	giftSvc := connectgifting.NewService(connectgifting.NewRepository(pool), nil, nil, nil, nil)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	admin := router.Group("/api/connect/admin")
	// Test-only stand-in for RequireAuthContext: sets exactly what it sets
	// (AuthUserContextKey + user_id), from a header, so RequirePermission
	// downstream behaves identically to production. No auth/JWT is faked —
	// RBAC itself is fully real (a live RPC call per request).
	admin.Use(func(c *gin.Context) {
		uid := c.GetHeader("X-Test-User")
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: uid})
		c.Set("user_id", uid)
		c.Next()
	})
	connectgifting.RegisterAdmin(admin, giftSvc, guard)

	doReq := func(t *testing.T, caller, query string) (*httptest.ResponseRecorder, []giftingAdminRow) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/connect/admin/gifts"+query, nil)
		req.Header.Set("X-Test-User", caller)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			return rec, nil
		}
		var body struct {
			Data []giftingAdminRow `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response body %q: %v", rec.Body.String(), err)
		}
		return rec, body.Data
	}
	findByID := func(rows []giftingAdminRow, id string) *giftingAdminRow {
		for i := range rows {
			if rows[i].ID == id {
				return &rows[i]
			}
		}
		return nil
	}

	// 1) RBAC MUST block a plain registered user with no connect.gifting.view.
	rec, _ := doReq(t, plainCaller, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("plain caller (no connect.gifting.view) got %d, want 403 — RBAC is not gating the admin gifting route", rec.Code)
	}

	// 2) The admin caller (granted connect.gifting.view via connect-moderator)
	// MUST see the real seeded rows, correctly shaped.
	rec, rows := doReq(t, adminCaller, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("admin caller got %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	sentRow := findByID(rows, sentID)
	if sentRow == nil {
		t.Fatalf("seeded 'sent' gift %s not present in admin list (got %d rows)", sentID, len(rows))
	}
	if sentRow.Reference != sentRef {
		t.Errorf("reference = %q, want the real ledger_ref %q", sentRow.Reference, sentRef)
	}
	if sentRow.SenderID != sender || sentRow.RecipientID != recipient {
		t.Errorf("sender/recipient = %s/%s, want %s/%s", sentRow.SenderID, sentRow.RecipientID, sender, recipient)
	}
	if sentRow.GiftLabel != "Crown" {
		t.Errorf("gift_label = %q, want %q (resolved from connect_gift_catalog via gift_code=crown)", sentRow.GiftLabel, "Crown")
	}
	if sentRow.AmountKobo != 500000 {
		t.Errorf("amount_kobo = %d, want 500000", sentRow.AmountKobo)
	}
	if sentRow.FeeKobo != 0 {
		t.Errorf("fee_kobo = %d, want 0 — Service.Send never charges a fee", sentRow.FeeKobo)
	}
	if sentRow.Status != "successful" {
		t.Errorf("status = %q, want %q (DB status 'sent' mapped to admin vocabulary)", sentRow.Status, "successful")
	}
	if sentRow.LimitState != "within" {
		t.Errorf("limit_state = %q, want %q", sentRow.LimitState, "within")
	}

	reversedRow := findByID(rows, reversedID)
	if reversedRow == nil {
		t.Fatalf("seeded 'reversed' gift %s not present in admin list", reversedID)
	}
	if reversedRow.Status != "reversed" {
		t.Errorf("status = %q, want %q", reversedRow.Status, "reversed")
	}
	if reversedRow.GiftLabel != "Custom gift" {
		t.Errorf("gift_label = %q, want %q for a NULL gift_code (custom-amount gift)", reversedRow.GiftLabel, "Custom gift")
	}

	// 3) status filter: the UI's exact query shape.
	_, filtered := doReq(t, adminCaller, "?status=successful")
	if findByID(filtered, sentID) == nil {
		t.Error("status=successful must include the sent/successful gift")
	}
	if findByID(filtered, reversedID) != nil {
		t.Error("status=successful must exclude the reversed gift")
	}
	_, filtered = doReq(t, adminCaller, "?status=reversed")
	if findByID(filtered, reversedID) == nil {
		t.Error("status=reversed must include the reversed gift")
	}
	if findByID(filtered, sentID) != nil {
		t.Error("status=reversed must exclude the sent/successful gift")
	}

	// 4) limit_state filter: every real row is "within" by construction (the
	// tier limit check is fail-closed BEFORE Service.Send ever inserts a
	// row), so any other requested value must short-circuit to empty —
	// deterministically, even in this shared dev DB with other rows present.
	_, blocked := doReq(t, adminCaller, "?limit_state=blocked")
	if len(blocked) != 0 {
		t.Errorf("limit_state=blocked returned %d rows, want 0 — no connect_gifts row can ever fail its pre-transfer limit check and still exist", len(blocked))
	}
}

// seedGiftingAdminPlatformUser inserts a minimal platform_users row directly
// via SQL (platform_users has no FK to auth.users — see the "Platform Users
// FK Cleanup Gotcha" memory note — so this needs no GoTrue identity) and
// registers its removal. RBAC's user_roles/HasPermission path keys off
// platform_users.id, not auth.users.id.
func seedGiftingAdminPlatformUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	email := "connect001-" + uuid.NewString() + "@gifting-admin.test"
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO platform_users (first_name, last_name, email, user_type, status)
		VALUES ('Gifting', 'AdminTest', $1, 'registered_user', 'active')
		RETURNING id::text`, email).Scan(&id); err != nil {
		t.Fatalf("seed platform_users row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM platform_users WHERE id = $1`, id)
	})
	return id
}
