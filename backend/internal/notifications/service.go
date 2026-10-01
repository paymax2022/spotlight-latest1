package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/hibiken/asynq"
	"io"
	"log"
	"net/http"
	"spotlight/backend/internal/platform/queue"
	"time"
)

// Channel represents a notification delivery channel.
type Channel string

const (
	ChannelPush  Channel = "push"
	ChannelEmail Channel = "email"
	ChannelSMS   Channel = "sms"
	ChannelInApp Channel = "in_app"
)

// Event is the domain event that triggered the notification.
type Event string

const (
	EventWalletCredit      Event = "wallet.credit"
	EventWalletDebit       Event = "wallet.debit"
	EventTransferSuccess   Event = "transfer.success"
	EventTransferFailed    Event = "transfer.failed"
	EventKYCApproved       Event = "kyc.approved"
	EventKYCFailed         Event = "kyc.failed"
	EventReferralReward    Event = "referral.reward"
	EventVAProvisioned     Event = "va.provisioned"
	EventFXConverted       Event = "fx.converted"
	EventOrderStatusUpdate Event = "order.status_update"
	EventDisputeOpened     Event = "dispute.opened"
	EventDisputeResolved   Event = "dispute.resolved"
)

// Notification is the payload enqueued for delivery.
type Notification struct {
	UserID   string         `json:"user_id"`
	Event    Event          `json:"event"`
	Title    string         `json:"title"`
	Body     string         `json:"body"`
	Data     map[string]any `json:"data,omitempty"`
	Channels []Channel      `json:"channels"`
	// Delivery addresses — populated by callers when known.
	PushToken string `json:"push_token,omitempty"` // Expo push token
	Email     string `json:"email,omitempty"`      // recipient email address
	Phone     string `json:"phone,omitempty"`      // E.164 phone for SMS
}

// Service enqueues notifications via asynq.
// Actual delivery workers (push, email, SMS) consume from the queue.
type Service struct {
	client *asynq.Client
}

func NewService(client *asynq.Client) *Service {
	return &Service{client: client}
}

// Send enqueues a notification for async delivery on the specified channels.
func (s *Service) Send(ctx context.Context, n Notification) error {
	if len(n.Channels) == 0 {
		n.Channels = []Channel{ChannelPush, ChannelInApp}
	}
	for _, ch := range n.Channels {
		taskType := taskTypeForChannel(ch)
		if taskType == "" {
			continue
		}
		task, err := queue.NewTask(taskType, n, asynq.MaxRetry(3))
		if err != nil {
			return fmt.Errorf("notifications: create task %s: %w", taskType, err)
		}
		if _, err := s.client.EnqueueContext(ctx, task); err != nil {
			return fmt.Errorf("notifications: enqueue %s: %w", taskType, err)
		}
	}
	return nil
}

// Predefined helpers for common events.

func (s *Service) WalletCredit(ctx context.Context, userID string, amountKobo int64, reference string) error {
	return s.Send(ctx, Notification{
		UserID: userID,
		Event:  EventWalletCredit,
		Title:  "Wallet Credited",
		Body:   fmt.Sprintf("Your wallet has been credited with ₦%.2f", float64(amountKobo)/100),
		Data:   map[string]any{"amount_kobo": amountKobo, "reference": reference},
	})
}

func (s *Service) WalletDebit(ctx context.Context, userID string, amountKobo int64, reference string) error {
	return s.Send(ctx, Notification{
		UserID: userID,
		Event:  EventWalletDebit,
		Title:  "Wallet Debited",
		Body:   fmt.Sprintf("₦%.2f has been debited from your wallet", float64(amountKobo)/100),
		Data:   map[string]any{"amount_kobo": amountKobo, "reference": reference},
	})
}

func (s *Service) KYCApproved(ctx context.Context, userID string, newTier int) error {
	return s.Send(ctx, Notification{
		UserID: userID,
		Event:  EventKYCApproved,
		Title:  "KYC Verified",
		Body:   fmt.Sprintf("Your identity has been verified. You are now on Tier %d.", newTier),
		Data:   map[string]any{"new_tier": newTier},
	})
}

func (s *Service) ReferralReward(ctx context.Context, referrerID string, amountKobo int64) error {
	return s.Send(ctx, Notification{
		UserID: referrerID,
		Event:  EventReferralReward,
		Title:  "Referral Reward",
		Body:   fmt.Sprintf("You earned ₦%.2f for referring a friend!", float64(amountKobo)/100),
		Data:   map[string]any{"amount_kobo": amountKobo},
	})
}

func taskTypeForChannel(ch Channel) string {
	switch ch {
	case ChannelPush:
		return queue.TypeNotificationPush
	case ChannelEmail:
		return queue.TypeNotificationEmail
	case ChannelSMS:
		return queue.TypeNotificationSMS
	default:
		return ""
	}
}

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
	// Bounded client: an unbounded one lets a stuck provider hold a worker slot
	// until asynq's own task timeout kills it.
	h := &workerHandler{cfg: cfg, http: &http.Client{Timeout: 15 * time.Second}}
	mux.HandleFunc(queue.TypeNotificationPush, h.handlePush)
	mux.HandleFunc(queue.TypeNotificationEmail, h.handleEmail)
	mux.HandleFunc(queue.TypeNotificationSMS, h.handleSMS)
}

type workerHandler struct {
	cfg  ProviderConfig
	http *http.Client
}

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
