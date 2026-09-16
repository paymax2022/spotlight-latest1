package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/otp"
)

// ── doubles ─────────────────────────────────────────────────────────────────

type memStore struct {
	mu   sync.Mutex
	rows map[string]otp.Record
}

func newMemStore() *memStore { return &memStore{rows: map[string]otp.Record{}} }

func (m *memStore) Put(_ context.Context, k string, r otp.Record, _ time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.Attempts = 0
	m.rows[k] = r
	return nil
}

func (m *memStore) Get(_ context.Context, k string) (otp.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[k]
	if !ok {
		return otp.Record{}, otp.ErrNotFound
	}
	return r, nil
}

func (m *memStore) Consume(_ context.Context, k, hash string, max int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[k]
	if !ok || !otp.Equal(r.Hash, hash) || !time.Now().UTC().Before(r.ExpiresAt) || r.Attempts >= max {
		return false, nil
	}
	delete(m.rows, k)
	return true, nil
}

func (m *memStore) IncrementAttempts(_ context.Context, k string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[k]
	if !ok {
		return 0, otp.ErrExpired
	}
	r.Attempts++
	m.rows[k] = r
	return r.Attempts, nil
}

func (m *memStore) Delete(_ context.Context, k string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rows, k)
	return nil
}

func (m *memStore) DeleteExpired(context.Context, int) (int64, error) { return 0, nil }

type memLimiter struct {
	mu     sync.Mutex
	counts map[string]int
	limit  int
}

func (l *memLimiter) Allow(_ context.Context, key string, limit int, _ time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.counts == nil {
		l.counts = map[string]int{}
	}
	l.counts[key]++
	if l.limit > 0 {
		limit = l.limit
	}
	return l.counts[key] <= limit, nil
}

type capturingSender struct {
	mu   sync.Mutex
	sent []string // codes
	err  error
}

func (s *capturingSender) SendOTP(_ context.Context, _, _, code string, _ time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, code)
	return nil
}

func (s *capturingSender) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sent)
}

func (s *capturingSender) lastCode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sent) == 0 {
		return ""
	}
	return s.sent[len(s.sent)-1]
}

// ── harness ─────────────────────────────────────────────────────────────────

