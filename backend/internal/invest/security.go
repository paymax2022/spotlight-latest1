package invest

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// ─────────────────────────────────────────────────────────────────────────────
// Transaction PIN — DB-backed, salted SHA-256 with failed-attempt lockout.
//
// The raw PIN is never stored. Low-entropy PINs (4–6 digits) are protected by
// the lockout: after maxPINFailures wrong attempts the account is locked for
// pinLockWindow. This replaces MockPINVerifier in production.
// ─────────────────────────────────────────────────────────────────────────────

const (
	maxPINFailures = 5
	pinLockWindow  = 15 * time.Minute
)

var (
	ErrPINNotSet = errors.New("invest: transaction PIN not set")
	ErrPINLocked = errors.New("invest: transaction PIN locked — try again later")
)

func hashPIN(salt, pin string) string {
	sum := sha256.Sum256([]byte(salt + pin))
	return hex.EncodeToString(sum[:])
}

func randomSalt() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func validPINFormat(pin string) bool {
	if len(pin) < 4 || len(pin) > 6 {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ── Repository ───────────────────────────────────────────────────────────────

type pinRow struct {
	Hash           string
	Salt           string
	FailedAttempts int
	LockedUntil    *time.Time
}

func (r *Repository) getPIN(ctx context.Context, userID string) (*pinRow, error) {
	var p pinRow
	err := r.db.QueryRow(ctx,
		`SELECT pin_hash, salt, failed_attempts, locked_until FROM invest_user_pins WHERE user_id=$1`, userID).
		Scan(&p.Hash, &p.Salt, &p.FailedAttempts, &p.LockedUntil)
	if err == pgx.ErrNoRows {
		return nil, ErrPINNotSet
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// SetPIN creates or replaces a user's PIN (resets lockout state).
func (r *Repository) SetPIN(ctx context.Context, userID, pin string) error {
	salt, err := randomSalt()
	if err != nil {
		return err
	}
	h := hashPIN(salt, pin)
	const q = `INSERT INTO invest_user_pins (user_id, pin_hash, salt, failed_attempts, locked_until)
		VALUES ($1,$2,$3,0,NULL)
		ON CONFLICT (user_id) DO UPDATE SET pin_hash=$2, salt=$3, failed_attempts=0, locked_until=NULL, updated_at=now()`
	_, err = r.db.Exec(ctx, q, userID, h, salt)
	return err
}

func (r *Repository) recordPINFailure(ctx context.Context, userID string, attempts int) error {
	if attempts+1 >= maxPINFailures {
		_, err := r.db.Exec(ctx,
			`UPDATE invest_user_pins SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
			userID, attempts+1, time.Now().Add(pinLockWindow))
		return err
	}
	_, err := r.db.Exec(ctx,
		`UPDATE invest_user_pins SET failed_attempts=$2, updated_at=now() WHERE user_id=$1`, userID, attempts+1)
	return err
}

func (r *Repository) resetPINFailures(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE invest_user_pins SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, userID)
	return err
}

// ── Verifier ─────────────────────────────────────────────────────────────────

// DBPINVerifier implements PINVerifier against invest_user_pins.
type DBPINVerifier struct{ repo *Repository }

func NewDBPINVerifier(repo *Repository) *DBPINVerifier { return &DBPINVerifier{repo: repo} }

func (v *DBPINVerifier) Verify(ctx context.Context, userID, pin string) error {
	if !validPINFormat(pin) {
		return ErrInvalidPIN
	}
	row, err := v.repo.getPIN(ctx, userID)
	if err != nil {
		return err // ErrPINNotSet or DB error
	}
	if row.LockedUntil != nil && row.LockedUntil.After(time.Now()) {
		return ErrPINLocked
	}
	expected := hashPIN(row.Salt, pin)
	if subtle.ConstantTimeCompare([]byte(expected), []byte(row.Hash)) == 1 {
		_ = v.repo.resetPINFailures(ctx, userID)
		return nil
	}
	_ = v.repo.recordPINFailure(ctx, userID, row.FailedAttempts)
	return ErrInvalidPIN
}

// ── Service helpers ──────────────────────────────────────────────────────────

// SetPIN sets/changes a user's transaction PIN. When a PIN already exists the
// caller must supply the correct current PIN.
func (s *Service) SetPIN(ctx context.Context, userID, newPIN, currentPIN string) error {
	if !validPINFormat(newPIN) {
		return ErrInvalidPIN
	}
	if _, err := s.repo.getPIN(ctx, userID); err == nil {
		// Existing PIN — verify current before replacing.
		if err := s.pin.Verify(ctx, userID, currentPIN); err != nil {
			return err
		}
	} else if !errors.Is(err, ErrPINNotSet) {
		return err
	}
	return s.repo.SetPIN(ctx, userID, newPIN)
}

// HasPIN reports whether the user has set a transaction PIN.
func (s *Service) HasPIN(ctx context.Context, userID string) (bool, error) {
	_, err := s.repo.getPIN(ctx, userID)
	if errors.Is(err, ErrPINNotSet) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// ── Handler ──────────────────────────────────────────────────────────────────

func (h *Handler) PINStatus(c *gin.Context) {
	has, err := h.svc.HasPIN(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin_set": has})
}

func (h *Handler) SetPIN(c *gin.Context) {
	var body struct {
		PIN        string `json:"pin" binding:"required"`
		CurrentPIN string `json:"current_pin"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetPIN(c.Request.Context(), uid(c), body.PIN, body.CurrentPIN); err != nil {
		switch {
		case errors.Is(err, ErrInvalidPIN):
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN must be 4–6 digits, and the current PIN must be correct"})
		case errors.Is(err, ErrPINLocked):
			c.JSON(http.StatusForbidden, gin.H{"error": "PIN is locked, try again later"})
		default:
			httpErr(c, err)
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin_set": true})
}
