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

// TermiiClient sends SMS via the Termii v3 API (termii.com). Also satisfies
// otp.EmailSender via SendOTP so the OTP service can deliver codes by SMS
// without knowing the transport.
type TermiiClient struct {
	apiKey   string
	senderID string
	http     *http.Client
}

// NewTermiiClient returns nil when no API key is configured so callers can
// gate on a single nil check.
func NewTermiiClient(apiKey, senderID string) *TermiiClient {
	if apiKey == "" {
		return nil
	}
	return &TermiiClient{
		apiKey:   apiKey,
		senderID: senderID,
		http:     &http.Client{Timeout: 15 * time.Second},
	}
}

const termiiSendURL = "https://v3.api.ng.termii.com/api/sms/send"

type termiiRequest struct {
	To      string `json:"to"`
	From    string `json:"from"`
	SMS     string `json:"sms"`
	Type    string `json:"type"`
	Channel string `json:"channel"`
	APIKey  string `json:"api_key"`
}

// SendSMS delivers a plain-text message to an E.164-style number.
func (c *TermiiClient) SendSMS(ctx context.Context, to, body string) error {
	payload, err := json.Marshal(termiiRequest{
		To:      to,
		From:    c.senderID,
		SMS:     body,
		Type:    "plain",
		Channel: "generic",
		APIKey:  c.apiKey,
	})
	if err != nil {
		return fmt.Errorf("termii: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, termiiSendURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("termii: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("termii: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("termii: provider returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// SendOTP implements otp.EmailSender for SMS: `to` is the phone number.
func (c *TermiiClient) SendOTP(ctx context.Context, to, _name, code string, ttl time.Duration) error {
	return c.SendSMS(ctx, to, fmt.Sprintf("Your Paymax verification code is %s. It expires in %d minutes.", code, int(ttl.Minutes())))
}
