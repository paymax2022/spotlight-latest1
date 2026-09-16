package otp

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// ── test doubles ────────────────────────────────────────────────────────────

// memStore mirrors the semantics PostgresStore guarantees, including the atomic
// Consume. Behaviour that depends on SQL (real concurrency, expiry evaluated by
// the database clock) is covered by the live-DB suite in tests/otp.
type memStore struct {
	mu   sync.Mutex
	rows map[string]Record
	now  func() time.Time
}

func newMemStore() *memStore {
	return &memStore{rows: map[string]Record{}, now: func() time.Time { return time.Now().UTC() }}
}

func (m *memStore) Put(_ context.Context, k string, r Record, _ time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.Attempts = 0
	m.rows[k] = r
	return nil
}

func (m *memStore) Get(_ context.Context, k string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[k]
	if !ok {
		return Record{}, ErrNotFound
	}
	return r, nil
}

func (m *memStore) Consume(_ context.Context, k, codeHash string, maxAttempts int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[k]
	if !ok || !Equal(r.Hash, codeHash) || !m.now().Before(r.ExpiresAt) || r.Attempts >= maxAttempts {
		return false, nil
	}
	delete(m.rows, k)
	return true, nil
}

func (m *memStore) IncrementAttempts(_ context.Context, k string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[k]
	if !ok || !m.now().Before(r.ExpiresAt) {
		return 0, ErrExpired
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

func (m *memStore) len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rows)
}

type memLimiter struct {
	mu     sync.Mutex
	counts map[string]int
	err    error
}

func newMemLimiter() *memLimiter { return &memLimiter{counts: map[string]int{}} }

func (l *memLimiter) Allow(_ context.Context, key string, limit int, _ time.Duration) (bool, error) {
	if l.err != nil {
		return false, l.err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.counts[key]++
	return l.counts[key] <= limit, nil
}

type SentEmail struct{ To, Name, Code string }

type fakeSender struct {
	mu   sync.Mutex
	Sent []SentEmail
	Err  error
}

func (f *fakeSender) SendOTP(_ context.Context, to, name, code string, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	f.Sent = append(f.Sent, SentEmail{to, name, code})
	return nil
}

func (f *fakeSender) last() SentEmail {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.Sent) == 0 {
		return SentEmail{}
	}
	return f.Sent[len(f.Sent)-1]
}

func (f *fakeSender) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Sent)
}

func newTestService(t *testing.T, mutate func(*Config)) (*Service, *memStore, *fakeSender, *memLimiter) {
	t.Helper()
	store, sender, limiter := newMemStore(), &fakeSender{}, newMemLimiter()
	cfg := Config{
		Length:          6,
		TTL:             10 * time.Minute,
		MaxAttempts:     5,
		ResendCooldown:  60 * time.Second,
		MaxSendsPerHour: 5,
		MaxSendsPerIP:   20,
		MaxVerifyPerIP:  20,
		Pepper:          []byte("test-pepper-do-not-use-in-production"),
	}
	if mutate != nil {
		mutate(&cfg)
	}
	svc, err := NewService(store, sender, limiter, cfg)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, store, sender, limiter
}

// ── construction ────────────────────────────────────────────────────────────

// A service that boots without a pepper stores digests a rainbow table reverses,
// and reports healthy while doing it. Refusing to construct is the whole defence.
func TestNewServiceRefusesWithoutPepper(t *testing.T) {
	_, err := NewService(newMemStore(), &fakeSender{}, newMemLimiter(), Config{Length: 6})
	if !errors.Is(err, ErrNoPepper) {
		t.Fatalf("error = %v, want ErrNoPepper", err)
	}
}

func TestNewServiceRejectsAbsurdLength(t *testing.T) {
	_, err := NewService(newMemStore(), &fakeSender{}, newMemLimiter(),
		Config{Length: 32, Pepper: []byte("p")})
	if !errors.Is(err, ErrInvalidLength) {
		t.Fatalf("error = %v, want ErrInvalidLength", err)
	}
}

// ── the happy path and single use ───────────────────────────────────────────

func TestIssueThenVerifySucceedsAndConsumes(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, nil)

	if err := svc.Issue(ctx, "User@Example.com", "Ada", PurposeLogin, "1.2.3.4"); err != nil {
		t.Fatalf("issue: %v", err)
	}
	sent := sender.last()
	if sent.To != "user@example.com" {
		t.Errorf("sent to %q, want the normalized address", sent.To)
	}
	if len(sent.Code) != 6 {
		t.Fatalf("code %q is not 6 digits", sent.Code)
	}

	// The address is verified in its original casing: normalization has to agree
	// on both sides or a code can be issued that can never be redeemed.
	if err := svc.Verify(ctx, "USER@example.com ", PurposeLogin, sent.Code, "1.2.3.4"); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if store.len() != 0 {
		t.Error("record survived a successful verification — the code is replayable")
	}
}

