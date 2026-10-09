// Command fxsmoke validates live connectivity to the FX providers using the
// configured sandbox credentials. It calls the real provider clients directly
// (bypassing the orchestrator's deterministic fallback) so auth / shape /
// network failures surface clearly. Run with: `make fxsmoke` (sources .env).
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

	if key := os.Getenv("MAPLERAD_SECRET_KEY"); key != "" {
		any = true
		_, _ = fmt.Fprintln(os.Stdout, "→ Maplerad: requesting USD→NGN quote for $1,000…")
		cli := maplerad.New(key, os.Getenv("MAPLERAD_PROD") == "true")
		q, err := cli.GetFXQuote(ctx, maplerad.FXQuoteRequest{SourceCurrency: "USD", TargetCurrency: "NGN", AmountKobo: 100_000})
		if err != nil {
			_, _ = fmt.Fprintf(os.Stdout, "  ✗ Maplerad error: %v\n", err)
			failed = true
		} else {
			_, _ = fmt.Fprintf(os.Stdout, "  ✓ Maplerad rate=%v target=%d fee=%d quote_id=%s\n", q.Rate, q.TargetAmountMinor, q.Fee, q.QuoteID)
		}
	} else {
		_, _ = fmt.Fprintln(os.Stdout, "• Maplerad: MAPLERAD_SECRET_KEY not set — skipped")
	}

	if id, sec := os.Getenv("EVERSEND_CLIENT_ID"), os.Getenv("EVERSEND_CLIENT_SECRET"); id != "" && sec != "" {
		any = true
		_, _ = fmt.Fprintln(os.Stdout, "→ Eversend: requesting USD→KES quotation for $1,000…")
		cli := eversend.New(id, sec, os.Getenv("EVERSEND_PROD") == "true")
		q, err := cli.CreateQuotation(ctx, "USD", "KES", 1000.0)
		if err != nil {
			_, _ = fmt.Fprintf(os.Stdout, "  ✗ Eversend error: %v\n", err)
			failed = true
		} else {
			_, _ = fmt.Fprintf(os.Stdout, "  ✓ Eversend rate=%v dest=%v fee=%v token=%s\n", q.Rate, q.ToAmount, q.Fee, q.Token)
		}
	} else {
		_, _ = fmt.Fprintln(os.Stdout, "• Eversend: EVERSEND_CLIENT_ID/SECRET not set — skipped")
	}

	if !any {
		_, _ = fmt.Fprintln(os.Stdout, "No provider credentials configured. Set them in backend/.env.")
		os.Exit(1)
	}
	if failed {
		_, _ = fmt.Fprintln(os.Stdout, "\nFX smoke: FAILED (see errors above).")
		os.Exit(1)
	}
	_, _ = fmt.Fprintln(os.Stdout, "\nFX smoke: OK — all configured providers responded.")
}
