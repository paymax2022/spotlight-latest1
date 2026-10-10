package app

// LIVE-DB integration test for the internal, service-authenticated ledger API
// (Stage 1.5c). It drives RegisterInternalLedgerAPI's real handlers against a real
// Postgres + the real finance ledger.Service, proving the money-path invariants
// end-to-end:
//   (1) A journal post MOVES the derived (projected) balance.
//   (2) An idempotent replay (same idempotencyKey) is a single logical movement.
//   (3) A balanceChecked overdraw is rejected 409 insufficient_funds (fail-closed).
//   (4) The service-token guard rejects a missing / wrong Bearer token.
// SKIPPED whenever TEST_DATABASE_URL is unset — the SAME gate the
// other finance/ledger live-DB tests use (see
// backend/internal/referral/ledger/withdraw_integration_test.go). Point it at a
// disposable, migrated Postgres — NEVER production. Every row is keyed by a fresh
// UUID; no truncation, safe to run repeatedly.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run InternalLedgerAPI -v

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
	"spotlight/backend/internal/finance/tiers"

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
// returns the id. The user is promoted to the unlimited KYC tier because
// balanceChecked wallet debits now run the strict in-tx daily-cap gate (F7) —
// an untiered user fails closed.
func seedAuthUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "il-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	testsupport.SetKycTier(t, context.Background(), pool, uid, testsupport.KycTierUnlimited)
	return uid
}

// newInternalLedgerRouter builds a gin engine with ONLY the internal ledger API
// mounted (flag on, token set), backed by a real ledger.Service over pool. The
// strict in-tx debit guard is wired exactly like production (F7): a
// balanceChecked user-wallet debit must observe the daily cap.
func newInternalLedgerRouter(pool *pgxpool.Pool) (*gin.Engine, *financeledger.Service) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	ledgerSvc.SetDebitGuard(tiers.NewService(pool).EnforceWalletDebitLimitTx)
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
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/internal/finance/ledger/journal", bytes.NewReader(buf))
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
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/internal/finance/ledger/balance?userId="+uid+"&account=user_wallet", nil)
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

// TestInternalLedgerAPI_UncheckedUserWalletDebitRefused_Integration pins the
// fail-closed combination: a service-token caller must never post an
// UNCHECKED user-wallet debit — it would bypass BOTH the sufficiency check
// and the strict daily cap (in-tx since F7). The route answers 400 before any
// posting; the wallet balance must be untouched.
func TestInternalLedgerAPI_UncheckedUserWalletDebitRefused_Integration(t *testing.T) {
	pool := internalLedgerPool(t)
	t.Cleanup(pool.Close)
	r, ledgerSvc := newInternalLedgerRouter(pool)
	ctx := context.Background()

	uid := seedAuthUser(t, pool)

	// Fund the wallet via the legitimate system→user direction.
	w := postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "settlement",
		"creditAccount":  "user_wallet",
		"amountKobo":     100_000,
		"reference":      "trade:fund:" + uid,
		"idempotencyKey": "il-uw-fund-" + uid,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("fund: status=%d body=%s", w.Code, w.Body.String())
	}

	// DR user_wallet WITHOUT balanceChecked → refused 400, no legs posted.
	w = postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     10_000,
		"reference":      "trade:unchecked:" + uid,
		"idempotencyKey": "il-unchecked-" + uid,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unchecked user_wallet debit: status=%d body=%s, want 400", w.Code, w.Body.String())
	}
	var errResp struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &errResp)
	if errResp.Error != "user_wallet debits require balanceChecked=true" {
		t.Fatalf("unchecked debit error = %q, want the balanceChecked refusal", errResp.Error)
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, uid); bal != 100_000 {
		t.Fatalf("balance after refused debit = %d, want 100000 (no posting)", bal)
	}

	// System↔system unchecked journals still post (no wallet leg to guard).
	w = postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "settlement",
		"creditAccount":  "provider_clearing",
		"amountKobo":     5_000,
		"reference":      "trade:sys:" + uid,
		"idempotencyKey": "il-sys-" + uid,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("system journal: status=%d body=%s, want 200", w.Code, w.Body.String())
	}
}

