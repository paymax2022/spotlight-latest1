package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Synchronous, free notification channels used where a payload must not sit in
// a queue (the parcel receiver's drop-off PIN): Resend email and Expo push.
// Neither ever echoes the message it sent in its errors; only the provider's
// status (and, for Resend, its short error name) is returned.

// ResendClient sends plain-text email through Resend.
type ResendClient struct {
	apiKey, from string
	http         *http.Client
	url          string
}

// NewResendClient returns nil when no API key is configured.
func NewResendClient(apiKey, from string) *ResendClient {
	if apiKey == "" {
		return nil
	}
	return &ResendClient{apiKey: apiKey, from: from, http: &http.Client{Timeout: 15 * time.Second}, url: "https://api.resend.com/emails"}
}

// SendEmail delivers one plain-text email.
func (c *ResendClient) SendEmail(ctx context.Context, to, subject, text string) error {
	body, err := json.Marshal(map[string]any{"from": c.from, "to": []string{to}, "subject": subject, "text": text})
	if err != nil {
		return fmt.Errorf("resend: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("resend: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("resend: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		var e struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&e)
		return fmt.Errorf("resend: provider returned %d (%s)", resp.StatusCode, e.Name)
	}
	return nil
}

// ExpoPushClient sends push notifications through Expo's push service (free).
type ExpoPushClient struct {
	accessToken string // optional (EXPO_PUSH_TOKEN): only for projects with enhanced push security
	http        *http.Client
	url         string
}

// NewExpoPushClient always returns a client: Expo push needs no key.
func NewExpoPushClient(accessToken string) *ExpoPushClient {
	return &ExpoPushClient{accessToken: accessToken, http: &http.Client{Timeout: 15 * time.Second}, url: "https://exp.host/--/api/v2/push/send"}
}

// SendPush sends one message to each token. Expo answers 200 even when a
// device is unregistered, so success means at least one ticket came back "ok".
func (c *ExpoPushClient) SendPush(ctx context.Context, tokens []string, title, body string) error {
	if len(tokens) == 0 {
		return fmt.Errorf("expo: no push tokens")
	}
	msgs := make([]map[string]any, 0, len(tokens))
	for _, t := range tokens {
		msgs = append(msgs, map[string]any{"to": t, "title": title, "body": body, "sound": "default", "priority": "high"})
	}
	payload, err := json.Marshal(msgs)
	if err != nil {
		return fmt.Errorf("expo: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("expo: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("expo: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("expo: provider returned %d", resp.StatusCode)
	}
	var out struct {
		Data []struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out); err != nil {
		return fmt.Errorf("expo: unreadable reply: %w", err)
	}
	for _, t := range out.Data {
		if t.Status == "ok" {
			return nil
		}
	}
	return fmt.Errorf("expo: no device accepted the push (%d tickets)", len(out.Data))
}
