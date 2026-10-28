package tests

// Crypto swap-pipeline load test (Phase 2, Task 1.4).
//
// SCOPE (coordinator ruling): this exercises the legacy crypto.Service swap
// path (SwapQuoteQuidax -> Swap(quotationID) -> SwapSettlement) against the
// MOCK swap provider that NewService hardwires. It validates the pipeline,
// the double-entry ledger and settlement reads under concurrency. It does NOT
// validate live Quidax; the real adapter lives in internal/cryptosvc and its
// live validation is deferred.
//
// Needs a migrated Postgres (TEST_DATABASE_URL, e.g. local supabase :54322);
// SKIPPED otherwise. Tunables: CRYPTO_LOAD_USERS (default 20),
// CRYPTO_LOAD_CSV (optional path for the per-swap CSV).
//
//	cd backend && go test ./tests -run TestCryptoLoadSwapPipeline -v -timeout=10m

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crypto"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

type loadSample struct {
	idx                       int
	key                       string
	quoteMs, swapMs, settleMs float64
	settledFlag               bool
	swapOK                    bool  // quote+swap succeeded (ledger legs durable)
	settleErr                 error // settlement read failed (tracked separately)
	err                       error
}

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(float64(len(sorted))*p+0.9999999) - 1
	if i < 0 {
		i = 0
	}
	if i >= len(sorted) {
		i = len(sorted) - 1
	}
	return sorted[i]
}

func stage(samples []loadSample, f func(loadSample) float64) (p50, p95, p99 float64) {
	var v []float64
	for _, s := range samples {
		if s.swapOK {
			v = append(v, f(s))
		}
	}
	sort.Float64s(v)
	return pct(v, .50), pct(v, .95), pct(v, .99)
}

