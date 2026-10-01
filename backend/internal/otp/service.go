// Package otp issues, stores and verifies one-time email codes.
// Nothing outside this package knows how a code is generated, hashed or stored.
// Callers see Issue and Verify and a small set of sentinel errors.

package otp

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"math/big"
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

var (
	ErrNotFound        = errors.New("otp: not found")
	ErrExpired         = errors.New("otp: expired")
	ErrTooManyAttempts = errors.New("otp: too many attempts")
	ErrRateLimited     = errors.New("otp: rate limited")
	ErrInvalidCode     = errors.New("otp: invalid code")
	ErrInvalidLength   = errors.New("otp: invalid length")
	ErrNoPepper        = errors.New("otp: pepper is required")
	ErrUnknownPurpose  = errors.New("otp: unknown purpose")
)

// Generate returns a numeric code of the given length from a CSPRNG.
// crypto/rand, never math/rand. math/rand's global source is seeded
// deterministically in some configurations and its output is reproducible from a
// handful of observations — for a login credential that is a full compromise of
// the mechanism, and it is the single most common defect in OTP code.
// Digits are appended one at a time so a leading zero survives. Generating an
// integer and formatting it is where six-digit codes silently become five:
// strconv.Itoa(51) is "51", not "000051".
func Generate(length int) (string, error) {
	if length < 4 || length > 10 {
		return "", ErrInvalidLength
	}
	var sb strings.Builder
	sb.Grow(length)
	ten := big.NewInt(10)
	for range length {
		n, err := rand.Int(rand.Reader, ten)
		if err != nil {
			return "", err
		}
		sb.WriteByte(byte('0' + n.Int64()))
	}
	return sb.String(), nil
}

// Hash returns HMAC-SHA256(pepper, value) as hex.
// Not bcrypt: verification sits in a latency-sensitive path and a deliberately
// slow KDF there is a denial-of-service surface of its own. Not a bare SHA-256
// either: the entire keyspace of a six-digit code is one million entries, so an
// unkeyed digest is reversed by a table built in seconds. HMAC with a
// server-side pepper is fast AND useless to anyone who takes the database
// without also taking the environment.
// This mirrors connect/verification.Hasher, the existing house pattern for the
// same problem.
func Hash(value string, pepper []byte) string {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}

