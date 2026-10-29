package estate

// Estate lifecycle (UAT EST-UAT-0418 verification queue, EST-UAT-0419 risk
// suspension — ESTD-D025). Schema: 20271068001000_estates_lifecycle_status.sql.
//
// States: pending → active (verify) | closed (reject); active ⇄ suspended
// (suspend / reactivate); active|suspended → closed (close). Every transition
// needs a reason, runs under a row lock and writes an estate_audit_log row in
// the same transaction. Suspension never deletes anything — it only makes
// AssertEstateWritable refuse, which the write gates (Handler.LifecycleGate on
// the Go /estate/:id routes, getResidentContext({forWrite}) on the BFF) apply
// to every mutating estate action. Reads stay available.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Estate lifecycle states (estates.status CHECK constraint).
const (
	EstateStatusPending   = "pending"
	EstateStatusActive    = "active"
	EstateStatusSuspended = "suspended"
	EstateStatusClosed    = "closed"
)

// Lifecycle actions accepted by TransitionEstate.
const (
	LifecycleVerify     = "verify"
	LifecycleReject     = "reject"
	LifecycleSuspend    = "suspend"
	LifecycleReactivate = "reactivate"
	LifecycleClose      = "close"
)

// NotifEstateStatusChanged tells the estate admin about a platform lifecycle
// decision (approval, rejection with reason, suspension, reactivation).
const NotifEstateStatusChanged = "estate_status_changed"

const minLifecycleReasonLen = 5

var (
	// ErrEstateNotFound — no estates row for the id.
	ErrEstateNotFound = errors.New("estate: estate not found")
	// ErrInvalidLifecycleTransition — action not allowed from the current state.
	ErrInvalidLifecycleTransition = errors.New("estate: invalid lifecycle transition")
	// ErrLifecycleReasonRequired — transitions and legal-hold changes need a reason.
	ErrLifecycleReasonRequired = errors.New("estate: a reason of at least 5 characters is required")
	// ErrLegalHold — a deletion/purge path was refused because the estate is under legal hold.
	ErrLegalHold = errors.New("estate: estate is under legal hold — records cannot be deleted")
)

// EstateNotActiveError is returned by AssertEstateWritable for a non-active estate.
type EstateNotActiveError struct{ Status string }

func (e *EstateNotActiveError) Error() string {
	return fmt.Sprintf("estate: estate is %s — changes are disabled until it is active", e.Status)
}

// IsEstateNotActive reports whether err is (or wraps) an EstateNotActiveError.
func IsEstateNotActive(err error) bool {
	var e *EstateNotActiveError
	return errors.As(err, &e)
}

// lifecycleTarget returns the status an action moves `from` to, or false when
// the transition is not allowed. Pure.
func lifecycleTarget(from, action string) (string, bool) {
	switch action {
	case LifecycleVerify:
		return EstateStatusActive, from == EstateStatusPending
	case LifecycleReject:
		return EstateStatusClosed, from == EstateStatusPending
	case LifecycleSuspend:
		return EstateStatusSuspended, from == EstateStatusActive
	case LifecycleReactivate:
		return EstateStatusActive, from == EstateStatusSuspended
	case LifecycleClose:
		return EstateStatusClosed, from == EstateStatusActive || from == EstateStatusSuspended
	}
	return "", false
}

