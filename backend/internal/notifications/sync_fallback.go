package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// EmailResolver looks up the email address on file for a user id. It returns
// "" (and no error) when the user has none.
type EmailResolver func(ctx context.Context, userID string) (string, error)

// WithSyncEmailFallback configures the degraded-mode delivery path used when
// the asynq client is nil (REDIS_URL unset). resolve may be nil, in which case
// only Notification.Email is used. Without Resend credentials the fallback
// stays inert and Send keeps returning the client_unconfigured error.
func (s *Service) WithSyncEmailFallback(cfg ProviderConfig, resolve EmailResolver) *Service {
	s.fallbackCfg = cfg
	s.resolveEmail = resolve
	s.fallbackHTTP = &http.Client{Timeout: 10 * time.Second}
	return s
}

// sendSyncEmailFallback delivers n by email, synchronously, when no queue is
// wired. It returns handled=true when an email was actually sent.
//
// Why this exists (FOOD-UAT-G-012): with REDIS_URL unset there is no asynq
// client, so every Send used to be logged and dropped — customers never got
// preparing/ready alerts in dev or any Redis-less environment. Push needs the
// queue worker, but email can be sent inline, so when the recipient has an
// email on file we send it directly (bounded by a 10s HTTP timeout). When Redis
// is up this path is never taken and delivery stays async via the queue.
func (s *Service) sendSyncEmailFallback(ctx context.Context, n Notification) (handled bool, err error) {
	if s.fallbackCfg.ResendAPIKey == "" || s.fallbackHTTP == nil {
		return false, nil
	}
	to := n.Email
	if to == "" && s.resolveEmail != nil && n.UserID != "" {
		to, err = s.resolveEmail(ctx, n.UserID)
		if err != nil {
			return false, fmt.Errorf("notifications: resolve email: %w", err)
		}
	}
	if to == "" {
		return false, nil
	}
	body, err := json.Marshal(resendEmailRequest{
		From: s.fallbackCfg.ResendFromEmail, To: []string{to}, Subject: n.Title, Text: n.Body,
	})
	if err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.fallbackURL(), bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+s.fallbackCfg.ResendAPIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.fallbackHTTP.Do(req)
	if err != nil {
		return false, fmt.Errorf("notifications: sync email: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("notifications: sync email: resend returned %d: %s", resp.StatusCode, string(b))
	}
	log.Printf("[notifications] WARN queue unavailable; sent synchronous email fallback user=%s event=%s", n.UserID, n.Event)
	return true, nil
}

var errNoFallback = errors.New("notifications: asynq client not configured")

func (s *Service) fallbackURL() string {
	if s.fallbackEndpoint != "" {
		return s.fallbackEndpoint
	}
	return "https://api.resend.com/emails"
}
