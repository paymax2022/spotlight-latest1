package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

// resendNotifier delivers suspicious-login alerts via Resend, fire-and-forget.
// Matches the project's email policy (CLAUDE.md): no queue, failures are silent.
// PII discipline: the email body contains the event TYPE and coarse signals
// only — never tokens, passwords, or full device fingerprints.
type resendNotifier struct {
	cfg      config.Config
	supabase *integrations.SupabaseRestClient
	http     *http.Client
}

// NewResendNotifier returns a SecurityNotifier. When the Resend key is empty the
// notifier is a no-op (still satisfies the interface) so the rest of the flow
// continues to function in environments without email configured.
func NewResendNotifier(cfg config.Config, supabase *integrations.SupabaseRestClient) SecurityNotifier {
	return &resendNotifier{cfg: cfg, supabase: supabase, http: &http.Client{Timeout: 5 * time.Second}}
}

func (n *resendNotifier) NotifySuspiciousLogin(userID, email, eventType string, signals map[string]any) {
	// Fire-and-forget: never block login on notification delivery.
	go n.deliver(userID, email, eventType)
}

func (n *resendNotifier) deliver(userID, email, eventType string) {
	defer func() { _ = recover() }() // never let a notification panic crash the request goroutine

	to := strings.TrimSpace(email)
	if to == "" && n.supabase != nil && n.supabase.Enabled() && strings.TrimSpace(userID) != "" {
		to = n.lookupEmail(userID)
	}
	if to == "" || strings.TrimSpace(n.cfg.ResendAPIKey) == "" {
		return // nothing we can do; stay silent
	}

	subject := "Security alert on your Paymax account"
	body := fmt.Sprintf(
		"We detected a security event (%s) on your account. If this was you, no action is needed. "+
			"If you do not recognise this activity, reset your password and review your active sessions immediately.",
		humanizeEvent(eventType),
	)
	payload := map[string]any{
		"from":    n.cfg.ResendFromEmail,
		"to":      []string{to},
		"subject": subject,
		"text":    body,
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+n.cfg.ResendAPIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.http.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

func (n *resendNotifier) lookupEmail(userID string) string {
	var rows []struct {
		Email string `json:"email"`
	}
	if err := n.supabase.REST(http.MethodGet, "platform_users", map[string]string{"select": "email", "id": "eq." + userID, "limit": "1"}, nil, &rows); err != nil || len(rows) == 0 {
		return ""
	}
	return rows[0].Email
}

func humanizeEvent(eventType string) string {
	switch eventType {
	case EventNewDevice:
		return "sign-in from a new device"
	case EventNewIP:
		return "sign-in from a new location"
	case EventImpossibleTravel:
		return "sign-in from an unexpected location"
	case EventFailedSpike:
		return "multiple failed sign-in attempts"
	case EventTokenReuse:
		return "a session security violation"
	case EventForcedReset:
		return "a required password reset"
	default:
		return "unusual account activity"
	}
}
