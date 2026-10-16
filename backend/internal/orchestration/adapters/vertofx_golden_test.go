package adapters

import (
	"context"
	"testing"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider/vertofx"
)

// Golden pricing decomposition (SP-3a D1): the FX spread is expressed EXACTLY
// ONCE, as the fxMarkup passed to Verto. The adapter must not surface a
// separate ProviderFee line (that stacked a second markup on the quote).
// The unit modelled here is basis points, sent as markupPerc with
// markupType "percentage"; the real Verto sign/unit is sandbox-confirmed later.
func TestVertoFX_GoldenSpreadAppearsExactlyOnce(t *testing.T) {
	const goldenMarkupBPS = 20 // canonical modelled spread, pinned literally

	// 1. Quote: no ProviderFee and no RailFee line from the adapter.
	srv := fakeVerto(t, "1.5")
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)
	q, err := live.Quote(context.Background(), "USD", "EUR", 100000, orch.AmountSource, orch.RailIBAN)
	if err != nil {
		t.Fatal(err)
	}
	if !q.Viable {
		t.Fatalf("quote not viable: %+v", q)
	}
	if q.ProviderFee.AmountMinor != 0 {
		t.Fatalf("ProviderFee must be 0 (spread lives only in fxMarkup), got %+v", q.ProviderFee)
	}
	if q.RailFee.AmountMinor != 0 {
		t.Fatalf("RailFee = %+v", q.RailFee)
	}
	// The shared quote builder (deterministic adapter path) must agree.
	dq, err := vertoBuildQuote("vertofx", 0.97, "USD", "EUR", 100000, orch.AmountSource, orch.RailIBAN, 1_500_000, true)
	if err != nil {
		t.Fatal(err)
	}
	if dq.ProviderFee.AmountMinor != 0 {
		t.Fatalf("built quote ProviderFee = %+v", dq.ProviderFee)
	}

	// 2. Trade: the single spread is the fxMarkup passed to Verto.
	var body map[string]any
	esrv := execServer(t, "pending", &body, false)
	defer esrv.Close()
	elive := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(esrv.URL), "", false)
	oq := &orch.Quote{Source: orch.NewMoney(100000, "usd"), Destination: orch.NewMoney(1, "ngn"), AllInRate: 1}
	if _, err := elive.ExecuteConversion(context.Background(), oq, "idem-golden"); err != nil {
		t.Fatal(err)
	}
	mk, _ := body["fxMarkup"].(map[string]any)
	if mk["markupType"] != "percentage" || mk["markupPerc"] != float64(goldenMarkupBPS) {
		t.Fatalf("fxMarkup = %v, want percentage/%d", mk, goldenMarkupBPS)
	}
	if len(mk) != 2 {
		t.Fatalf("fxMarkup must carry only type+perc, got %v", mk)
	}
}
