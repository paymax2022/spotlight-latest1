package otp

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"
)

// EmailSender is declared here, in the consuming package, so otp stays testable
// without importing the email transport.
type EmailSender interface {
	SendOTP(ctx context.Context, to, name, code string, ttl time.Duration) error
}

// Purposes an OTP may be issued for. An allowlist rather than a free string:
// `purpose` becomes part of the storage key, so an unchecked value lets a caller
// mint unlimited independent send budgets for one address.
const (
	PurposeLogin         = "login"
	PurposeVerifyEmail   = "verify_email"
	PurposePasswordReset = "password_reset"
)

// IsAllowedPurpose reports whether p is one this service will issue for.
func IsAllowedPurpose(p string) bool {
	switch p {
	case PurposeLogin, PurposeVerifyEmail, PurposePasswordReset:
		return true
	default:
		return false
	}
}

// Config carries the tunables. Pepper is required; see NewService.
type Config struct {
	Length          int
	TTL             time.Duration
	MaxAttempts     int
	ResendCooldown  time.Duration
	MaxSendsPerHour int
	MaxSendsPerIP   int
	MaxVerifyPerIP  int
	Pepper          []byte
}

func (c Config) withDefaults() Config {
	if c.Length == 0 {
		c.Length = 6
	}
	if c.TTL == 0 {
		c.TTL = 10 * time.Minute
	}
	if c.MaxAttempts == 0 {
		c.MaxAttempts = 5
	}
	if c.ResendCooldown == 0 {
		c.ResendCooldown = 60 * time.Second
	}
	if c.MaxSendsPerHour == 0 {
		c.MaxSendsPerHour = 5
	}
	if c.MaxSendsPerIP == 0 {
		c.MaxSendsPerIP = 20
	}
	if c.MaxVerifyPerIP == 0 {
		c.MaxVerifyPerIP = 20
	}
	return c
}

// Service issues and verifies codes.
type Service struct {
	store   Store
	sender  EmailSender
	limiter Limiter
	cfg     Config
}

// NewService refuses to build without a pepper.
//
// The alternative — defaulting to an empty pepper — produces a service that
// boots, works, and stores digests that are a one-million-entry rainbow table
// away from plaintext. It would report healthy the entire time. Failing here
// means the misconfiguration is discovered at wiring, by the person who caused
// it, instead of during an incident.
func NewService(store Store, sender EmailSender, limiter Limiter, cfg Config) (*Service, error) {
	if len(cfg.Pepper) == 0 {
		return nil, ErrNoPepper
	}
	if store == nil || sender == nil || limiter == nil {
		return nil, fmt.Errorf("otp: store, sender and limiter are all required")
	}
	cfg = cfg.withDefaults()
	if cfg.Length < 4 || cfg.Length > 10 {
		return nil, ErrInvalidLength
	}
	return &Service{store: store, sender: sender, limiter: limiter, cfg: cfg}, nil
}

// TTL exposes the configured lifetime so a handler can tell the client how long
// it has without duplicating the constant.
func (s *Service) TTL() time.Duration { return s.cfg.TTL }

// key derives the storage key. The address is HASHED into it, not embedded:
// otp_codes would otherwise be a plaintext list of every address that ever
// requested a code — a user-enumeration oracle sitting in the database, which is
// exactly what the endpoint above it is careful not to be.
func (s *Service) key(purpose, email string) string {
	return purpose + ":" + Hash(normalizeEmail(email), s.cfg.Pepper)
}

func (s *Service) identKey(scope, purpose, email string) string {
	return "otp:" + scope + ":" + purpose + ":" + Hash(normalizeEmail(email), s.cfg.Pepper)
}

func (s *Service) ipKey(scope, ip string) string {
	return "otp:" + scope + ":ip:" + Hash(strings.TrimSpace(ip), s.cfg.Pepper)
}