// EstateLifecycle is the platform view of an estate's lifecycle state.
type EstateLifecycle struct {
	EstateID           string     `json:"estate_id"`
	Name               string     `json:"name"`
	Address            string     `json:"address,omitempty"`
	AdminID            string     `json:"admin_id"`
	Status             string     `json:"status"`
	StatusReason       string     `json:"status_reason,omitempty"`
	StatusChangedAt    *time.Time `json:"status_changed_at,omitempty"`
	StatusChangedBy    *string    `json:"status_changed_by,omitempty"`
	LegalHold          bool       `json:"legal_hold"`
	LegalHoldReason    string     `json:"legal_hold_reason,omitempty"`
	DuplicateSuspected bool       `json:"duplicate_suspected,omitempty"`
	Timezone           string     `json:"timezone,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}

const lifecycleCols = `id, name, COALESCE(address,''), admin_id, status, COALESCE(status_reason,''),
	status_changed_at, status_changed_by::TEXT, legal_hold, COALESCE(legal_hold_reason,''),
	duplicate_suspected, timezone, created_at`

func scanLifecycle(row pgx.Row) (*EstateLifecycle, error) {
	var l EstateLifecycle
	err := row.Scan(&l.EstateID, &l.Name, &l.Address, &l.AdminID, &l.Status, &l.StatusReason,
		&l.StatusChangedAt, &l.StatusChangedBy, &l.LegalHold, &l.LegalHoldReason,
		&l.DuplicateSuspected, &l.Timezone, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrEstateNotFound
	}
	return &l, err
}

// GetEstateLifecycle returns one estate's lifecycle state.
func (s *Service) GetEstateLifecycle(ctx context.Context, estateID string) (*EstateLifecycle, error) {
	return scanLifecycle(s.db.QueryRow(ctx, `SELECT `+lifecycleCols+` FROM estates WHERE id=$1`, estateID))
}

// ListEstatesByStatus is the platform review queue (status="pending") and the
// general lifecycle listing (status="" = all). Oldest pending first.
func (s *Service) ListEstatesByStatus(ctx context.Context, status string, limit int) ([]EstateLifecycle, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `SELECT `+lifecycleCols+` FROM estates
		WHERE ($1='' OR status=$1) ORDER BY created_at ASC LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EstateLifecycle{}
	for rows.Next() {
		l, err := scanLifecycle(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// AssertEstateWritable refuses a mutating estate action unless the estate is
// active. Returns ErrEstateNotFound for an unknown id and an
// *EstateNotActiveError otherwise. Infra errors are returned as-is (callers
// fail closed).
func (s *Service) AssertEstateWritable(ctx context.Context, estateID string) error {
	var status string
	err := s.db.QueryRow(ctx, `SELECT status FROM estates WHERE id=$1`, estateID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrEstateNotFound
	}
	if err != nil {
		return fmt.Errorf("estate: read lifecycle status: %w", err)
	}
	if status != EstateStatusActive {
		return &EstateNotActiveError{Status: status}
	}
	return nil
}

// assertNoLegalHold refuses a deletion/purge path while the estate is held.
func (s *Service) assertNoLegalHold(ctx context.Context, estateID string) error {
	var held bool
	err := s.db.QueryRow(ctx, `SELECT legal_hold FROM estates WHERE id=$1`, estateID).Scan(&held)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrEstateNotFound
	}
	if err != nil {
		return fmt.Errorf("estate: read legal hold: %w", err)
	}
	if held {
		return ErrLegalHold
	}
	return nil
}

func normaliseReason(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if len([]rune(r)) < minLifecycleReasonLen {
		return "", ErrLifecycleReasonRequired
	}
	if len(r) > 1000 {
		r = r[:1000]
	}
	return r, nil
}

// TransitionEstate applies a platform lifecycle action (verify, reject,
// suspend, reactivate, close) with a mandatory reason. The caller is a
// platform operator already authorised by the estate.admin.lifecycle RBAC
// slug. The estate admin is notified (rejections carry the reason).
func (s *Service) TransitionEstate(ctx context.Context, estateID, actorID, action, reason string) (*EstateLifecycle, error) {
	r, err := normaliseReason(reason)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var from, adminID, name string
	err = tx.QueryRow(ctx, `SELECT status, admin_id, name FROM estates WHERE id=$1 FOR UPDATE`, estateID).Scan(&from, &adminID, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrEstateNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("estate: lock estate: %w", err)
	}
	to, ok := lifecycleTarget(from, action)
	if !ok {
		return nil, fmt.Errorf("%w: cannot %s an estate that is %s", ErrInvalidLifecycleTransition, action, from)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE estates SET status=$2, status_reason=$3, status_changed_at=NOW(), status_changed_by=$4 WHERE id=$1`,
		estateID, to, r, actorID); err != nil {
		return nil, fmt.Errorf("estate: update status: %w", err)
	}
	if err := s.auditTx(ctx, tx, estateID, actorID, "estate.lifecycle."+action, "estate", estateID,
		map[string]any{"from": from, "to": to, "reason": r}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit: %w", err)
	}

	title, body := lifecycleNotice(action, name, r)
	s.notify(ctx, estateID, adminID, NotifEstateStatusChanged, title, body, map[string]any{"status": to})
	return s.GetEstateLifecycle(ctx, estateID)
}

func lifecycleNotice(action, name, reason string) (string, string) {
	switch action {
	case LifecycleVerify:
		return "Estate approved", name + " has been verified and is now active."
	case LifecycleReject:
		return "Estate application rejected", fmt.Sprintf("%s was not approved: %s", name, reason)
	case LifecycleSuspend:
		return "Estate suspended", fmt.Sprintf("%s has been suspended: %s. Records are retained; changes are disabled.", name, reason)
	case LifecycleReactivate:
		return "Estate reactivated", name + " is active again."
	default:
		return "Estate closed", fmt.Sprintf("%s has been closed: %s", name, reason)
	}
}

// SetLegalHold places or lifts a legal hold (blocks deletion/purge paths) with
// a mandatory reason. Audited in the same transaction.
func (s *Service) SetLegalHold(ctx context.Context, estateID, actorID string, enabled bool, reason string) (*EstateLifecycle, error) {
	r, err := normaliseReason(reason)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var was bool
	err = tx.QueryRow(ctx, `SELECT legal_hold FROM estates WHERE id=$1 FOR UPDATE`, estateID).Scan(&was)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrEstateNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("estate: lock estate: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE estates SET legal_hold=$2, legal_hold_reason=$3 WHERE id=$1`, estateID, enabled, r); err != nil {
		return nil, fmt.Errorf("estate: update legal hold: %w", err)
	}
	action := "estate.legal_hold.released"
	if enabled {
		action = "estate.legal_hold.placed"
	}
	if err := s.auditTx(ctx, tx, estateID, actorID, action, "estate", estateID,
		map[string]any{"was": was, "now": enabled, "reason": r}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit: %w", err)
	}
	return s.GetEstateLifecycle(ctx, estateID)
}
