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
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	failed := false
	any := false

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