func newOTPRouter(t *testing.T, sender otp.EmailSender, lim otp.Limiter) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	svc, err := otp.NewService(newMemStore(), sender, lim, otp.Config{
		Length:      6,
		TTL:         10 * time.Minute,
		MaxAttempts: 5,
		Pepper:      []byte("handler-test-pepper"),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	h := NewOTPHandler(svc, "")
	r := gin.New()
	r.POST("/api/auth/otp/request", h.RequestOTP)
	r.POST("/api/auth/otp/verify", h.VerifyOTP)
	return r
}

func post(t *testing.T, r *gin.Engine, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── gating ──────────────────────────────────────────────────────────────────

// A disabled or misconfigured feature must 503 with the reason, never 404 and
// never a partial success. A 404 reads as "not in this build" and sends the
// operator hunting a deploy problem that is not there.
func TestDisabledHandlerReturns503WithReason(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewOTPHandler(nil, "misconfigured_missing_credentials")
	r := gin.New()
	r.POST("/api/auth/otp/request", h.RequestOTP)
	r.POST("/api/auth/otp/verify", h.VerifyOTP)

	for _, path := range []string{"/api/auth/otp/request", "/api/auth/otp/verify"} {
		w := post(t, r, path, map[string]string{"email": "a@b.com", "purpose": "password_reset", "code": "111111"})
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("%s status = %d, want 503", path, w.Code)
		}
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if body["error"] != "misconfigured_missing_credentials" {
			t.Errorf("%s error = %v, want the specific reason", path, body["error"])
		}
	}
}

// ── enumeration safety ──────────────────────────────────────────────────────

// The whole point of the endpoint's contract. The handler never looks a user up,
// so a registered and an unregistered address are indistinguishable — same
// status, same body. This test would fail the moment someone "helpfully" adds a
// 404 for unknown addresses.
func TestRequestOTPAnswersIdenticallyForAnyAddress(t *testing.T) {
	sender := &capturingSender{}
	r := newOTPRouter(t, sender, &memLimiter{})

	first := post(t, r, "/api/auth/otp/request",
		map[string]string{"email": "definitely-real@example.com", "purpose": "password_reset", "name": "Ada"})
	second := post(t, r, "/api/auth/otp/request",
		map[string]string{"email": "definitely-not-a-user@example.com", "purpose": "password_reset"})

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("statuses = %d and %d, want 200 and 200", first.Code, second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Errorf("bodies differ, so the endpoint is a user-enumeration oracle:\n  %s\n  %s",
			first.Body.String(), second.Body.String())
	}
}

// A delivery failure must not be reported either — "we could not send to that
// address" confirms the address is real and routable.
func TestRequestOTPHidesDeliveryFailure(t *testing.T) {
	ok := newOTPRouter(t, &capturingSender{}, &memLimiter{})
	broken := newOTPRouter(t, &capturingSender{err: errors.New("brevo down")}, &memLimiter{})

	good := post(t, ok, "/api/auth/otp/request", map[string]string{"email": "a@b.com", "purpose": "password_reset"})
	bad := post(t, broken, "/api/auth/otp/request", map[string]string{"email": "a@b.com", "purpose": "password_reset"})

	if good.Code != bad.Code {
		t.Errorf("statuses differ: %d vs %d — a send failure is observable", good.Code, bad.Code)
	}
	if good.Body.String() != bad.Body.String() {
		t.Errorf("bodies differ:\n  ok:     %s\n  broken: %s", good.Body.String(), bad.Body.String())
	}
}

// ── validation and status mapping ───────────────────────────────────────────

func TestRequestOTPRejectsBadInput(t *testing.T) {
	r := newOTPRouter(t, &capturingSender{}, &memLimiter{})
	cases := []struct {
		name string
		body map[string]string
	}{
		{"no address", map[string]string{"purpose": "password_reset"}},
		{"malformed address", map[string]string{"email": "not-an-email", "purpose": "password_reset"}},
		{"no domain dot", map[string]string{"email": "a@b", "purpose": "password_reset"}},
		{"unknown purpose", map[string]string{"email": "a@b.com", "purpose": "admin_override"}},
		// login is a real purpose and is still refused here — see
		// TestRequestOTPRefusesToSelfIssueLoginCodes for why.
		{"login is not self-issuable", map[string]string{"email": "a@b.com", "purpose": "login"}},
		{"missing purpose", map[string]string{"email": "a@b.com"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := post(t, r, "/api/auth/otp/request", tc.body)
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", w.Code)
			}
		})
	}
}

func TestFullRoundTripThroughTheHandlers(t *testing.T) {
	sender := &capturingSender{}
	r := newOTPRouter(t, sender, &memLimiter{})

	w := post(t, r, "/api/auth/otp/request",
		map[string]string{"email": "Ada@Example.com", "purpose": "password_reset", "name": "Ada"})
	if w.Code != http.StatusOK {
		t.Fatalf("request status = %d: %s", w.Code, w.Body.String())
	}
	var issued map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &issued)
	if issued["expiresInSeconds"] != float64(600) {
		t.Errorf("expiresInSeconds = %v, want 600", issued["expiresInSeconds"])
	}

	code := sender.lastCode()
	if len(code) != 6 {
		t.Fatalf("no code was sent")
	}
	// The response must never carry the code, however convenient that would be
	// for testing — it would hand every code to anyone who can call the endpoint.
	if strings.Contains(w.Body.String(), code) {
		t.Fatal("the code was returned in the HTTP response")
	}

	v := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "password_reset", "code": code})
	if v.Code != http.StatusOK {
		t.Fatalf("verify status = %d: %s", v.Code, v.Body.String())
	}

	replay := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "password_reset", "code": code})
	if replay.Code != http.StatusBadRequest {
		t.Errorf("replay status = %d, want 400 — the code is reusable", replay.Code)
	}
}