// Equal compares two hex digests in constant time.
// Never `==`. Go's string comparison short-circuits at the first differing byte;
// the timing signal is small but it is real and it accumulates over many
// requests into a byte-by-byte recovery of the stored digest.
func Equal(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

// normalizeEmail is the single definition of identity for a code. Issue and
// Verify must agree on it exactly, or a code issued to "User@x.com " can never
// be verified by "user@x.com".
func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// PostgresLimiter is a fixed-window counter.
// In Postgres for the same reason the store is: a rate limit that evaporates
// with the cache is not a rate limit. The existing middleware.AuthRateLimiter is
// in-process, which is correct for cheap IP throttling but cannot hold a
// per-address send budget across replicas — two instances would each grant the
// full hourly allowance.
type PostgresLimiter struct{ db *pgxpool.Pool }

func NewPostgresLimiter(db *pgxpool.Pool) *PostgresLimiter { return &PostgresLimiter{db: db} }

// Allow increments the counter for key and reports whether the caller is still
// within limit for the window.
// One statement, so concurrent requests serialise on the row rather than each
// reading the same count. The window rolls forward inside the same statement
// when the previous one has expired.
func (l *PostgresLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	var count int
	err := l.db.QueryRow(ctx, `
		INSERT INTO otp_rate_limits (key, count, window_start, expires_at)
		VALUES ($1, 1, now(), now() + $2::interval)
		ON CONFLICT (key) DO UPDATE
		   SET count        = CASE WHEN otp_rate_limits.expires_at <= now() THEN 1 ELSE otp_rate_limits.count + 1 END,
		       window_start = CASE WHEN otp_rate_limits.expires_at <= now() THEN now() ELSE otp_rate_limits.window_start END,
		       expires_at   = CASE WHEN otp_rate_limits.expires_at <= now() THEN now() + $2::interval ELSE otp_rate_limits.expires_at END
		RETURNING count`,
		key, window.String()).Scan(&count)
	if err != nil {
		// Fail CLOSED. A limiter that answers "allowed" when its store is
		// unreachable is worse than no limiter, because the system reports that
		// it is protected while the budget is unbounded.
		return false, err
	}
	return count <= limit, nil
}

// SweepExpired removes dead counter rows. Bounded, like the code sweep.
func (l *PostgresLimiter) SweepExpired(ctx context.Context, limit int) (int64, error) {
	if limit <= 0 {
		limit = 200
	}
	tag, err := l.db.Exec(ctx, `
		DELETE FROM otp_rate_limits
		 WHERE key IN (SELECT key FROM otp_rate_limits WHERE expires_at < now() LIMIT $1)`, limit)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// Record is one live code. The plaintext code is not part of it and never
// reaches storage.
type Record struct {
	Hash      string
	Purpose   string
	Attempts  int
	CreatedAt time.Time
	ExpiresAt time.Time
}

// Store is the persistence seam. The implementation is authoritative for
// single-use and for the attempt ceiling, which is why Consume and
// IncrementAttempts are defined as atomic operations rather than as a read
// followed by a write in the service.
type Store interface {
	Put(ctx context.Context, key string, r Record, ttl time.Duration) error
	Get(ctx context.Context, key string) (Record, error)

	// Consume atomically deletes the record if, and only if, it still exists,
	// still matches codeHash, has not expired and is under maxAttempts. It
	// reports whether it removed a row.
	// This is the whole of the single-use guarantee. Checking the hash in the
	// service and then deleting would leave a window in which two concurrent
	// submissions of the same correct code both pass — an OTP that can be
	// replayed, which is the property the mechanism exists to provide.
	Consume(ctx context.Context, key, codeHash string, maxAttempts int) (bool, error)

	// IncrementAttempts atomically bumps and returns the new count. Two
	// simultaneous wrong guesses must produce 1 and 2, never 1 and 1 — the
	// second is how an attempt ceiling is escaped under concurrency.
	IncrementAttempts(ctx context.Context, key string) (int, error)

	Delete(ctx context.Context, key string) error

	// DeleteExpired removes at most limit expired rows. Postgres has no TTL, so
	// something has to sweep; expiry is nonetheless enforced on read, so a sweep
	// that never runs cannot make a stale code usable.
	DeleteExpired(ctx context.Context, limit int) (int64, error)
}

// Limiter is the rate-limit seam. Allow increments a fixed-window counter and
// reports whether the caller is still inside the budget.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
}

// PostgresStore is the authoritative OTP store.
// Postgres and not Redis: router.go builds Redis best-effort and documents that
// it is "a latency optimization, never a correctness dependency", leaving
// sharedRedis nil whenever REDIS_URL is unset or unreachable. Single-use,
// attempt ceilings and send budgets are correctness. A store that can disappear
// would take those guarantees with it — and the failure mode of a missing OTP
// store is not a slow login, it is an unbounded one.
type PostgresStore struct{ db *pgxpool.Pool }

func NewPostgresStore(db *pgxpool.Pool) *PostgresStore { return &PostgresStore{db: db} }

// Put replaces any live code for the same key. Re-issuing must invalidate the
// previous code rather than leaving two valid at once, which would double an
// attacker's guessing surface for free.
func (s *PostgresStore) Put(ctx context.Context, key string, r Record, _ time.Duration) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO otp_codes (key, code_hash, purpose, attempts, created_at, expires_at)
		VALUES ($1,$2,$3,0,$4,$5)
		ON CONFLICT (key) DO UPDATE
		   SET code_hash  = EXCLUDED.code_hash,
		       purpose    = EXCLUDED.purpose,
		       attempts   = 0,
		       created_at = EXCLUDED.created_at,
		       expires_at = EXCLUDED.expires_at`,
		key, r.Hash, r.Purpose, r.CreatedAt, r.ExpiresAt)
	return err
}

func (s *PostgresStore) Get(ctx context.Context, key string) (Record, error) {
	var r Record
	err := s.db.QueryRow(ctx, `
		SELECT code_hash, purpose, attempts, created_at, expires_at
		  FROM otp_codes WHERE key = $1`, key).
		Scan(&r.Hash, &r.Purpose, &r.Attempts, &r.CreatedAt, &r.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	return r, nil
}

// Consume is the single-use guarantee, expressed as one statement so that two
// concurrent submissions of the same correct code cannot both succeed: exactly
// one DELETE finds the row.
// The expiry and attempt predicates are repeated here rather than trusted from
// the service's earlier read, because between that read and this call another
// request may have exhausted the attempts.
func (s *PostgresStore) Consume(ctx context.Context, key, codeHash string, maxAttempts int) (bool, error) {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM otp_codes
		 WHERE key = $1
		   AND code_hash = $2
		   AND expires_at > now()
		   AND attempts < $3`, key, codeHash, maxAttempts)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// IncrementAttempts is atomic by construction — the read and the write are the
// same statement. The guide's Redis version is a read-modify-write and notes the
// race; in Postgres the fix is free.
// A row that has expired is not bumped: ErrExpired is the honest answer, and
// silently counting an attempt against a dead code would let an attacker burn
// the next code's budget before it is issued.
func (s *PostgresStore) IncrementAttempts(ctx context.Context, key string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		UPDATE otp_codes
		   SET attempts = attempts + 1
		 WHERE key = $1 AND expires_at > now()
		RETURNING attempts`, key).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either gone or expired; from the caller's side these are the same.
		return 0, ErrExpired
	}
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (s *PostgresStore) Delete(ctx context.Context, key string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM otp_codes WHERE key = $1`, key)
	return err
}

// DeleteExpired sweeps a bounded number of dead rows. Bounded so the sweep can
// run on a request path without turning one user's login into a table scan.
func (s *PostgresStore) DeleteExpired(ctx context.Context, limit int) (int64, error) {
	if limit <= 0 {
		limit = 200
	}
	tag, err := s.db.Exec(ctx, `
		DELETE FROM otp_codes
		 WHERE key IN (SELECT key FROM otp_codes WHERE expires_at < now() LIMIT $1)`, limit)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