func TestCryptoLoadSwapPipeline(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping crypto swap load test")
	}
	users := 20
	if v, err := strconv.Atoi(os.Getenv("CRYPTO_LOAD_USERS")); err == nil && v > 0 {
		users = v
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("dsn: %v", err)
	}
	cfg.MaxConns = int32(users + 10)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	led.SetDebitGuard(tiers.NewService(pool).EnforceWalletDebitLimitTx)
	svc := crypto.NewService(pool, led, crypto.NewMockPriceProvider())

	seedAuth := func() string {
		id := uuid.NewString()
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, id)
		return id
	}
	admin := seedAuth()
	usdt, err := svc.AdminConfigAsset(ctx, admin, "USDT", "Tether USD", 1_000_000, true)
	if err != nil {
		t.Fatalf("config USDT: %v", err)
	}
	btc, err := svc.AdminConfigAsset(ctx, admin, "BTC", "Bitcoin", 100_000_000, true)
	if err != nil {
		t.Fatalf("config BTC: %v", err)
	}

	const swapUnits int64 = 1_000_000_000 // 1,000 USDT (~NGN 1.6M at the mock price)
	run := uuid.NewString()[:8]
	uid := make([]string, users)
	for i := range uid {
		uid[i] = seedAuth()
		testsupport.SetKycTier(t, ctx, pool, uid[i], testsupport.KycTierUnlimited)
		if _, err := pool.Exec(ctx,
			`INSERT INTO crypto_holdings (user_id, asset_id, units) VALUES ($1,$2,$3)
			 ON CONFLICT (user_id, asset_id) DO UPDATE SET units = EXCLUDED.units`,
			uid[i], usdt.ID, swapUnits*2); err != nil {
			t.Fatalf("seed holdings: %v", err)
		}
	}

	samples := make([]loadSample, users)
	var ready, done sync.WaitGroup
	start := make(chan struct{})
	ready.Add(users)
	done.Add(users)
	for i := 0; i < users; i++ {
		go func(i int) {
			defer done.Done()
			s := loadSample{idx: i, key: fmt.Sprintf("ldtest-%s-%d", run, i)}
			ready.Done()
			<-start
			defer func() { samples[i] = s }()

			t0 := time.Now()
			q, err := svc.SwapQuoteQuidax(ctx, uid[i], usdt.ID, btc.ID, swapUnits)
			s.quoteMs = float64(time.Since(t0).Microseconds()) / 1000
			if err != nil {
				s.err = fmt.Errorf("quote: %w", err)
				return
			}
			t1 := time.Now()
			o, err := svc.Swap(ctx, uid[i], usdt.ID, btc.ID, swapUnits, q.QuotationID, s.key)
			s.swapMs = float64(time.Since(t1).Microseconds()) / 1000
			if err != nil {
				s.err = fmt.Errorf("swap: %w", err)
				return
			}
			s.swapOK = true
			// Deliver the Quidax completion webhook (executing -> completed ->
			// ledger settled), as the provider callback does in production.
			t2 := time.Now()
			if err := svc.UpdateSwapOrderStatusFromWebhook(ctx, o.SwapTransactionID, "completed"); err != nil {
				s.settleErr = fmt.Errorf("webhook completion: %w", err)
				return
			}
			// Settlement by polling the owner-scoped settlement read.
			deadline := t2.Add(5 * time.Second)
			for {
				st, err := svc.SwapSettlement(ctx, uid[i], o.ID)
				if err == nil && st.LedgerSettled {
					s.settledFlag = true
					break
				}
				if err == nil {
					if time.Now().After(deadline) {
						break // leave settledFlag false; asserted below
					}
					time.Sleep(20 * time.Millisecond)
					continue
				}
				// Only "not yet visible" is retried; schema/SQL errors are final.
				if !errors.Is(err, crypto.ErrNotFound) || time.Now().After(deadline) {
					s.settleErr = fmt.Errorf("settlement poll: %w", err)
					return
				}
				time.Sleep(20 * time.Millisecond)
			}
			s.settleMs = float64(time.Since(t2).Microseconds()) / 1000
		}(i)
	}
	ready.Wait()
	wall := time.Now()
	close(start)
	done.Wait()
	elapsed := time.Since(wall).Seconds()

	// CSV
	var sb strings.Builder
	sb.WriteString("order_id,quote_latency_ms,swap_latency_ms,settlement_latency_ms,ledger_settled_flag,error\n")
	ok, failures, settleFails, unsettled := 0, []string{}, 0, 0
	var settleSample error
	for _, s := range samples {
		e := ""
		if s.err != nil {
			e = strings.ReplaceAll(s.err.Error(), ",", ";")
			failures = append(failures, fmt.Sprintf("#%d %v", s.idx, s.err))
		} else {
			ok++
			if s.settleErr == nil && !s.settledFlag {
				unsettled++
			}
		}
		if s.settleErr != nil {
			settleFails++
			settleSample = s.settleErr
			e = strings.ReplaceAll(s.settleErr.Error(), ",", ";")
		}
		fmt.Fprintf(&sb, "%s,%.2f,%.2f,%.2f,%t,%s\n", s.key, s.quoteMs, s.swapMs, s.settleMs, s.settledFlag, e)
	}
	if p := os.Getenv("CRYPTO_LOAD_CSV"); p != "" {
		if err := os.WriteFile(p, []byte(sb.String()), 0o644); err != nil {
			t.Logf("csv write: %v", err)
		}
	}
	t.Logf("CSV:\n%s", sb.String())

	q50, q95, q99 := stage(samples, func(s loadSample) float64 { return s.quoteMs })
	w50, w95, w99 := stage(samples, func(s loadSample) float64 { return s.swapMs })
	s50, s95, s99 := stage(samples, func(s loadSample) float64 { return s.settleMs })
	e50, e95, e99 := stage(samples, func(s loadSample) float64 { return s.quoteMs + s.swapMs + s.settleMs })
	tput := float64(ok) / elapsed
	t.Logf("users=%d ok=%d failed=%d wall=%.3fs throughput=%.1f swaps/s", users, ok, len(failures), elapsed, tput)
	t.Logf("LATENCY_MS quote p50/p95/p99 = %.1f/%.1f/%.1f", q50, q95, q99)
	t.Logf("LATENCY_MS swap  p50/p95/p99 = %.1f/%.1f/%.1f", w50, w95, w99)
	t.Logf("LATENCY_MS settle p50/p95/p99 = %.1f/%.1f/%.1f", s50, s95, s99)
	t.Logf("LATENCY_MS end-to-end p50/p95/p99 = %.1f/%.1f/%.1f", e50, e95, e99)

	// Ledger audit. Schema: direction is encoded in ledger_entries.type; every
	// swap posts :sell, :buy, :spread journals keyed "<swapKey>:...". Per swap,
	// credits (CREDIT, REVERSAL_CREDIT) must equal debits (DEBIT, REVERSAL_DEBIT).
	rows, err := pool.Query(ctx, `
		SELECT split_part(idempotency_key, ':', 1) AS swap_key,
		       COUNT(*),
		       COALESCE(SUM(amount_kobo) FILTER (WHERE type IN ('DEBIT','REVERSAL_DEBIT')),0),
		       COALESCE(SUM(amount_kobo) FILTER (WHERE type IN ('CREDIT','REVERSAL_CREDIT')),0)
		  FROM ledger_entries
		 WHERE idempotency_key LIKE $1
		 GROUP BY 1`, "ldtest-"+run+"-%")
	if err != nil {
		t.Fatalf("ledger audit query: %v", err)
	}
	defer rows.Close()
	var nSwaps, imbalanced int
	var totDr, totCr int64
	for rows.Next() {
		var k string
		var n int
		var dr, cr int64
		if err := rows.Scan(&k, &n, &dr, &cr); err != nil {
			t.Fatalf("scan: %v", err)
		}
		nSwaps++
		totDr += dr
		totCr += cr
		if dr != cr {
			imbalanced++
			t.Errorf("IMBALANCE swap %s: debits=%d credits=%d rows=%d", k, dr, cr, n)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	// Orphans: ledger legs whose swap has no recorded order.
	var orphans int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT split_part(le.idempotency_key, ':', 1))
		  FROM ledger_entries le
		 WHERE le.idempotency_key LIKE $1
		   AND NOT EXISTS (SELECT 1 FROM crypto_swap_orders o
		                    WHERE o.idempotency_key = split_part(le.idempotency_key, ':', 1))`,
		"ldtest-"+run+"-%").Scan(&orphans); err != nil {
		t.Logf("orphan query skipped (schema): %v", err)
	}
	t.Logf("LEDGER swaps_audited=%d imbalanced=%d orphans=%d total_debits=%d total_credits=%d",
		nSwaps, imbalanced, orphans, totDr, totCr)

	t.Logf("settlement read failures=%d/%d sample=%v", settleFails, ok, settleSample)
	if settleFails > 0 {
		t.Errorf("settlement polling failed for %d/%d swaps: %v", settleFails, ok, settleSample)
	}
	if unsettled > 0 {
		t.Errorf("%d/%d successful swaps not ledger-settled after webhook; all swaps must be settled", unsettled, ok)
	}
	// Reconciliation dashboard must count the settled swaps (B3): completed +
	// ledger_settled orders are reconciled, none may drift.
	if rep, err := svc.ReconcileSwapOrders(ctx, false, time.Time{}, time.Time{}); err != nil {
		t.Errorf("reconcile: %v", err)
	} else {
		t.Logf("RECON %s", rep.Summary)
		if rep.ReconcilledOrders < ok-settleFails-unsettled || rep.ReconcilledOrders == 0 {
			t.Errorf("reconciliation shows %d reconciled orders, want >= %d settled swaps", rep.ReconcilledOrders, ok-settleFails-unsettled)
		}
	}
	if len(failures) > 0 {
		t.Errorf("%d/%d swaps failed: %v", len(failures), users, failures)
	}
	if nSwaps != ok {
		t.Errorf("ledger has %d audited swaps, want %d successful", nSwaps, ok)
	}
	if imbalanced > 0 || totDr != totCr {
		t.Errorf("ledger imbalance: debits=%d credits=%d", totDr, totCr)
	}
	if orphans > 0 {
		t.Errorf("%d orphaned ledger swaps", orphans)
	}
	if e95 >= 2000 {
		t.Errorf("p95 end-to-end %.1fms >= 2000ms", e95)
	}
	if tput <= 20 {
		t.Errorf("throughput %.1f swaps/s <= 20", tput)
	}
}