// Pins the exact status sequence a client will see, including what happens
// AFTER lockout — which is not obvious.
//
// Lockout destroys the record, so the attempt that trips the ceiling returns 429
// and every attempt after it returns 400 "invalid code", the same answer an
// address that was never issued a code gets. That is deliberate: keeping a
// lockout marker around would keep answering "too many attempts" for a specific
// address, and the user's next step is identical either way — request a new
// code. Destroying the credential matters more than the wording.
func TestVerifyStatusMapping(t *testing.T) {
	sender := &capturingSender{}
	r := newOTPRouter(t, sender, &memLimiter{})
	_ = post(t, r, "/api/auth/otp/request", map[string]string{"email": "a@b.com", "purpose": "password_reset"})

	wrong := map[string]string{"email": "a@b.com", "purpose": "password_reset", "code": "000000"}

	// MaxAttempts is 5: four wrong guesses are merely wrong.
	for i := 1; i <= 4; i++ {
		if w := post(t, r, "/api/auth/otp/verify", wrong); w.Code != http.StatusBadRequest {
			t.Fatalf("attempt %d status = %d, want 400", i, w.Code)
		}
	}
	// The fifth trips the ceiling.
	if w := post(t, r, "/api/auth/otp/verify", wrong); w.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt 5 status = %d, want 429", w.Code)
	}
	// And the credential is gone — the CORRECT code no longer works either.
	correct := map[string]string{"email": "a@b.com", "purpose": "password_reset", "code": sender.lastCode()}
	if w := post(t, r, "/api/auth/otp/verify", correct); w.Code != http.StatusBadRequest {
		t.Errorf("the correct code after lockout returned %d — lockout must destroy the code, not pause guessing at it", w.Code)
	}
}

// A login code must not complete a password reset, and the refusal must look
// exactly like a wrong code.
// THE control the whole step-up design rests on. Redeeming a login code mints a
// session, so a self-issuable login code would be passwordless login wearing a
// second factor's clothes: anyone who can read a mailbox would need no password.
// Login codes are issued only by POST /api/auth/login, after the password.
func TestRequestOTPRefusesToSelfIssueLoginCodes(t *testing.T) {
	sender := &capturingSender{}
	r := newOTPRouter(t, sender, &memLimiter{})

	w := post(t, r, "/api/auth/otp/request", map[string]string{"email": "a@b.com", "purpose": "login"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 — anyone could mint themselves a session-bearing code", w.Code)
	}
	if n := sender.count(); n != 0 {
		t.Errorf("%d login code(s) were sent to a self-service caller", n)
	}
}

func TestVerifyRejectsAMismatchedPurpose(t *testing.T) {
	sender := &capturingSender{}
	r := newOTPRouter(t, sender, &memLimiter{})
	_ = post(t, r, "/api/auth/otp/request", map[string]string{"email": "a@b.com", "purpose": "password_reset"})

	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "a@b.com", "purpose": "verify_email", "code": sender.lastCode()})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 — a password-reset code completed an email verification", w.Code)
	}
	// Still usable for what it WAS issued for: the rejection must not consume it.
	if v := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "a@b.com", "purpose": "password_reset", "code": sender.lastCode()}); v.Code != http.StatusOK {
		t.Errorf("the code stopped working for its own purpose after a cross-purpose attempt (status %d)", v.Code)
	}
}

func TestRequestOTPRateLimitedReturns429(t *testing.T) {
	r := newOTPRouter(t, &capturingSender{}, &memLimiter{limit: 1})
	_ = post(t, r, "/api/auth/otp/request", map[string]string{"email": "a@b.com", "purpose": "password_reset"})
	w := post(t, r, "/api/auth/otp/request", map[string]string{"email": "c@d.com", "purpose": "password_reset"})
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429", w.Code)
	}
}
