package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Beneficiaries (work order 1). NOT a money path — no idempotency key — but all
// inputs are hard-validated (service + DB CHECKs) and every add/remove is
// audit-logged to fre_audit_log. The share-cap (sum <= 100%) and max-count
// rules are additionally enforced by a race-safe guarded INSERT in the repo.

// validateBeneficiaryInput is the pure input gate (unit-testable, no DB).
// Rules mirror the DB CHECKs: name 2..80, relationship 2..40, share 1..100.
func validateBeneficiaryInput(name, relationship string, sharePct int) error {
	name = strings.TrimSpace(name)
	relationship = strings.TrimSpace(relationship)
	if l := len([]rune(name)); l < 2 || l > 80 {
		return fmt.Errorf("%w: name must be 2-80 characters", ErrBeneficiaryInput)
	}
	if l := len([]rune(relationship)); l < 2 || l > 40 {
		return fmt.Errorf("%w: relationship must be 2-40 characters", ErrBeneficiaryInput)
	}
	if sharePct < 1 || sharePct > 100 {
		return fmt.Errorf("%w: share_pct must be between 1 and 100", ErrBeneficiaryInput)
	}
	return nil
}

// beneficiaryCapCheck is the pure server-side aggregate rule (unit-testable):
// the user's total share across beneficiaries must not exceed 100% and the
// count must stay under MaxBeneficiaries.
func beneficiaryCapCheck(existingTotalPct, existingCount, newSharePct int) error {
	if existingCount >= MaxBeneficiaries {
		return ErrBeneficiaryLimit
	}
	if existingTotalPct+newSharePct > 100 {
		return ErrBeneficiaryShare
	}
	return nil
}

// ── Service ───────────────────────────────────────────────────────────────────

func (s *Service) ListBeneficiaries(ctx context.Context, userID string) ([]Beneficiary, error) {
	return s.repo.ListBeneficiaries(ctx, userID)
}

// AddBeneficiary validates hard, applies the share-cap/count rules, and inserts
// via a guarded statement so a concurrent add can never overshoot 100%.
func (s *Service) AddBeneficiary(ctx context.Context, userID, name, relationship string, sharePct int) (*Beneficiary, error) {
	if err := validateBeneficiaryInput(name, relationship, sharePct); err != nil {
		return nil, err
	}
	totalPct, count, err := s.repo.SumBeneficiaryShares(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := beneficiaryCapCheck(totalPct, count, sharePct); err != nil {
		return nil, err
	}
	b := &Beneficiary{
		UserID:       userID,
		Name:         strings.TrimSpace(name),
		Relationship: strings.TrimSpace(relationship),
		SharePct:     sharePct,
	}
	if err := s.repo.InsertBeneficiary(ctx, b); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, userID, "beneficiary.add", "beneficiary", b.ID, "",
		nil, map[string]any{"name": b.Name, "relationship": b.Relationship, "share_pct": b.SharePct})
	return b, nil
}

// RemoveBeneficiary deletes the caller's own row only; a foreign or unknown id
// is a 404 (object-level authorization).
func (s *Service) RemoveBeneficiary(ctx context.Context, userID, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return ErrNotFound
	}
	if err := s.repo.DeleteBeneficiary(ctx, id, userID); err != nil {
		return err
	}
	_ = s.audit.log(ctx, userID, "beneficiary.remove", "beneficiary", id, "", nil, nil)
	return nil
}

// ── Repository ────────────────────────────────────────────────────────────────

func (r *Repository) ListBeneficiaries(ctx context.Context, userID string) ([]Beneficiary, error) {
	const q = `SELECT id, user_id, name, relationship, share_pct, created_at
		FROM fre_beneficiaries WHERE user_id=$1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Beneficiary
	for rows.Next() {
		var b Beneficiary
		if err := rows.Scan(&b.ID, &b.UserID, &b.Name, &b.Relationship, &b.SharePct, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SumBeneficiaryShares returns the user's current share total and row count.
func (r *Repository) SumBeneficiaryShares(ctx context.Context, userID string) (totalPct, count int, err error) {
	const q = `SELECT COALESCE(SUM(share_pct),0), COUNT(*) FROM fre_beneficiaries WHERE user_id=$1`
	err = r.db.QueryRow(ctx, q, userID).Scan(&totalPct, &count)
	return totalPct, count, err
}

// InsertBeneficiary is a guarded insert: the WHERE re-checks the share cap and
// the max-count atomically, so two concurrent adds cannot jointly exceed 100%.
func (r *Repository) InsertBeneficiary(ctx context.Context, b *Beneficiary) error {
	const q = `
		INSERT INTO fre_beneficiaries (user_id, name, relationship, share_pct)
		SELECT $1, $2, $3, $4
		WHERE (SELECT COALESCE(SUM(share_pct),0) FROM fre_beneficiaries WHERE user_id=$1) + $4 <= 100
		  AND (SELECT COUNT(*) FROM fre_beneficiaries WHERE user_id=$1) < $5
		RETURNING id, created_at`
	err := r.db.QueryRow(ctx, q, b.UserID, b.Name, b.Relationship, b.SharePct, MaxBeneficiaries).
		Scan(&b.ID, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost a race against a concurrent add — surface the aggregate rule.
		return ErrBeneficiaryShare
	}
	return err
}

// DeleteBeneficiary removes the row only when it belongs to userID.
func (r *Repository) DeleteBeneficiary(ctx context.Context, id, userID string) error {
	const q = `DELETE FROM fre_beneficiaries WHERE id=$1 AND user_id=$2`
	ct, err := r.db.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) ListBeneficiaries(c *gin.Context) {
	out, err := h.svc.ListBeneficiaries(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"beneficiaries": out})
}

func (h *Handler) AddBeneficiary(c *gin.Context) {
	var body struct {
		Name         string `json:"name" binding:"required"`
		Relationship string `json:"relationship" binding:"required"`
		SharePct     int    `json:"share_pct" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.AddBeneficiary(c.Request.Context(), uid(c), body.Name, body.Relationship, body.SharePct)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

func (h *Handler) DeleteBeneficiary(c *gin.Context) {
	if err := h.svc.RemoveBeneficiary(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
