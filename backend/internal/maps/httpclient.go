package maps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

// defaultHTTP is the shared client for all provider HTTP calls. Provider keys
// are read server-side and attached here — they never reach the client.
var defaultHTTP = &http.Client{Timeout: 8 * time.Second}

// Retry policy for idempotent provider GETs. GETs are safe to retry, so a couple
// of quick, jittered retries smooth over transient network blips and 5xx/429s
// without user-visible failures. Non-idempotent calls do NOT go through here.
const (
	httpMaxAttempts = 3                      // 1 initial + 2 retries
	httpRetryBase   = 150 * time.Millisecond // base backoff before jitter
)

// getJSON performs a GET and decodes a JSON body into dst. Transient failures
// (network error, HTTP 429, or 5xx) are retried up to httpMaxAttempts with
// exponential backoff + full jitter. The context deadline still bounds total time,
// and the deterministic mock providers don't use this path, so offline dev is
// unaffected.
func getJSON(ctx context.Context, url string, dst any) error {
	var lastErr error
	for attempt := 0; attempt < httpMaxAttempts; attempt++ {
		if attempt > 0 {
			// Exponential base with full jitter: sleep in [0, base*2^(attempt-1)).
			backoff := httpRetryBase * time.Duration(1<<(attempt-1))
			jittered := time.Duration(rand.Int63n(int64(backoff) + 1))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(jittered):
			}
		}
		retryable, err := doGetJSON(ctx, url, dst)
		if err == nil {
			return nil
		}
		lastErr = err
		if !retryable {
			return err // 4xx (except 429), decode error, bad request — don't retry
		}
	}
	return lastErr
}

// doGetJSON performs a single GET+decode. It returns retryable=true for transient
// failures (network error, HTTP 429, or 5xx) so the caller can back off and retry.
func doGetJSON(ctx context.Context, url string, dst any) (retryable bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "spotlight-mapservice/1.0")
	resp, err := defaultHTTP.Do(req)
	if err != nil {
		return true, err // network/transport error — safe to retry an idempotent GET
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		httpErr := fmt.Errorf("maps: http %d from %s: %s", resp.StatusCode, redact(url), string(body))
		transient := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		return transient, httpErr
	}
	return false, json.NewDecoder(resp.Body).Decode(dst)
}

// redact hides query strings (which may carry API keys) from error messages/logs.
func redact(url string) string {
	if i := indexByte(url, '?'); i >= 0 {
		return url[:i] + "?<redacted>"
	}
	return url
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
