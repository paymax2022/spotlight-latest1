package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the FX Convert money path (RISK-FX-1/2/3).
//
// fx.NewService(db, ledger, provider, redis).Convert drives, in ONE call:
//   - LEG 1 (RISK-FX-1): a balanced ledger DEBIT of the user's NGN wallet
//     (source + fee), crediting the fx_spread_income standing account, keyed
//     "<idem>:debit".
//   - a provider ConvertFX call (here an httptest Maplerad server so the money
//     path runs end-to-end without a real gateway).
//   - LEG 2 (RISK-FX-1): a balanced PostJournal for the target-currency leg
//     (DR settlement → CR fx_spread_income), keyed "<idem>:credit".
//   - a currency_wallets MIRROR credit of the target amount, committed in the
//     SAME tx as the fx_conversions row (guarded by UNIQUE(idempotency_key)).
//
// This test proves BOTH ledger legs post, currency_wallets is credited as a
// mirror, and a REPLAY with the same idempotency_key does NOT double-credit
// (exactly one fx_conversions row, one currency_wallets credit, no extra ledger
// legs) — directly regression-guarding the P0 idempotency fix
// (20260920000300_fx_convert_idempotency.sql + service.go ON CONFLICT DO NOTHING).
//
// SKIPPED whenever TEST_DATABASE_URL is unset (same env-gate +
// seedUser pattern as backend/tests/crypto + backend/tests/association), so
// `go test ./...` without a DB stays green.
//
// ── Bring-up note ──────────────────────────────────────────────────────────
// Apply the FX + ledger migrations (supabase db reset):
//   20260616200000_fx_currency_wallets.sql
//   20260616210000_fx_rates_and_quotes.sql
//   20260616220000_fx_conversions.sql
//   20260920000300_fx_convert_idempotency.sql   (idempotency safety net)
//   + finance/ledger migrations (ledger_accounts / ledger_entries).
// Then:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run LiveDB -v
// The fx_spread_income + settlement standing accounts are auto-created on first
// GetOrCreateStandingAccount — no seed rows needed.
// ---------------------------------------------------------------------------

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/fx"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider/maplerad"
)

// liveDBPool connects using TEST_DATABASE_URL, or skips.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB FX convert integration test; see bring-up note in convert_live_db_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func newLiveLedger(pool *pgxpool.Pool) *ledger.Service {
	return ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
}

// seedUser inserts a synthetic auth.users row so FKs (fx_quotes.user_id,
// fx_conversions.user_id, currency_wallets.user_id, ledger wallet) resolve. email
// is required by the handle_new_user trigger (user_profiles.email NOT NULL) —
// identical to the crypto/association seedUser helpers.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM public.fx_conversions WHERE user_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM public.fx_quotes WHERE user_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM public.currency_wallets WHERE user_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

// seedWallet credits userID's NGN wallet from the settlement standing account so
// Convert's source-leg Debit has funds to draw down.
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("seed wallet: standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "test-seed:"+uuid.New().String(), "test-seed-idem:"+uuid.New().String(), settle.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: credit: %v", err)
	}
}

