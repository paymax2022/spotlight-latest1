package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/hibiken/asynq"
	"spotlight/backend/internal/platform/queue"
)

// ProviderConfig holds credentials for delivery providers.
type ProviderConfig struct {
	ResendAPIKey    string
	ResendFromEmail string
	TermiiAPIKey    string
	TermiiSenderID  string
	ExpoPushToken   string // optional Expo access token for priority delivery
}

// Workers registers all notification task handlers on an asynq ServeMux.
func Workers(mux *asynq.ServeMux, cfg ProviderConfig) {
	h := &workerHandler{cfg: cfg, http: &http.Client{}}
	mux.HandleFunc(queue.TypeNotificationPush, h.handlePush)
	mux.HandleFunc(queue.TypeNotificationEmail, h.handleEmail)
	mux.HandleFunc(queue.TypeNotificationSMS, h.handleSMS)
}

type workerHandler struct {
	cfg  ProviderConfig
	http *http.Client
}

// ── Push (Expo) ───────────────────────────────────────────────────────────────

type expoPushMessage struct {
	To       string         `json:"to"`
	Title    string         `json:"title"`
	Body     string         `json:"body"`
	Data     map[string]any `json:"data,omitempty"`
	Sound    string         `json:"sound"`
	Priority string         `json:"priority"`
}

func (w *workerHandler) handlePush(ctx context.Context, t *asynq.Task) error {
	var n Notification
	if err := queue.DecodePayload(t, &n); err != nil {
		return fmt.Errorf("push worker: decode: %w", err)
	}

	pushToken := n.PushToken
	if pushToken == "" {
		log.Printf("[push] user=%s event=%s: no push token, skipping", n.UserID, n.Event)
		return nil
	}

	if w.cfg.ExpoPushToken == "" && w.cfg.ResendAPIKey == "" {
		log.Printf("[push] user=%s event=%s: no provider configured", n.UserID, n.Event)
		return nil
	}

	msg := expoPushMessage{
		To:       pushToken,
		Title:    n.Title,
		Body:     n.Body,
		Data:     n.Data,
		Sound:    "default",
		Priority: "high",
	}
	body, err := json.Marshal([]expoPushMessage{msg})
	if err != nil {
		return fmt.Errorf("push worker: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://exp.host/--/api/v2/push/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("push worker: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if w.cfg.ExpoPushToken != "" {
		req.Header.Set("Authorization", "Bearer "+w.cfg.ExpoPushToken)
	}

	resp, err := w.http.Do(req)
	if err != nil {
		return fmt.Errorf("push worker: http: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("push worker: expo returned %d: %s", resp.StatusCode, string(b))
	}

	log.Printf("[push] user=%s event=%s sent OK", n.UserID, n.Event)
	return nil
}

// ── Email (Resend) ────────────────────────────────────────────────────────────

type resendEmailRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Text    string   `json:"text"`
}

func (w *workerHandler) handleEmail(ctx context.Context, t *asynq.Task) error {
	var n Notification
	if err := queue.DecodePayload(t, &n); err != nil {
		return fmt.Errorf("email worker: decode: %w", err)
	}

	if w.cfg.ResendAPIKey == "" {
		log.Printf("[email] user=%s event=%s: RESEND_API_KEY not configured, skipping", n.UserID, n.Event)
		return nil
	}
	if n.Email == "" {
		log.Printf("[email] user=%s event=%s: no email address, skipping", n.UserID, n.Event)
		return nil
	}

	payload := resendEmailRequest{
		From:    w.cfg.ResendFromEmail,
		To:      []string{n.Email},
		Subject: n.Title,
		Text:    n.Body,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("email worker: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("email worker: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+w.cfg.ResendAPIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.http.Do(req)
	if err != nil {
		return fmt.Errorf("email worker: http: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("email worker: resend returned %d: %s", resp.StatusCode, string(b))
	}

	log.Printf("[email] user=%s event=%s sent OK to %s", n.UserID, n.Event, n.Email)
	return nil
}

// ── SMS (Termii) ──────────────────────────────────────────────────────────────

type termiiSMSRequest struct {
	To      string `json:"to"`
	From    string `json:"from"`
	SMS     string `json:"sms"`
	Type    string `json:"type"`
	Channel string `json:"channel"`
	APIKey  string `json:"api_key"`
}

func (w *workerHandler) handleSMS(ctx context.Context, t *asynq.Task) error {
	var n Notification
	if err := queue.DecodePayload(t, &n); err != nil {
		return fmt.Errorf("sms worker: decode: %w", err)
	}

	if w.cfg.TermiiAPIKey == "" {
		log.Printf("[sms] user=%s event=%s: TERMII_API_KEY not configured, skipping", n.UserID, n.Event)
		return nil
	}
	if n.Phone == "" {
		log.Printf("[sms] user=%s event=%s: no phone number, skipping", n.UserID, n.Event)
		return nil
	}

	payload := termiiSMSRequest{
		To:      n.Phone,
		From:    w.cfg.TermiiSenderID,
		SMS:     n.Body,
		Type:    "plain",
		Channel: "generic",
		APIKey:  w.cfg.TermiiAPIKey,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("sms worker: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://v3.api.ng.termii.com/api/sms/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("sms worker: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.http.Do(req)
	if err != nil {
		return fmt.Errorf("sms worker: http: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("sms worker: termii returned %d: %s", resp.StatusCode, string(b))
	}

	log.Printf("[sms] user=%s event=%s sent OK to %s", n.UserID, n.Event, n.Phone)
	return nil
}
