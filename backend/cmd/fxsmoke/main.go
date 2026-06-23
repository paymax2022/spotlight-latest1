// Command fxsmoke validates live connectivity to the FX providers using the
// configured sandbox credentials. It calls the real provider clients directly
// (bypassing the orchestrator's deterministic fallback) so auth / shape /
// network failures surface clearly. Run with: `make fxsmoke` (sources .env).
//
// Exit code 0 = all configured providers responded; 1 = at least one failed.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"spotlight/backend/internal/provider/eversend"
	"spotlight/backend/internal/provider/maplerad"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	failed := false
	any := false

	// --- Maplerad ---
	if key := os.Getenv("MAPLERAD_SECRET_KEY"); key != "" {
		any = true
		fmt.Println("→ Maplerad: requesting USD→NGN quote for $1,000…")
		cli := maplerad.New(key, os.Getenv("MAPLERAD_PROD") == "true")
		q, err := cli.GetFXQuote(ctx, maplerad.FXQuoteRequest{SourceCurrency: "USD", TargetCurrency: "NGN", AmountKobo: 100_000})
		if err != nil {
			fmt.Printf("  ✗ Maplerad error: %v\n", err)
			failed = true
		} else {
			fmt.Printf("  ✓ Maplerad rate=%v target=%d fee=%d quote_id=%s\n", q.Rate, q.TargetAmountMinor, q.Fee, q.QuoteID)
		}
	} else {
		fmt.Println("• Maplerad: MAPLERAD_SECRET_KEY not set — skipped")
	}

	// --- Eversend ---
	if id, sec := os.Getenv("EVERSEND_CLIENT_ID"), os.Getenv("EVERSEND_CLIENT_SECRET"); id != "" && sec != "" {
		any = true
		fmt.Println("→ Eversend: requesting USD→KES quotation for $1,000…")
		cli := eversend.New(id, sec, os.Getenv("EVERSEND_PROD") == "true")
		q, err := cli.CreateQuotation(ctx, "USD", "KES", 1000.0)
		if err != nil {
			fmt.Printf("  ✗ Eversend error: %v\n", err)
			failed = true
		} else {
			fmt.Printf("  ✓ Eversend rate=%v dest=%v fee=%v token=%s\n", q.Rate, q.ToAmount, q.Fee, q.Token)
		}
	} else {
		fmt.Println("• Eversend: EVERSEND_CLIENT_ID/SECRET not set — skipped")
	}

	if !any {
		fmt.Println("No provider credentials configured. Set them in backend/.env.")
		os.Exit(1)
	}
	if failed {
		fmt.Println("\nFX smoke: FAILED (see errors above).")
		os.Exit(1)
	}
	fmt.Println("\nFX smoke: OK — all configured providers responded.")
}
