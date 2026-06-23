package maps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// defaultHTTP is the shared client for all provider HTTP calls. Provider keys
// are read server-side and attached here — they never reach the client.
var defaultHTTP = &http.Client{Timeout: 8 * time.Second}

// getJSON performs a GET and decodes a JSON body into dst.
func getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "spotlight-mapservice/1.0")
	resp, err := defaultHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("maps: http %d from %s: %s", resp.StatusCode, redact(url), string(body))
	}
	return json.NewDecoder(resp.Body).Decode(dst)
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
