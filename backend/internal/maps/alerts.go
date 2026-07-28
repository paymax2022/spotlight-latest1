package maps

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// NewWebhookAlerter returns an AlertFunc that POSTs budget alerts (50/75/90% of a
// provider SKU cap) to a webhook (Slack-compatible JSON with a "text" field, plus
// structured fields). Falls back to logging if the URL is empty. Wire it into the
// UsageTracker so cost overruns page someone instead of only hitting the log.
func NewWebhookAlerter(url string) AlertFunc {
	if url == "" {
		return defaultAlert
	}
	client := &http.Client{Timeout: 5 * time.Second}
	return func(provider string, primitive Primitive, pct int, count, cap int64) {
		// Always log too, so the signal survives webhook failures.
		defaultAlert(provider, primitive, pct, count, cap)
		body, err := json.Marshal(map[string]any{
			"text": "[maps] budget alert " + itoa(pct) + "% — " + provider + "." + string(primitive),
			"provider":  provider,
			"primitive": string(primitive),
			"pct":       pct,
			"count":     count,
			"cap":       cap,
		})
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[maps] budget alert webhook failed: %v", err)
			return
		}
		_ = resp.Body.Close()
	}
}
