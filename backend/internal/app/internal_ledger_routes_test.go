package app

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the internal, service-authenticated ledger API
// (Stage 1.5c). It drives RegisterInternalLedgerAPI's real handlers against a real
// Postgres + the real finance ledger.Service, proving the money-path invariants
// end-to-end:
//   (1) A journal post MOVES the derived (projected) balance.
//   (2) An idempotent replay (same idempotencyKey) is a single logical movement.
//   (3) A balanceChecked overdraw is rejected 409 insufficient_funds (fail-closed).
//   (4) The service-token guard rejects a missing / wrong Bearer token.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — the SAME gate the
// other finance/ledger live-DB tests use (see
// backend/internal/referral/ledger/withdraw_integration_test.go). Point it at a
// disposable, migrated Postgres — NEVER production. Every row is keyed by a fresh
// UUID; no truncation, safe to run repeatedly.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run InternalLedgerAPI -v
// ---------------------------------------------------------------------------

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	financeledger "spotlight/backend/internal/finance/ledger"

	"spotlight/backend/internal/testsupport"
)

const testServiceToken = "test-service-token-abc123"

func internalLedgerPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping internal ledger API live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return pool
}

// seedAuthUser inserts an auth.users row (ledger_accounts.user_id may FK it) and
// returns the id.
func seedAuthUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "il-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

// newInternalLedgerRouter builds a gin engine with ONLY the internal ledger API
// mounted (flag on, token set), backed by a real ledger.Service over pool.
func newInternalLedgerRouter(pool *pgxpool.Pool) (*gin.Engine, *financeledger.Service) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	cfg := config.Config{
		FeatureInternalLedgerAPIEnabled: true,
		LedgerServiceToken:              testServiceToken,
	}
	RegisterInternalLedgerAPI(r, cfg, ledgerSvc)
	return r, ledgerSvc
}

// postJournal issues an authenticated POST /internal/finance/ledger/journal.
func postJournal(t *testing.T, r *gin.Engine, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/internal/finance/ledger/journal", bytes.NewReader(buf))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestInternalLedgerAPI_PostMovesBalance_Integration(t *testing.T) {
	pool := internalLedgerPool(t)
	t.Cleanup(pool.Close)
	r, ledgerSvc := newInternalLedgerRouter(pool)
	ctx := context.Background()

	uid := seedAuthUser(t, pool)

	// Fund the wallet: DR settlement, CR user_wallet 100_000 (CREDIT = +balance).
	w := postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "settlement",
		"creditAccount":  "user_wallet",
		"amountKobo":     100_000,
		"reference":      "trade:fund:" + uid,
		"idempotencyKey": "il-fund-" + uid,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("fund: status=%d body=%s", w.Code, w.Body.String())
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, uid); bal != 100_000 {
		t.Fatalf("balance after fund = %d, want 100000", bal)
	}

	// balanceChecked debit: DR user_wallet, CR settlement 30_000 → balance 70_000.
	spendKey := "il-spend-" + uid
	w = postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     30_000,
		"reference":      "trade:buy:" + uid,
		"idempotencyKey": spendKey,
		"balanceChecked": true,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("spend: status=%d body=%s", w.Code, w.Body.String())
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, uid); bal != 70_000 {
		t.Fatalf("balance after spend = %d, want 70000", bal)
	}

	// (2) Replay the SAME spend key → single movement, reported as a replay.
	w = postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     30_000,
		"reference":      "trade:buy:" + uid,
		"idempotencyKey": spendKey,
		"balanceChecked": true,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("replay: status=%d body=%s", w.Code, w.Body.String())
	}
	var replayResp struct {
		Posted bool `json:"posted"`
		Replay bool `json:"replay"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &replayResp)
	if !replayResp.Posted || !replayResp.Replay {
		t.Fatalf("replay response = %+v, want posted=true replay=true", replayResp)
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, uid); bal != 70_000 {
		t.Fatalf("balance after replay = %d, want 70000 (no double movement)", bal)
	}

	// (3) balanceChecked overdraw → 409 insufficient_funds; balance unchanged.
	w = postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     1_000_000,
		"reference":      "trade:overdraw:" + uid,
		"idempotencyKey": "il-overdraw-" + uid,
		"balanceChecked": true,
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("overdraw: status=%d body=%s, want 409", w.Code, w.Body.String())
	}
	var errResp struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &errResp)
	if errResp.Error != "insufficient_funds" {
		t.Fatalf("overdraw error = %q, want insufficient_funds", errResp.Error)
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, uid); bal != 70_000 {
		t.Fatalf("balance after overdraw attempt = %d, want 70000 (fail-closed)", bal)
	}

	// Balance endpoint reflects the same projected wallet balance.
	req := httptest.NewRequest(http.MethodGet, "/internal/finance/ledger/balance?userId="+uid+"&account=user_wallet", nil)
	req.Header.Set("Authorization", "Bearer "+testServiceToken)
	bw := httptest.NewRecorder()
	r.ServeHTTP(bw, req)
	if bw.Code != http.StatusOK {
		t.Fatalf("balance endpoint: status=%d body=%s", bw.Code, bw.Body.String())
	}
	var balResp struct {
		BalanceKobo int64 `json:"balanceKobo"`
	}
	_ = json.Unmarshal(bw.Body.Bytes(), &balResp)
	if balResp.BalanceKobo != 70_000 {
		t.Fatalf("balance endpoint = %d, want 70000", balResp.BalanceKobo)
	}
}

// TestInternalLedgerAPI_ServiceTokenGuard_Integration proves the guard rejects a
// missing and a wrong token BEFORE any ledger mutation runs.
func TestInternalLedgerAPI_ServiceTokenGuard_Integration(t *testing.T) {
	pool := internalLedgerPool(t)
	t.Cleanup(pool.Close)
	r, _ := newInternalLedgerRouter(pool)
	uid := seedAuthUser(t, pool)

	body := map[string]any{
		"userId":         uid,
		"debitAccount":   "settlement",
		"creditAccount":  "user_wallet",
		"amountKobo":     10_000,
		"reference":      "trade:guard:" + uid,
		"idempotencyKey": "il-guard-" + uid,
	}

	// Missing token → 401.
	if w := postJournal(t, r, "", body); w.Code != http.StatusUnauthorized {
		t.Fatalf("missing token: status=%d, want 401", w.Code)
	}
	// Wrong token → 401.
	if w := postJournal(t, r, "not-the-token", body); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: status=%d, want 401", w.Code)
	}

	// The rejected calls must not have posted anything.
	if bal, _ := financeledger.NewService(financeledger.NewRepository(pool), nil).GetBalance(context.Background(), uid); bal != 0 {
		t.Fatalf("balance after rejected calls = %d, want 0 (guard must run before any mutation)", bal)
	}
}
