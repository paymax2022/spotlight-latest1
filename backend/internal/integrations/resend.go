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

// Synchronous Resend email, used where a payload must not sit in a queue (the
// parcel receiver's drop-off PIN). Its errors never echo the message it sent:
// only the provider's status and short error name.

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
