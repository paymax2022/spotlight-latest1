package ledger_test

// ---------------------------------------------------------------------------
// LIVE-DB suite for the centralized admin "Transactions" console
// (AdminListTransactions / GET /api/finance/admin/transactions).
//
// ledger_entries has no module/source column and no per-module transactions
// table exists — this console is the only cross-module read of money
// movement, built entirely on real rows. Every assertion here is scoped to a
// unique, randomly-tagged fixture (a brand-new fixture user + wallet account,
// and references carrying a unique test tag) so it is safe to run against the
// shared local Supabase instance, which already carries ~3,226 unrelated
// ledger_entries rows — assertions never depend on an absolute table count.
//
// What it proves:
//  1. Join shape: a NULL-user (standing account) row is returned, not dropped,
//     and carries account_type so the UI can label it "System: <type>".
//  2. Type filter narrows correctly.
//  3. Date range filter narrows correctly.
//  4. Amount range filter narrows correctly.
//  5. Search filter matches the joined user's name, independent of reference.
//  6. Pagination (limit/offset) + total count are correct and consistent
//     under the same filter.
//  7. RBAC: a caller lacking finance.admin.transactions.view is 403'd by
//     middleware.RequirePermission; a caller holding it reaches the handler
//     and gets a real 200 with real rows.
//
// SKIPPED whenever TEST_DATABASE_URL is unset, so `go test ./...` without a
// DB stays green.
//
// Bring-up:
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   cd backend && go test ./internal/finance/ledger/... -run TestAdmin -v -count=1
// ---------------------------------------------------------------------------

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// fakeAdminTxRBAC implements services.RBACService with everything nil except
// CheckPermission, the only method middleware.RequirePermission calls.
type fakeAdminTxRBAC struct {
	services.RBACService
	allow bool
}

func (f *fakeAdminTxRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	return f.allow, nil
}

// adminTxFixture seeds a brand-new fixture user + user_wallet account, plus a
// handful of ledger_entries rows with fully-controlled created_at/type/amount
// so every filter assertion is deterministic.
type adminTxFixture struct {
	pool                         *pgxpool.Pool
	svc                          *ledger.Service
	tag                          string
	fullName                     string
	userID                       string
	walletAcct                   string
	commAcct                     string
	rowA, rowB, rowC, rowD, rowE string // ledger_entries.id
}

func mustLiveTxPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