// Issue generates a code, stores its hash, and sends it.
//
// Callers must invoke this whether or not the address belongs to a known user.
// Branching on existence turns the endpoint into a user-enumeration oracle, and
// doing the work only for real users leaks the same answer through response
// time. See handlers/otp_handler.go.
func (s *Service) Issue(ctx context.Context, email, name, purpose, ip string) error {
	if !IsAllowedPurpose(purpose) {
		return ErrUnknownPurpose
	}
	email = normalizeEmail(email)
	if email == "" {
		return ErrUnknownPurpose
	}
	if name == "" {
		name = "there"
	}

	// Per-address hourly budget: stops this service being used to mail-bomb one
	// person, and protects the Brevo quota everyone else depends on.
	ok, err := s.limiter.Allow(ctx, s.identKey("send", purpose, email), s.cfg.MaxSendsPerHour, time.Hour)
	if err != nil {
		return fmt.Errorf("otp: limiter: %w", err)
	}
	if !ok {
		return ErrRateLimited
	}

	// Per-IP hourly budget. The address limit alone does not stop a client
	// sweeping thousands of DIFFERENT addresses — which this endpoint invites,
	// because it deliberately does not check whether an account exists.
	if ip != "" {
		ok, err := s.limiter.Allow(ctx, s.ipKey("send", ip), s.cfg.MaxSendsPerIP, time.Hour)
		if err != nil {
			return fmt.Errorf("otp: limiter: %w", err)
		}
		if !ok {
			return ErrRateLimited
		}
	}

	k := s.key(purpose, email)

	// Resend cooldown, measured from the live code's issue time.
	if existing, err := s.store.Get(ctx, k); err == nil {
		if time.Since(existing.CreatedAt) < s.cfg.ResendCooldown {
			return ErrRateLimited
		}
	}

	code, err := Generate(s.cfg.Length)
	if err != nil {
		return fmt.Errorf("otp: generate: %w", err)
	}

	now := time.Now().UTC()
	rec := Record{
		Hash:      Hash(code, s.cfg.Pepper),
		Purpose:   purpose,
		CreatedAt: now,
		ExpiresAt: now.Add(s.cfg.TTL),
	}
	if err := s.store.Put(ctx, k, rec, s.cfg.TTL); err != nil {
		return fmt.Errorf("otp: store: %w", err)
	}

	if err := s.sender.SendOTP(ctx, email, name, code, s.cfg.TTL); err != nil {
		// The code is stored but was never delivered. Removing it lets the user
		// ask again immediately; leaving it would lock them out behind their own
		// cooldown waiting for a message that is not coming.
		//
		// The spent send-budget entry is deliberately NOT refunded — a failing
		// provider must not become an unlimited retry loop against it.
		if delErr := s.store.Delete(ctx, k); delErr != nil {
			log.Printf("[otp] WARN: could not delete undelivered code (purpose=%s): %v", purpose, delErr)
		}
		return fmt.Errorf("otp: send: %w", err)
	}

	// Postgres has no TTL. Sweeping here keeps the table bounded without a cron;
	// it is bounded and best-effort, and expiry is enforced on read regardless.
	if n, err := s.store.DeleteExpired(ctx, 200); err != nil {
		log.Printf("[otp] WARN: expired-code sweep failed: %v", err)
	} else if n > 0 {
		log.Printf("[otp] swept %d expired code(s)", n)
	}

	return nil
}

// Verify checks a submitted code and consumes it on success.
//
// The error vocabulary is deliberately coarse. A wrong code, an unknown address
// and a mismatched purpose all return ErrInvalidCode, because distinguishing
// them tells an attacker which addresses are real and which flows are live.
// Expiry and lockout are distinguished because the user genuinely needs to be
// told to request a new code.
func (s *Service) Verify(ctx context.Context, email, purpose, submitted, ip string) error {
	if !IsAllowedPurpose(purpose) {
		return ErrInvalidCode
	}
	email = normalizeEmail(email)
	submitted = strings.TrimSpace(submitted)

	// Per-IP verify budget. The per-code attempt ceiling stops one code being
	// brute-forced; it does nothing about one client guessing once against each
	// of ten thousand addresses, where a 1-in-a-million code still lands often
	// enough to matter.
	if ip != "" {
		ok, err := s.limiter.Allow(ctx, s.ipKey("verify", ip), s.cfg.MaxVerifyPerIP, time.Hour)
		if err != nil {
			return fmt.Errorf("otp: limiter: %w", err)
		}
		if !ok {
			return ErrRateLimited
		}
	}

	k := s.key(purpose, email)

	rec, err := s.store.Get(ctx, k)
	if err != nil {
		if err == ErrNotFound {
			return ErrInvalidCode // never reveal that nothing was issued
		}
		return fmt.Errorf("otp: store: %w", err)
	}

	// TTL is enforced here as well as by the sweep. The sweep is opportunistic,
	// so a row can outlive its expiry; it must not verify while it does.
	if !time.Now().UTC().Before(rec.ExpiresAt) {
		_ = s.store.Delete(ctx, k)
		return ErrExpired
	}
	if rec.Attempts >= s.cfg.MaxAttempts {
		_ = s.store.Delete(ctx, k)
		return ErrTooManyAttempts
	}
	// Purpose is already part of the key, so a mismatch should be impossible.
	// Checked anyway: if a future caller changes the key derivation, this is what
	// stops a login code from completing a password reset.
	if rec.Purpose != purpose {
		return ErrInvalidCode
	}

	consumed, err := s.store.Consume(ctx, k, Hash(submitted, s.cfg.Pepper), s.cfg.MaxAttempts)
	if err != nil {
		return fmt.Errorf("otp: store: %w", err)
	}
	if consumed {
		return nil
	}

	// Wrong code — or a correct one that another request consumed first. Both
	// count as a failed attempt, which is the conservative direction.
	n, incErr := s.store.IncrementAttempts(ctx, k)
	if incErr != nil {
		// The row vanished or expired between the read and here.
		return ErrInvalidCode
	}
	if n >= s.cfg.MaxAttempts {
		_ = s.store.Delete(ctx, k)
		return ErrTooManyAttempts
	}
	return ErrInvalidCode
}
