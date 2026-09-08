// Package email holds outbound transactional email transports.
//
// Brevo joins Resend here rather than replacing it. Resend is the fire-and-forget
// path for notifications (see services/security_notifier.go), where a silent
// failure is acceptable. OTP delivery is not that: an OTP that is not delivered
// is a failed login, so this transport reports its outcome, classifies it, and
// lets the caller decide.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultBrevoEndpoint is Brevo's transactional send endpoint. It is a variable
// on the client rather than a package constant so tests can point at an
// httptest.Server without a global mutation that races other tests.
const DefaultBrevoEndpoint = "https://api.brevo.com/v3/smtp/email"

// BrevoClient sends transactional email through a Brevo stored template.
//
// A template ID rather than inline HTML: the copy of an OTP email is changed by
// people who do not deploy Go, and a template keeps that out of this repo.
type BrevoClient struct {
	endpoint    string
	apiKey      string
	senderName  string
	senderEmail string
	templateID  int64
	http        *http.Client
}

// NewBrevoClient builds a client. It does not validate credentials — that is the
// caller's job at wiring time, where a misconfiguration can be refused loudly
// instead of surfacing as a failed login hours later.
func NewBrevoClient(apiKey, senderName, senderEmail string, templateID int64, timeout time.Duration) *BrevoClient {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &BrevoClient{
		endpoint:    DefaultBrevoEndpoint,
		apiKey:      apiKey,
		senderName:  senderName,
		senderEmail: senderEmail,
		templateID:  templateID,
		http: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				MaxIdleConns:        50,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// WithEndpoint overrides the send endpoint. Tests only.
func (c *BrevoClient) WithEndpoint(url string) *BrevoClient { c.endpoint = url; return c }

type brevoAddress struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email"`
}

type brevoRequest struct {
	Sender     brevoAddress      `json:"sender"`
	To         []brevoAddress    `json:"to"`
	TemplateID int64             `json:"templateId"`
	Params     map[string]string `json:"params"`
	Tags       []string          `json:"tags,omitempty"`
}

type brevoErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// SendOTP delivers a code to one address. It satisfies otp.EmailSender.
//
// The code is passed to Brevo as a template parameter and is never written to a
// log line, an error string or a span here — an error returned from this method
// is safe to log verbatim.
func (c *BrevoClient) SendOTP(ctx context.Context, to, name, code string, ttl time.Duration) error {
	minutes := int(ttl.Minutes())
	if minutes < 1 {
		minutes = 1
	}
	payload := brevoRequest{
		Sender:     brevoAddress{Name: c.senderName, Email: c.senderEmail},
		To:         []brevoAddress{{Email: to, Name: name}},
		TemplateID: c.templateID,
		Params: map[string]string{
			"OTP":            code,
			"NAME":           name,
			"EXPIRY_MINUTES": strconv.Itoa(minutes),
		},
		Tags: []string{"otp"},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		// A marshal failure is a programming error, not a delivery condition.
		return fmt.Errorf("brevo: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("brevo: build request: %w", err)
	}
	req.Header.Set("api-key", c.apiKey)
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// Transport failures (DNS, dial, TLS, client timeout) are transient by
		// nature. The underlying error is wrapped for the log but classified so
		// callers can retry.
		//
		// A context that the CALLER cancelled is not a delivery failure and must
		// not be retried — surface it as itself.
		if ctxErr := ctx.Err(); ctxErr != nil {
			return fmt.Errorf("brevo: %v: %w", err, ctxErr)
		}
		return fmt.Errorf("brevo: transport: %v: %w", err, ErrTransient)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK {
		// Drain so the connection returns to the idle pool instead of being closed.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return nil
	}

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	var apiErr brevoErrorResponse
	_ = json.Unmarshal(raw, &apiErr)
	msg := strings.TrimSpace(apiErr.Message)
	if msg == "" {
		msg = "no message"
	}

	switch {
	case resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode >= 500:
		return fmt.Errorf("brevo: status %d: %s: %w", resp.StatusCode, msg, ErrTransient)
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		// Deliberately not transient. A revoked or wrong key fails every retry,
		// and this is the condition worth paging on.
		return fmt.Errorf("brevo: auth rejected (%s): %w", msg, ErrPermanent)
	default:
		return fmt.Errorf("brevo: status %d: %s: %w", resp.StatusCode, msg, ErrPermanent)
	}
}
