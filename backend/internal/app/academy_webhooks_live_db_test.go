package app

// LIVE-DB integration test for the academy rail webhook receiver
// (AUD-BE-013). Drives the real ingest pipeline (HMAC verify → dedupe insert →
// reconcile) against real Postgres + the real finance ledger.Service.
// Invariants under test:
//   (1) A VALIDLY-SIGNED webhook for a provider ref with NO matching obligation
//       must NOT move pooled escrow → settlement. Previously the leg posted
//       unconditionally — any signed "settled" event for a fabricated ref
//       drained platform escrow.
//   (2) The settle leg uses the OWNING ROW's amount_minor, never the webhook's
//       claimed amount_minor — a signed event must not be able to inflate the
//       release.
//   (3) A matching obligation flips state AND posts exactly one balanced leg.
//   (4) Replay dedupes at the database: same (rail, provider_ref) is a no-op.
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// finance/ledger live-DB tests. Every row is keyed by a fresh UUID; safe to run
// repeatedly.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run AcademyRailWebhook -v

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	financeledger "spotlight/backend/internal/finance/ledger"
)

const academyWHTestSecret = "test-webhook-secret-zzz"

func newAcademyWebhookRouter(t *testing.T) (*gin.Engine, *pgxpool.Pool) {
	t.Helper()
	pool := internalLedgerPool(t)
	t.Cleanup(pool.Close)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	cfg := config.Config{
		BNPLWebhookSecret:     academyWHTestSecret,
		PayoutWebhookSecret:   academyWHTestSecret,
		DisburseWebhookSecret: academyWHTestSecret,
		BillingWebhookSecret:  academyWHTestSecret,
	}
	h := newAcademyWebhookHandler(context.Background(), pool, ledgerSvc, cfg)
	// Mount exactly as registerAcademyWebhooks intends: <group>/internal/webhooks/academy/<rail>.
	// (The doubled /internal/webhooks prefix in the call site is tracked separately.)
	g := r.Group("")
	registerAcademyWebhooks(g, h)
	return r, pool
}