// TestInternalLedgerAPI_ForeignClaimConflicts_Integration proves the hardened
// replay contract: a pre-existing idempotency key is only a replay when BOTH
// recorded legs carry the exact journal identity. A same-key request whose
// amount, reference or accounts differ — or a key holding only one leg — is a
// foreign claim and must answer 409, never a phantom 200.
func TestInternalLedgerAPI_ForeignClaimConflicts_Integration(t *testing.T) {
	pool := internalLedgerPool(t)
	t.Cleanup(pool.Close)
	r, ledgerSvc := newInternalLedgerRouter(pool)
	ctx := context.Background()

	uid := seedAuthUser(t, pool)

	// Fund the wallet so every attempt passes any balance gate.
	w := postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "settlement",
		"creditAccount":  "user_wallet",
		"amountKobo":     500_000,
		"reference":      "trade:fund:" + uid,
		"idempotencyKey": "il-fc-fund-" + uid,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("fund: status=%d body=%s", w.Code, w.Body.String())
	}

	base := map[string]any{
		"userId":         uid,
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     10_000,
		"reference":      "trade:fc:" + uid,
		"idempotencyKey": "il-fc-" + uid,
		"balanceChecked": true,
	}
	if w := postJournal(t, r, testServiceToken, base); w.Code != http.StatusOK {
		t.Fatalf("first post: status=%d body=%s", w.Code, w.Body.String())
	}

	// True replay — same identity → 200 replay (unchanged).
	if w := postJournal(t, r, testServiceToken, base); w.Code != http.StatusOK {
		t.Fatalf("true replay: status=%d body=%s, want 200", w.Code, w.Body.String())
	}

	// Foreign claims under the same key → 409 each.
	for name, mutate := range map[string]func(map[string]any){
		"different amount":   func(b map[string]any) { b["amountKobo"] = 20_000 },
		"different ref":      func(b map[string]any) { b["reference"] = "trade:fc-other:" + uid },
		"different debitAcc": func(b map[string]any) { b["debitAccount"] = "provider_clearing"; b["balanceChecked"] = false },
	} {
		claim := map[string]any{}
		for k, v := range base {
			claim[k] = v
		}
		mutate(claim)
		w := postJournal(t, r, testServiceToken, claim)
		if w.Code != http.StatusConflict {
			t.Fatalf("%s: status=%d body=%s, want 409", name, w.Code, w.Body.String())
		}
		var er struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &er)
		if er.Error != "idempotency_key_conflict" {
			t.Fatalf("%s: error=%q, want idempotency_key_conflict", name, er.Error)
		}
	}

	// Partial claim: only the :debit leg exists under a fresh key → 409.
	wallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, uid)
	if err != nil {
		t.Fatalf("user wallet: %v", err)
	}
	// ledger_entries is trigger-guarded append-only — the seeded debit can't be
	// deleted and would leak into the global conservation invariant, so a contra
	// CREDIT on a standing account (different key, never touched by the check)
	// keeps the journal balanced while the claim stays "partial".
	settleAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountSettlement)
	if err != nil {
		t.Fatalf("settlement account: %v", err)
	}
	partialKey := "il-fc-partial-" + uid
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		 VALUES ($1, 'DEBIT', 10_000, $2, $3), ($4, 'CREDIT', 10_000, $2, $5)`,
		wallet.ID, "trade:fc:"+uid, partialKey+":debit", settleAcc.ID, partialKey+":contra"); err != nil {
		t.Fatalf("seed partial leg: %v", err)
	}
	w = postJournal(t, r, testServiceToken, map[string]any{
		"userId":         uid,
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     10_000,
		"reference":      "trade:fc:" + uid,
		"idempotencyKey": partialKey,
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("partial claim: status=%d body=%s, want 409", w.Code, w.Body.String())
	}

	// The seeded REVERSAL-free partial DEBIT leg moved -10k: funded 500k,
	// spent 10k once, phantom partial debit -10k → 480k... verify no phantom
	// fulfilment double-moved money: exactly one 10k spend + the seeded leg.
	if bal, _ := ledgerSvc.GetBalance(ctx, uid); bal != 480_000 {
		t.Fatalf("balance = %d, want 480000 (single spend + seeded leg)", bal)
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