func TestVerifyTwiceFailsTheSecondTime(t *testing.T) {
	ctx := context.Background()
	svc, _, sender, _ := newTestService(t, nil)
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	code := sender.last().Code
	if err := svc.Verify(ctx, "a@b.com", PurposeLogin, code, ""); err != nil {
		t.Fatalf("first verify: %v", err)
	}
	if err := svc.Verify(ctx, "a@b.com", PurposeLogin, code, ""); !errors.Is(err, ErrInvalidCode) {
		t.Errorf("second verify error = %v, want ErrInvalidCode — an OTP that replays is not one-time", err)
	}
}

// The plaintext code must not be recoverable from what is persisted.
func TestStoredRecordDoesNotContainThePlaintextCode(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, nil)
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	code := sender.last().Code
	store.mu.Lock()
	defer store.mu.Unlock()
	for k, r := range store.rows {
		if r.Hash == code {
			t.Fatal("the code was stored in plaintext")
		}
		// The address must not be in the key either — otp_codes would become a
		// list of every address that ever asked for a code.
		if k == PurposeLogin+":a@b.com" {
			t.Fatalf("the raw address is embedded in the storage key: %q", k)
		}
	}
}

// ── failure paths ───────────────────────────────────────────────────────────

func TestVerifyWrongCodeCountsAnAttempt(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, nil)
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	wrong := wrongCode(sender.last().Code)
	if err := svc.Verify(ctx, "a@b.com", PurposeLogin, wrong, ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("error = %v, want ErrInvalidCode", err)
	}
	rec, err := store.Get(ctx, svc.key(PurposeLogin, "a@b.com"))
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if rec.Attempts != 1 {
		t.Errorf("attempts = %d, want 1 — an uncounted wrong guess makes the ceiling meaningless", rec.Attempts)
	}
}

func TestVerifyLocksOutAtMaxAttemptsAndDestroysTheCode(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, func(c *Config) { c.MaxAttempts = 3 })
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	correct := sender.last().Code
	wrong := wrongCode(correct)

	for i := 1; i <= 2; i++ {
		if err := svc.Verify(ctx, "a@b.com", PurposeLogin, wrong, ""); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("attempt %d error = %v, want ErrInvalidCode", i, err)
		}
	}
	if err := svc.Verify(ctx, "a@b.com", PurposeLogin, wrong, ""); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("third attempt error = %v, want ErrTooManyAttempts", err)
	}
	if store.len() != 0 {
		t.Error("code survived lockout — the attacker gets a fresh budget by waiting")
	}
	// And the CORRECT code is gone too: lockout must destroy the credential, not
	// merely pause guessing at it.
	if err := svc.Verify(ctx, "a@b.com", PurposeLogin, correct, ""); !errors.Is(err, ErrInvalidCode) {
		t.Errorf("correct code after lockout error = %v, want ErrInvalidCode", err)
	}
}

func TestVerifyAfterTTLIsExpired(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, func(c *Config) { c.TTL = time.Second })
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	code := sender.last().Code

	// Age the record rather than sleeping.
	k := svc.key(PurposeLogin, "a@b.com")
	rec, _ := store.Get(ctx, k)
	rec.ExpiresAt = time.Now().UTC().Add(-time.Second)
	store.rows[k] = rec

	if err := svc.Verify(ctx, "a@b.com", PurposeLogin, code, ""); !errors.Is(err, ErrExpired) {
		t.Fatalf("error = %v, want ErrExpired", err)
	}
	if store.len() != 0 {
		t.Error("expired record was not cleaned up on read")
	}
}

// A login code must not complete a password reset.
func TestVerifyWithADifferentPurposeFails(t *testing.T) {
	ctx := context.Background()
	svc, _, sender, _ := newTestService(t, nil)
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	code := sender.last().Code
	err := svc.Verify(ctx, "a@b.com", PurposePasswordReset, code, "")
	if !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("error = %v, want ErrInvalidCode — scope escalation across purposes", err)
	}
}

// An address that was never issued a code must answer exactly like a wrong code.
// Any other answer is a user-enumeration oracle.
func TestVerifyUnknownAddressLooksLikeAWrongCode(t *testing.T) {
	svc, _, _, _ := newTestService(t, nil)
	err := svc.Verify(context.Background(), "nobody@nowhere.com", PurposeLogin, "123456", "")
	if !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("error = %v, want ErrInvalidCode", err)
	}
}

// ── rate limiting ───────────────────────────────────────────────────────────

func TestIssueInsideCooldownIsRateLimited(t *testing.T) {
	ctx := context.Background()
	svc, _, sender, _ := newTestService(t, nil)
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("error = %v, want ErrRateLimited", err)
	}
	if sender.count() != 1 {
		t.Errorf("sent %d emails, want 1", sender.count())
	}
}

