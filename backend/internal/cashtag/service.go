package cashtag

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handle is a unique @username mapped to exactly one identity (UNIQUE per
// identity AND per handle). It is the addressing primitive for social P2P,
// events and creators. Claiming a reserved/abusive handle, or one that
// impersonates a protected name, is rejected.
type Handle struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"` // FK auth.users(id)
	Handle    string    `json:"handle"`  // normalized, lower-case, no leading '@'
	CreatedAt time.Time `json:"created_at"`
}

// handlePattern: 3-30 chars, starts alnum, alnum + underscore only.
var handlePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{2,29}$`)

// reserved are system / abuse / impersonation-prone handles that can never be
// claimed by a normal user. Stored here AND enforced by a DB seed list so the
// guard holds even if a write bypasses the service.
var reserved = map[string]struct{}{
	"paymax": {}, "admin": {}, "support": {}, "official": {}, "help": {},
	"root": {}, "system": {}, "spotlight": {}, "wallet": {}, "escrow": {},
	"ajo": {}, "savings": {}, "security": {}, "team": {}, "staff": {},
	"moderator": {}, "verify": {}, "verified": {}, "payment": {}, "payments": {},
}

// Service manages the cashtag directory.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Normalize lower-cases and strips a leading '@'.
func Normalize(h string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(h), "@")))
}

// Validate enforces format + reserved/impersonation guards.
func Validate(h string) error {
	n := Normalize(h)
	if !handlePattern.MatchString(n) {
		return fmt.Errorf("cashtag: handle must be 3-30 chars, start alphanumeric, [a-z0-9_] only")
	}
	if _, bad := reserved[n]; bad {
		return ErrReserved
	}
	// Impersonation guard: a handle that merely pads a reserved word with
	// separators (e.g. "paymax_official", "p_a_y_m_a_x") is rejected.
	stripped := strings.ReplaceAll(n, "_", "")
	for r := range reserved {
		if stripped == r || strings.HasPrefix(stripped, r) && len(r) >= 5 {
			return ErrImpersonation
		}
	}
	return nil
}

// Claim assigns a handle to a user. One handle per user (UNIQUE user_id) and one
// user per handle (UNIQUE handle) — both enforced in schema and surfaced here.
func (s *Service) Claim(ctx context.Context, userID, handle string) (*Handle, error) {
	if userID == "" {
		return nil, fmt.Errorf("cashtag: user required")
	}
	if err := Validate(handle); err != nil {
		return nil, err
	}
	n := Normalize(handle)

	h := &Handle{ID: uuid.New().String(), UserID: userID, Handle: n, CreatedAt: time.Now()}
	const ins = `INSERT INTO cashtag_handles (id, user_id, handle) VALUES ($1,$2,$3)`
	if _, err := s.db.Exec(ctx, ins, h.ID, h.UserID, h.Handle); err != nil {
		// Unique violation — handle already taken or user already has one.
		if strings.Contains(err.Error(), "uq_cashtag_handle") || strings.Contains(err.Error(), "duplicate key") && strings.Contains(err.Error(), "handle") {
			return nil, ErrTaken
		}
		if strings.Contains(err.Error(), "uq_cashtag_user") {
			return nil, ErrAlreadyClaimed
		}
		return nil, fmt.Errorf("cashtag: claim: %w", err)
	}
	return h, nil
}

// Resolve maps a handle to its owning user id. Used to address P2P payments.
func (s *Service) Resolve(ctx context.Context, handle string) (string, error) {
	n := Normalize(handle)
	if n == "" {
		return "", ErrNotFound
	}
	const q = `SELECT user_id FROM cashtag_handles WHERE handle=$1`
	var userID string
	if err := s.db.QueryRow(ctx, q, n).Scan(&userID); err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("cashtag: resolve: %w", err)
	}
	return userID, nil
}

// HandleFor returns the user's current handle (or ErrNotFound).
func (s *Service) HandleFor(ctx context.Context, userID string) (*Handle, error) {
	const q = `SELECT id, user_id, handle, created_at FROM cashtag_handles WHERE user_id=$1`
	var h Handle
	if err := s.db.QueryRow(ctx, q, userID).Scan(&h.ID, &h.UserID, &h.Handle, &h.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &h, nil
}

// Sentinel errors.
var (
	ErrReserved       = fmt.Errorf("cashtag: handle is reserved")
	ErrImpersonation  = fmt.Errorf("cashtag: handle impersonates a protected name")
	ErrTaken          = fmt.Errorf("cashtag: handle already taken")
	ErrAlreadyClaimed = fmt.Errorf("cashtag: user already has a handle")
	ErrNotFound       = fmt.Errorf("cashtag: handle not found")
)