func setupAdminTxFixture(t *testing.T) *adminTxFixture {
	t.Helper()
	ctx := context.Background()
	pool := mustLiveTxPool(t)
	repo := ledger.NewRepository(pool)
	svc := ledger.NewService(repo, nil)

	tag := "admtxlive" + uuid.NewString()[:8]
	userID := uuid.NewString()
	// Deliberately NOT derived from tag: the tag-scoped assertions below rely on
	// Search=tag matching ONLY via the reference column (rows A/B/C/D), never via
	// the joined user's name/email — if name/email contained the tag, every row
	// on this fixture's wallet (including untagged rowE) would match by name/email
	// too.
	fullName := "AdminTx Nomen " + uuid.NewString()[:8]
	email := "admtxfixture-" + uuid.NewString()[:8] + "@admin-tx-fixture.test"

	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, email); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	// The handle_new_user trigger auto-creates user_profiles with an empty
	// full_name; overwrite it (and email, defensively) so the search-by-name
	// assertion has a distinctive value to match on.
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_profiles (id, email, full_name) VALUES ($1,$2,$3)
		ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
		userID, email, fullName); err != nil {
		t.Fatalf("seed user_profiles: %v", err)
	}

	walletAcc, err := svc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("get/create user wallet: %v", err)
	}
	commAcc, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		t.Fatalf("get/create standing commission account: %v", err)
	}

	now := time.Now().UTC()
	insert := func(accountID, entryType string, amountKobo int64, reference string, createdAt time.Time) string {
		var id string
		err := pool.QueryRow(ctx, `
			INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, created_at)
			VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
			accountID, entryType, amountKobo, reference, "idem-"+uuid.NewString(), createdAt).Scan(&id)
		if err != nil {
			t.Fatalf("insert fixture ledger_entries row (ref=%s): %v", reference, err)
		}
		return id
	}

	f := &adminTxFixture{pool: pool, svc: svc, tag: tag, fullName: fullName, userID: userID, walletAcct: walletAcc.ID, commAcct: commAcc.ID}

	// rowA: 10 days ago, CREDIT 150000 kobo, colon-namespaced reference "fx:convert:...".
	f.rowA = insert(walletAcc.ID, "CREDIT", 150000, fmt.Sprintf("fx:convert:%s-A", tag), now.Add(-10*24*time.Hour))
	// rowB: 1 day ago, DEBIT 50000 kobo, "arena:support:..." — paired with rowC below.
	f.rowB = insert(walletAcc.ID, "DEBIT", 50000, fmt.Sprintf("arena:support:%s-B", tag), now.Add(-24*time.Hour))
	// rowC: same reference as rowB (its ledger counterpart), posted to the STANDING
	// commission account (user_id IS NULL) — proves standing-account rows are
	// returned, not dropped, and are distinguishable via account_type.
	f.rowC = insert(commAcc.ID, "CREDIT", 50000, fmt.Sprintf("arena:support:%s-B", tag), now.Add(-24*time.Hour+time.Second))
	// rowD: 100 days ago, DEBIT 999999 kobo, NO colon in the reference at all —
	// proves the SPLIT_PART fallback for non-colon references (whole string).
	f.rowD = insert(walletAcc.ID, "DEBIT", 999999, fmt.Sprintf("%sopaqueNoColon", tag), now.Add(-100*24*time.Hour))
	// rowE: now, CREDIT 1234 kobo, reference is an unrelated random UUID (no tag,
	// no colon) — isolates the "search matches by joined user field" assertion,
	// since this row can ONLY be found via the user's name/email, not the tag.
	f.rowE = insert(walletAcc.ID, "CREDIT", 1234, uuid.NewString(), now)

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM ledger_entries WHERE id = ANY($1)`,
			[]string{f.rowA, f.rowB, f.rowC, f.rowD, f.rowE})
		_, _ = pool.Exec(context.Background(), `DELETE FROM ledger_accounts WHERE id = $1`, f.walletAcct)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_profiles WHERE id = $1`, f.userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, f.userID)
	})

	return f
}

func rowIDs(rows []ledger.AdminTransactionRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.ID
	}
	return out
}

func containsID(rows []ledger.AdminTransactionRow, id string) bool {
	for _, r := range rows {
		if r.ID == id {
			return true
		}
	}
	return false
}

// (a) Shape/join correctness: NULL-user standing-account row is present, not
// dropped, and both a wallet row and the standing row carry correct fields
// incl. the inferred source prefix (colon-namespaced vs. no-colon fallback).
func TestAdminListTransactions_ShapeAndJoin(t *testing.T) {
	f := setupAdminTxFixture(t)
	ctx := context.Background()

	page, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{Search: f.tag, Limit: 50})
	if err != nil {
		t.Fatalf("AdminListTransactions: %v", err)
	}
	if page.Total != 4 {
		t.Fatalf("expected 4 tagged rows (A,B,C,D), got total=%d rows=%v", page.Total, rowIDs(page.Rows))
	}
	if !containsID(page.Rows, f.rowC) {
		t.Fatalf("standing-account row (rowC) missing from results — NULL-user rows must not be dropped")
	}
	for _, r := range page.Rows {
		switch r.ID {
		case f.rowC:
			if r.UserID != nil {
				t.Errorf("rowC (standing account) expected UserID nil, got %v", *r.UserID)
			}
			if r.UserName != nil || r.UserEmail != nil {
				t.Errorf("rowC expected nil user name/email, got name=%v email=%v", r.UserName, r.UserEmail)
			}
			if r.AccountType != "commission" {
				t.Errorf("rowC expected account_type=commission, got %q", r.AccountType)
			}
		case f.rowA:
			if r.SourcePrefix != "fx" {
				t.Errorf("rowA expected inferred source prefix %q, got %q", "fx", r.SourcePrefix)
			}
			if r.UserID == nil || *r.UserID != f.userID {
				t.Errorf("rowA expected UserID=%s, got %v", f.userID, r.UserID)
			}
			if r.UserName == nil {
				t.Errorf("rowA expected a joined user_name, got nil")
			}
		case f.rowD:
			wantPrefix := f.tag + "opaqueNoColon"
			if r.SourcePrefix != wantPrefix {
				t.Errorf("rowD (no colon) expected SPLIT_PART fallback = whole reference %q, got %q", wantPrefix, r.SourcePrefix)
			}
		}
	}
}

// (b) Type filter narrows correctly.
func TestAdminListTransactions_TypeFilter(t *testing.T) {
	f := setupAdminTxFixture(t)
	ctx := context.Background()

	page, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{Search: f.tag, Type: "CREDIT", Limit: 50})
	if err != nil {
		t.Fatalf("AdminListTransactions: %v", err)
	}
	if page.Total != 2 {
		t.Fatalf("Type=CREDIT: expected 2 rows (A,C), got total=%d rows=%v", page.Total, rowIDs(page.Rows))
	}
	if !containsID(page.Rows, f.rowA) || !containsID(page.Rows, f.rowC) {
		t.Fatalf("Type=CREDIT: expected rowA and rowC, got %v", rowIDs(page.Rows))
	}
	if containsID(page.Rows, f.rowB) || containsID(page.Rows, f.rowD) {
		t.Fatalf("Type=CREDIT: DEBIT rows leaked through, got %v", rowIDs(page.Rows))
	}
}

// (c) Date range filter narrows correctly.
func TestAdminListTransactions_DateRangeFilter(t *testing.T) {
	f := setupAdminTxFixture(t)
	ctx := context.Background()

	page, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{
		Search: f.tag,
		From:   time.Now().UTC().Add(-3 * 24 * time.Hour),
		To:     time.Now().UTC().Add(time.Hour),
		Limit:  50,
	})
	if err != nil {
		t.Fatalf("AdminListTransactions: %v", err)
	}
	if page.Total != 2 {
		t.Fatalf("date range: expected 2 rows (B,C), got total=%d rows=%v", page.Total, rowIDs(page.Rows))
	}
	if !containsID(page.Rows, f.rowB) || !containsID(page.Rows, f.rowC) {
		t.Fatalf("date range: expected rowB and rowC, got %v", rowIDs(page.Rows))
	}
	if containsID(page.Rows, f.rowA) || containsID(page.Rows, f.rowD) {
		t.Fatalf("date range: out-of-range rows leaked through, got %v", rowIDs(page.Rows))
	}
}

// (d) Amount range filter narrows correctly.
func TestAdminListTransactions_AmountRangeFilter(t *testing.T) {
	f := setupAdminTxFixture(t)
	ctx := context.Background()

	page, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{
		Search:        f.tag,
		MinAmountKobo: 100000,
		MaxAmountKobo: 200000,
		Limit:         50,
	})
	if err != nil {
		t.Fatalf("AdminListTransactions: %v", err)
	}
	if page.Total != 1 || !containsID(page.Rows, f.rowA) {
		t.Fatalf("amount range [100000,200000]: expected exactly rowA, got total=%d rows=%v", page.Total, rowIDs(page.Rows))
	}
}

// (e) Search filter matches the joined user's name/email — independent of the
// reference string (rowE's reference is an untagged random UUID).
func TestAdminListTransactions_SearchByUserField(t *testing.T) {
	f := setupAdminTxFixture(t)
	ctx := context.Background()

	// Search on the fixture's distinctive full_name — NOT the tag.
	page, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{Search: f.fullName, Limit: 50})
	if err != nil {
		t.Fatalf("AdminListTransactions: %v", err)
	}
	if !containsID(page.Rows, f.rowE) {
		t.Fatalf("search by user full_name: expected rowE (untagged reference) via name match, got %v", rowIDs(page.Rows))
	}
	// Every wallet-account row (A,B,D,E) belongs to this same fixture user, so
	// all four must match by name even though only A/B/D also match by tag.
	if page.Total != 4 {
		t.Fatalf("search by user full_name: expected 4 rows (A,B,D,E all on the fixture wallet), got total=%d rows=%v", page.Total, rowIDs(page.Rows))
	}
}

// (f) Pagination + total count are correct and consistent under one filter.
func TestAdminListTransactions_Pagination(t *testing.T) {
	f := setupAdminTxFixture(t)
	ctx := context.Background()

	page1, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{Search: f.tag, Limit: 2, Offset: 0})
	if err != nil {
		t.Fatalf("AdminListTransactions page1: %v", err)
	}
	if page1.Total != 4 || len(page1.Rows) != 2 {
		t.Fatalf("page1: expected total=4 len=2, got total=%d len=%d", page1.Total, len(page1.Rows))
	}
	// Newest-first: rowC (now-1d+1s) then rowB (now-1d).
	if page1.Rows[0].ID != f.rowC || page1.Rows[1].ID != f.rowB {
		t.Fatalf("page1: expected [rowC,rowB] newest-first, got %v", rowIDs(page1.Rows))
	}

	page2, err := f.svc.AdminListTransactions(ctx, ledger.AdminTransactionFilter{Search: f.tag, Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("AdminListTransactions page2: %v", err)
	}
	if page2.Total != 4 || len(page2.Rows) != 2 {
		t.Fatalf("page2: expected total=4 len=2, got total=%d len=%d", page2.Total, len(page2.Rows))
	}
	if page2.Rows[0].ID != f.rowA || page2.Rows[1].ID != f.rowD {
		t.Fatalf("page2: expected [rowA,rowD] next, got %v", rowIDs(page2.Rows))
	}
}

// (g) RBAC: middleware.RequirePermission fail-closed for a caller lacking
// finance.admin.transactions.view (403), and a real 200 with real rows for a
// caller who holds it — exercised through the actual HTTP handler, not just
// the service.
func TestAdminListTransactions_RBAC(t *testing.T) {
	f := setupAdminTxFixture(t)
	gin.SetMode(gin.TestMode)

	buildRouter := func(allow bool) *gin.Engine {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: "caller-" + uuid.NewString()})
			c.Next()
		})
		rbac := &fakeAdminTxRBAC{allow: allow}
		h := ledger.NewAdminHandler(f.svc)
		r.GET("/api/finance/admin/transactions",
			middleware.RequirePermission(rbac, "finance.admin.transactions.view"),
			h.ListTransactions)
		return r
	}

	t.Run("denied without the permission", func(t *testing.T) {
		r := buildRouter(false)
		req := httptest.NewRequest(http.MethodGet, "/api/finance/admin/transactions?search="+f.tag, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 without permission, got %d (body: %s)", w.Code, w.Body.String())
		}
	})

	t.Run("allowed with the permission returns real rows", func(t *testing.T) {
		r := buildRouter(true)
		req := httptest.NewRequest(http.MethodGet, "/api/finance/admin/transactions?search="+f.tag, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 with permission, got %d (body: %s)", w.Code, w.Body.String())
		}
		var body struct {
			Success bool                         `json:"success"`
			Rows    []ledger.AdminTransactionRow `json:"rows"`
			Total   int64                        `json:"total"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v (body: %s)", err, w.Body.String())
		}
		if !body.Success || body.Total != 4 || len(body.Rows) == 0 {
			t.Fatalf("expected success with 4 real rows, got success=%v total=%d rows=%d (body: %s)",
				body.Success, body.Total, len(body.Rows), w.Body.String())
		}
	})
}