// mapleradTestServer returns an httptest server speaking Maplerad's REAL FX
// contract, as probed against the sandbox: the fx.Service books a firm quote with
// POST /fx/quote and exchanges it with POST /fx. Both nest source/target objects
// and carry NO fee, transaction id, or status field.
//
// Deterministic NGN→USD pricing: 500,000 kobo → 32,500 (¢325.00) at rate 0.00065.
//
// Two things this stub deliberately asserts by NOT handling them:
//
//   - GET /fx/rates — the rate board issues no quote reference, so the convert
//     path must never price off it. A request here trips the default arm.
//   - POST /fx/convert — does not exist in the real API (404); the old stub
//     answered it, which is what let the pre-`d6e6942c` code look healthy.
//
// The quote reference is SINGLE USE, exactly as the provider treats it: a second
// exchange of the same reference fails with "could not find quote". That makes an
// idempotency regression fail here rather than silently double-converting.
func mapleradTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	const quoteRef = "prov-quote-1"
	var mu sync.Mutex
	spent := false

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/fx/quote":
			_, _ = w.Write([]byte(`{"status":true,"data":{"reference":"` + quoteRef + `",` +
				`"source":{"currency":"NGN","amount":500000},` +
				`"target":{"currency":"USD","amount":32500},"rate":0.00065}}`))

		case r.Method == http.MethodPost && r.URL.Path == "/fx":
			mu.Lock()
			alreadySpent := spent
			spent = true
			mu.Unlock()
			if alreadySpent {
				// Maplerad answers HTTP 200 with status:false for business errors.
				_, _ = w.Write([]byte(`{"status":false,"message":"could not find quote"}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":true,"data":{` +
				`"source":{"currency":"NGN","amount":500000},` +
				`"target":{"currency":"USD","amount":32500},"rate":0.00065,` +
				`"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}}`))

		default:
			t.Errorf("unexpected maplerad request: %s %s", r.Method, r.URL.Path)
			http.Error(w, `{"status":false,"message":"unexpected request"}`, http.StatusBadRequest)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// ---------------------------------------------------------------------------
// Convert: both ledger legs post, currency_wallets mirror credited, idempotent.
// ---------------------------------------------------------------------------

// TestLiveDB_FXConvert_BothLegsPosted_MirrorCredited_ReplayNoDoubleCredit drives
// a real NGN→USD conversion through the live DB (with an httptest provider) and
// proves:
//
//	(a) LEG 1 posted: the user's NGN wallet fell by source+fee (500,000+500),
//	    the balanced counterpart landing on fx_spread_income ("<idem>:debit");
//	(b) LEG 2 posted: a balanced PostJournal exists for the target leg
//	    ("<idem>:credit") — BOTH legs hit the ledger (RISK-FX-1);
//	(c) the target currency_wallets row was credited by the target amount
//	    (32,500) as a MIRROR of the target leg;
//	(d) a REPLAY with the SAME idempotency_key returns the existing conversion
//	    and does NOT double-credit: exactly ONE fx_conversions row, the
//	    currency_wallets balance unchanged, and no extra ledger legs (RISK-FX-2).
func TestLiveDB_FXConvert_BothLegsPosted_MirrorCredited_ReplayNoDoubleCredit(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := newLiveLedger(pool)

	srv := mapleradTestServer(t)
	provider := maplerad.New("sk_test_live", false).WithBaseURL(srv.URL)
	svc := fx.NewService(pool, led, provider, (*goredis.Client)(nil))
	// Pin the Paymax markup so the expected fee is exact and independent of the
	// production rule table: 10 bps of 500,000 kobo = 500. Maplerad itself returns
	// no fee (its margin is in the rate), so this markup IS the disclosed fee.
	svc.SetMarkup(fx.NewMarkup(10))

	userID := seedUser(t, ctx, pool)
	// Fund the NGN wallet with ample headroom for the source+fee debit.
	seedWallet(t, ctx, led, userID, 5_000_000)

	// ── Quote (persists an fx_quotes row) ───────────────────────────────────
	quote, err := svc.GetQuote(ctx, userID, fx.QuoteRequest{
		SourceCurrency: "NGN", TargetCurrency: "USD", AmountKobo: 500_000,
	})
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	const wantSource = int64(500_000)
	const wantFee = int64(500) // 10 bps of wantSource — see SetMarkup above
	const wantTarget = int64(32_500)
	if quote.SourceAmountKobo != wantSource || quote.FeeKobo != wantFee || quote.TargetAmountMinor != wantTarget {
		t.Fatalf("quote amounts = (src %d, fee %d, tgt %d), want (%d,%d,%d)",
			quote.SourceAmountKobo, quote.FeeKobo, quote.TargetAmountMinor, wantSource, wantFee, wantTarget)
	}

	walletBefore, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance before convert: %v", err)
	}

	// ── Convert ─────────────────────────────────────────────────────────────
	idemKey := "fxconv-" + uuid.New().String()
	conv, err := svc.Convert(ctx, userID, fx.ConvertRequest{QuoteID: quote.ID, IdempotencyKey: idemKey})
	if err != nil {
		t.Fatalf("Convert: %v", err)
	}
	if conv.Status != "completed" {
		t.Errorf("conversion status = %s, want completed", conv.Status)
	}
	if conv.TargetAmountMinor != wantTarget {
		t.Errorf("conversion target = %d, want %d", conv.TargetAmountMinor, wantTarget)
	}

	// (a) LEG 1: the NGN wallet fell by source+fee.
	walletAfter, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after convert: %v", err)
	}
	if drop := walletBefore - walletAfter; drop != wantSource+wantFee {
		t.Errorf("NGN wallet fell by %d, want %d (source %d + fee %d) — LEG 1 (RISK-FX-1)", drop, wantSource+wantFee, wantSource, wantFee)
	}
	// The source (debit) leg is posted via ledger.Debit with base key
	// "<idem>:debit"; the ledger suffixes each side, so the two rows are keyed
	// "<idem>:debit:debit" and "<idem>:debit:credit" (prefix "<idem>:debit:").
	if n := ledgerLegsForKey(t, ctx, pool, idemKey+":debit"); n != 2 {
		t.Errorf("source-leg ledger entries for base %q = %d, want 2 (balanced pair)", idemKey+":debit", n)
	}
	// (b) LEG 2: the target leg is posted via PostJournal with base key
	// "<idem>:credit" → rows "<idem>:credit:debit" and "<idem>:credit:credit".
	if n := ledgerLegsForKey(t, ctx, pool, idemKey+":credit"); n != 2 {
		t.Errorf("target-leg ledger entries for base %q = %d, want 2 (balanced pair) — LEG 2 (RISK-FX-1)", idemKey+":credit", n)
	}

	// (c) currency_wallets credited by the target amount as a mirror.
	if got := currencyWalletBalance(t, ctx, pool, userID, "USD"); got != wantTarget {
		t.Errorf("USD currency_wallets balance = %d, want %d (mirror credit)", got, wantTarget)
	}
	// Exactly one fx_conversions row for this key.
	if n := fxConversionRows(t, ctx, pool, idemKey); n != 1 {
		t.Errorf("fx_conversions rows for key = %d, want exactly 1", n)
	}

	// ── REPLAY: same idempotency_key must NOT double-credit (RISK-FX-2) ─────
	convReplay, err := svc.Convert(ctx, userID, fx.ConvertRequest{QuoteID: quote.ID, IdempotencyKey: idemKey})
	if err != nil {
		t.Fatalf("Convert (replay): %v", err)
	}
	if convReplay.ID != conv.ID {
		t.Errorf("replay returned a DIFFERENT conversion id: first=%s replay=%s", conv.ID, convReplay.ID)
	}
	// Still exactly one conversion row, one USD credit, unchanged NGN wallet.
	if n := fxConversionRows(t, ctx, pool, idemKey); n != 1 {
		t.Errorf("fx_conversions rows after replay = %d, want still exactly 1 (no double insert)", n)
	}
	if got := currencyWalletBalance(t, ctx, pool, userID, "USD"); got != wantTarget {
		t.Errorf("USD currency_wallets balance after replay = %d, want still %d (NO double credit)", got, wantTarget)
	}
	balAfterReplay, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after replay: %v", err)
	}
	if balAfterReplay != walletAfter {
		t.Errorf("NGN wallet changed on replay: before=%d after=%d — double debit!", walletAfter, balAfterReplay)
	}
	// No extra ledger legs were posted on replay (per-leg suffixed keys are unique).
	if n := ledgerLegsForKey(t, ctx, pool, idemKey+":debit"); n != 2 {
		t.Errorf("source-leg entries after replay = %d, want still 2", n)
	}
	if n := ledgerLegsForKey(t, ctx, pool, idemKey+":credit"); n != 2 {
		t.Errorf("target-leg entries after replay = %d, want still 2", n)
	}
}

// ── DB helpers ─────────────────────────────────────────────────────────────

// ledgerLegsForKey counts the balanced pair a Debit/PostJournal wrote for baseKey.
// The ledger suffixes each leg's idempotency_key with ":debit"/":credit" (see
// finance/ledger/repository.go), so a posting made under baseKey stores exactly
// two rows keyed baseKey:debit and baseKey:credit — matched here by prefix.
func ledgerLegsForKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, baseKey string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, baseKey+":%").Scan(&n); err != nil {
		t.Fatalf("count ledger entries for key: %v", err)
	}
	return n
}

func fxConversionRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, idempotencyKey string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.fx_conversions WHERE idempotency_key=$1`, idempotencyKey).Scan(&n); err != nil {
		t.Fatalf("count fx_conversions: %v", err)
	}
	return n
}

func currencyWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, currency string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(ctx, `SELECT balance_minor FROM public.currency_wallets WHERE user_id=$1 AND currency=$2`, userID, currency).Scan(&bal)
	if err != nil {
		t.Fatalf("read currency_wallets %s/%s: %v", userID, currency, err)
	}
	return bal
}
