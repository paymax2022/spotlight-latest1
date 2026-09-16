package fx_test

// ---------------------------------------------------------------------------
// LIVE-PROVIDER test for the Maplerad FX quote→exchange pair, driven through the
// real orchestration adapter (adapters.MapleradLive.ExecuteConversion).
//
// Why this exists: both Maplerad FX calls were originally written blind and were
// wrong in ways only a live call could reveal —
//   - GET /fx/rates is a rate BOARD (a corridor list, no quote id), not a quote
//     service, so the client's object-shaped decode failed on every call;
//   - POST /fx/convert does not exist (404). The real exchange is POST /fx, keyed
//     on `quote_reference` from POST /fx/quote.
// Unit tests pin the decoded shapes, but only a live run proves the endpoints,
// field names and auth are right. This test is that proof.
//
// ⚠️ This test MOVES MONEY in the Maplerad SANDBOX, so it is opt-in twice: it runs
// only when MAPLERAD_SECRET_KEY is set AND FX_LIVE_EXCHANGE=1. It refuses to run
// against production credentials (MAPLERAD_PROD=true).
//
//	cd backend && set -a && . ./.env && set +a && \
//	  FX_LIVE_EXCHANGE=1 go test ./tests/fx/... -run LiveProviderMapleradExchange -v
//
// Corridor choice: the sandbox business has balance in every currency EXCEPT USD,
// and NGN/GBP/EUR exchanges are disabled on it — KES→USD is funded and enabled.
// The amount is deliberately tiny (KES 1,000 → ~USD 8.60).
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
	"spotlight/backend/internal/provider/maplerad"
)

func liveMapleradAdapter(t *testing.T) *adapters.MapleradLive {
	t.Helper()
	key := os.Getenv("MAPLERAD_SECRET_KEY")
	if key == "" {
		t.Skip("MAPLERAD_SECRET_KEY unset — skipping live Maplerad exchange test")
	}
	if os.Getenv("FX_LIVE_EXCHANGE") != "1" {
		t.Skip("FX_LIVE_EXCHANGE!=1 — skipping (this test exchanges real sandbox balance)")
	}
	if strings.EqualFold(os.Getenv("MAPLERAD_PROD"), "true") {
		t.Fatal("refusing to run a live exchange against MAPLERAD_PROD=true credentials")
	}
	return adapters.NewMapleradLive(maplerad.New(key, false), os.Getenv("MAPLERAD_WEBHOOK_SECRET"), false)
}

// TestLiveProviderMapleradExchange_QuoteThenConvert drives the adapter end to end:
// it must book a firm quote (POST /fx/quote), exchange against that single-use
// reference (POST /fx), and normalize the provider payload — which carries no
// transaction id of its own — into an ExecuteResult.
func TestLiveProviderMapleradExchange_QuoteThenConvert(t *testing.T) {
	adapter := liveMapleradAdapter(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const sourceMinor = int64(100_000) // KES 1,000.00
	q := &orch.Quote{
		Source:      orch.NewMoney(sourceMinor, "KES"),
		Destination: orch.NewMoney(0, "USD"),
		AllInRate:   0.0086,
	}

	res, err := adapter.ExecuteConversion(ctx, q, "fx-live-test-"+time.Now().UTC().Format("20060102150405"))
	if err != nil {
		t.Fatalf("ExecuteConversion against the Maplerad sandbox: %v", err)
	}
	// A provider ref is mandatory: it is what reconciliation joins on. Maplerad's
	// exchange payload has no id, so the adapter must fall back to the single-use
	// quote reference rather than leave this empty.
	if strings.TrimSpace(res.ProviderRef) == "" {
		t.Error("ProviderRef is empty — reconciliation would have nothing to join on")
	}
	if res.ExecutedRate <= 0 {
		t.Errorf("ExecutedRate = %v, want the provider's rate", res.ExecutedRate)
	}
	if res.Destination.Currency != "USD" || res.Destination.AmountMinor <= 0 {
		t.Errorf("destination = %+v, want a positive USD amount from the provider", res.Destination)
	}
	if res.Status != "settled" {
		t.Errorf("status = %q, want settled", res.Status)
	}
	t.Logf("sandbox exchange OK: KES %d → %s %d @ %v (ref %s)",
		sourceMinor, res.Destination.Currency, res.Destination.AmountMinor, res.ExecutedRate, res.ProviderRef)
}

// TestLiveProviderMapleradExchange_SpentReferenceIsRejected proves the provider's
// single-use guarantee — the backstop our idempotency layer leans on, given the
// exchange endpoint accepts no client reference.
func TestLiveProviderMapleradExchange_SpentReferenceIsRejected(t *testing.T) {
	liveMapleradAdapter(t) // gating only
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cli := maplerad.New(os.Getenv("MAPLERAD_SECRET_KEY"), false)
	q, err := cli.CreateFXQuote(ctx, maplerad.FXQuoteRequest{
		SourceCurrency: "KES", TargetCurrency: "USD", AmountKobo: 100_000,
	})
	if err != nil {
		t.Fatalf("CreateFXQuote: %v", err)
	}
	if _, err := cli.ConvertFX(ctx, maplerad.ConvertFXRequest{QuoteID: q.QuoteID}); err != nil {
		t.Fatalf("first exchange should succeed: %v", err)
	}
	_, err = cli.ConvertFX(ctx, maplerad.ConvertFXRequest{QuoteID: q.QuoteID})
	if err == nil {
		t.Fatal("SECOND exchange on the same reference succeeded — the single-use " +
			"guarantee this design relies on does not hold")
	}
	t.Logf("replay correctly rejected: %v", err)
}