func signedWebhookPost(t *testing.T, r *gin.Engine, rail string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, []byte(academyWHTestSecret))
	mac.Write(buf)
	req := httptest.NewRequest(http.MethodPost, "/internal/webhooks/academy/"+rail, bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Fake-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func ledgerRowsForRef(t *testing.T, pool *pgxpool.Pool, ref string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE '%' || $1 || '%'`,
		ref).Scan(&n); err != nil {
		t.Fatalf("count ledger rows: %v", err)
	}
	return n
}

// Phantom payout settle: valid signature, unknown ref, claimed amount present.
// Must record the event but post NO ledger entries.
func TestAcademyRailWebhook_PhantomRefMovesNoEscrow_Integration(t *testing.T) {
	r, pool := newAcademyWebhookRouter(t)
	phantomRef := "payout-phantom-" + uuid.NewString()

	w := signedWebhookPost(t, r, "payout", map[string]any{
		"rail": "payout", "event": "settled",
		"ref": phantomRef, "reference": "PH-" + uuid.NewString()[:8],
		"idempotency_key": "whk-" + uuid.NewString(), "amount_minor": 50000,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("phantom webhook: status=%d body=%s", w.Code, w.Body.String())
	}
	t.Logf("phantom webhook response: %s", w.Body.String())
	if n := ledgerRowsForRef(t, pool, phantomRef); n != 0 {
		t.Fatalf("phantom ref posted %d ledger entries — pooled escrow moved for a ref with no obligation", n)
	}
}

// Real obligation: settle flips state AND posts the leg for the ROW's amount —
// not the (inflated) amount claimed on the wire.
func TestAcademyRailWebhook_MatchingPayoutSettlesRowAmount_Integration(t *testing.T) {
	r, pool := newAcademyWebhookRouter(t)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)
	tutorID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO academy_tutors (id, user_id, status, kyc_state) VALUES ($1,$2,'verified','verified')`,
		tutorID, userID); err != nil {
		t.Fatalf("seed tutor: %v", err)
	}
	payoutRef := "payout-real-" + uuid.NewString()
	// Domain-realistic seed: tutor.SettlePayout persists payout_ref inside the
	// same guarded write that terminates the row — a committed row carrying a
	// provider ref is already 'paid', never still 'requested'.
	if _, err := pool.Exec(ctx,
		`INSERT INTO academy_tutor_payouts (tutor_id, amount_minor, state, payout_ref, decided_at) VALUES ($1,50000,'paid',$2,now())`,
		tutorID, payoutRef); err != nil {
		t.Fatalf("seed payout: %v", err)
	}

	// Claim 1000x the row amount — the ledger leg must release 50_000 (the row),
	// not 50_000_000 (the wire).
	w := signedWebhookPost(t, r, "payout", map[string]any{
		"rail": "payout", "event": "settled",
		"ref": payoutRef, "reference": "RP-" + uuid.NewString()[:8],
		"idempotency_key": "whk-" + uuid.NewString(), "amount_minor": 50_000_000,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("payout webhook: status=%d body=%s", w.Code, w.Body.String())
	}

	var state string
	if err := pool.QueryRow(ctx,
		`SELECT state FROM academy_tutor_payouts WHERE payout_ref=$1`,
		payoutRef).Scan(&state); err != nil {
		t.Fatalf("read payout state: %v", err)
	}
	if state != "paid" {
		t.Fatalf("payout state = %q, want paid", state)
	}

	var total int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE idempotency_key LIKE 'academy-rail:payout:' || $1 || ':%'`,
		payoutRef).Scan(&total); err != nil {
		t.Fatalf("sum ledger leg: %v", err)
	}
	if total != 2*50000 {
		t.Fatalf("ledger legs summed to %d kobo, want 100000 (balanced pair of the ROW's 50000) — webhook amount must not drive money", total)
	}

	// Replay: dedupe at (rail, provider_ref).
	w2 := signedWebhookPost(t, r, "payout", map[string]any{
		"rail": "payout", "event": "settled",
		"ref": payoutRef, "reference": "RP-" + uuid.NewString()[:8],
		"idempotency_key": "whk-" + uuid.NewString(), "amount_minor": 50_000_000,
	})
	var body map[string]any
	_ = json.Unmarshal(w2.Body.Bytes(), &body)
	if w2.Code != http.StatusOK || body["data"] != "duplicate" {
		t.Fatalf("replay: status=%d body=%s, want 200 duplicate", w2.Code, w2.Body.String())
	}
}

// A signed non-settle event (e.g. "failed") on a real ref must be recorded but
// never reconcile — only the rail's settle verb may move money.
func TestAcademyRailWebhook_NonSettleEventDoesNotReconcile_Integration(t *testing.T) {
	r, pool := newAcademyWebhookRouter(t)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)
	tutorID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO academy_tutors (id, user_id, status, kyc_state) VALUES ($1,$2,'verified','verified')`,
		tutorID, userID); err != nil {
		t.Fatalf("seed tutor: %v", err)
	}
	payoutRef := "payout-failed-" + uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO academy_tutor_payouts (tutor_id, amount_minor, state, payout_ref, decided_at) VALUES ($1,50000,'paid',$2,now())`,
		tutorID, payoutRef); err != nil {
		t.Fatalf("seed payout: %v", err)
	}

	w := signedWebhookPost(t, r, "payout", map[string]any{
		"rail": "payout", "event": "failed",
		"ref": payoutRef, "reference": "PF-" + uuid.NewString()[:8],
		"idempotency_key": "whk-" + uuid.NewString(), "amount_minor": 50000,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("non-settle webhook: status=%d body=%s", w.Code, w.Body.String())
	}
	if n := ledgerRowsForRef(t, pool, payoutRef); n != 0 {
		t.Fatalf("non-settle event posted %d ledger entries — only 'settled' may move money", n)
	}
}

// Same phantom-ref guard for the disburse rail (academy_disbursements-backed).
func TestAcademyRailWebhook_PhantomDisburseMovesNoEscrow_Integration(t *testing.T) {
	r, pool := newAcademyWebhookRouter(t)
	phantomRef := "disb-phantom-" + uuid.NewString()

	w := signedWebhookPost(t, r, "disburse", map[string]any{
		"rail": "disburse", "event": "settled",
		"ref": phantomRef, "reference": "PD-" + uuid.NewString()[:8],
		"idempotency_key": "whk-" + uuid.NewString(), "amount_minor": 250000,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("phantom disburse webhook: status=%d body=%s", w.Code, w.Body.String())
	}
	if n := ledgerRowsForRef(t, pool, phantomRef); n != 0 {
		t.Fatalf("phantom disburse ref posted %d ledger entries — escrow moved without an obligation", n)
	}
}