func TestIssueBeyondHourlyBudgetIsRateLimited(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, func(c *Config) {
		c.MaxSendsPerHour = 3
		c.ResendCooldown = 0 // isolate the hourly budget from the cooldown
	})
	for i := 0; i < 3; i++ {
		// Clear the live code so only the hourly budget can stop us.
		_ = store.Delete(ctx, svc.key(PurposeLogin, "a@b.com"))
		if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
			t.Fatalf("issue %d: %v", i+1, err)
		}
	}
	_ = store.Delete(ctx, svc.key(PurposeLogin, "a@b.com"))
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("fourth send error = %v, want ErrRateLimited", err)
	}
	if sender.count() != 3 {
		t.Errorf("sent %d emails, want 3", sender.count())
	}
}

// One address's budget must not throttle another's.
func TestSendBudgetIsPerAddress(t *testing.T) {
	ctx := context.Background()
	svc, _, sender, _ := newTestService(t, func(c *Config) { c.MaxSendsPerHour = 1 })
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("issue a: %v", err)
	}
	if err := svc.Issue(ctx, "c@d.com", "C", PurposeLogin, ""); err != nil {
		t.Fatalf("issue c: %v — one address's budget leaked onto another", err)
	}
	if sender.count() != 2 {
		t.Errorf("sent %d, want 2", sender.count())
	}
}

// The address budget alone does not stop one client sweeping many addresses,
// which this endpoint invites by never checking whether an account exists.
func TestIssueIsAlsoLimitedPerIP(t *testing.T) {
	ctx := context.Background()
	svc, _, sender, _ := newTestService(t, func(c *Config) { c.MaxSendsPerIP = 2 })
	for i, addr := range []string{"a@x.com", "b@x.com"} {
		if err := svc.Issue(ctx, addr, "N", PurposeLogin, "9.9.9.9"); err != nil {
			t.Fatalf("issue %d: %v", i, err)
		}
	}
	if err := svc.Issue(ctx, "c@x.com", "N", PurposeLogin, "9.9.9.9"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("third address from one IP error = %v, want ErrRateLimited", err)
	}
	if sender.count() != 2 {
		t.Errorf("sent %d, want 2", sender.count())
	}
}

func TestVerifyIsLimitedPerIP(t *testing.T) {
	ctx := context.Background()
	svc, _, _, _ := newTestService(t, func(c *Config) { c.MaxVerifyPerIP = 2 })
	for i := 0; i < 2; i++ {
		if err := svc.Verify(ctx, "a@b.com", PurposeLogin, "000000", "8.8.8.8"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("attempt %d error = %v", i, err)
		}
	}
	if err := svc.Verify(ctx, "z@z.com", PurposeLogin, "000000", "8.8.8.8"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("third verify from one IP error = %v, want ErrRateLimited", err)
	}
}

// A limiter that cannot reach its store must refuse, not wave callers through.
func TestLimiterFailureBlocksIssue(t *testing.T) {
	svc, _, sender, limiter := newTestService(t, nil)
	limiter.err = errors.New("database is down")
	err := svc.Issue(context.Background(), "a@b.com", "A", PurposeLogin, "")
	if err == nil {
		t.Fatal("issue succeeded with a broken limiter — the budget is unbounded while the system reports it is protected")
	}
	if sender.count() != 0 {
		t.Error("an email was sent despite the limiter failing")
	}
}

// ── delivery failure ────────────────────────────────────────────────────────

// If the mail never left, the user must not be locked out by their own cooldown
// waiting for it.
func TestSendFailureRemovesTheCodeSoTheUserCanRetry(t *testing.T) {
	ctx := context.Background()
	svc, store, sender, _ := newTestService(t, nil)
	sender.Err = errors.New("brevo exploded")

	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err == nil {
		t.Fatal("issue reported success despite a send failure")
	}
	if store.len() != 0 {
		t.Error("an undeliverable code was left behind — the user is now inside a cooldown for a message they never got")
	}

	// And a retry works immediately.
	sender.Err = nil
	if err := svc.Issue(ctx, "a@b.com", "A", PurposeLogin, ""); err != nil {
		t.Fatalf("retry after a failed send: %v", err)
	}
}

func TestUnknownPurposeIsRejectedBeforeAnythingIsSpent(t *testing.T) {
	svc, store, sender, _ := newTestService(t, nil)
	if err := svc.Issue(context.Background(), "a@b.com", "A", "admin_override", ""); !errors.Is(err, ErrUnknownPurpose) {
		t.Fatalf("error = %v, want ErrUnknownPurpose", err)
	}
	if sender.count() != 0 || store.len() != 0 {
		t.Error("an unknown purpose consumed a send or a store row")
	}
}

// wrongCode returns a code of the same shape that is guaranteed to differ.
func wrongCode(correct string) string {
	b := []byte(correct)
	if b[0] == '0' {
		b[0] = '1'
	} else {
		b[0] = '0'
	}
	return string(b)
}
