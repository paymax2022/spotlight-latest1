package restaurant

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// FOOD-UAT-G-011 — two-person (maker-checker) approval on payout runs.
//
// A payout run is built by one admin (BuildRun creates the draft). Before any
// money moves it must collect:
//
//	requested  — the maker (POST /payouts/:id/request)
//	endorsed   — optional second look (POST /payouts/:id/endorse)
//	approved   — the checker (POST /payouts/:id/approve)
//
// The approver must be a DIFFERENT user from whoever requested or endorsed, and an
// endorser must differ from the requester. ProcessRun is only reachable once an
// 'approved' row exists (RequirePayoutApproved middleware on /payouts/:id/process).
// This lives in its own file so payout.go (the money path) is untouched.

type PayoutApprovalStep string

const (
	PayoutStepRequested PayoutApprovalStep = "requested"
	PayoutStepEndorsed  PayoutApprovalStep = "endorsed"
	PayoutStepApproved  PayoutApprovalStep = "approved"
)

var (
	ErrPayoutNotRequested     = errors.New("restaurant: payout run has not been requested yet")
	ErrPayoutSameActor        = errors.New("restaurant: a different admin must perform this payout approval step")
	ErrPayoutStepRecorded     = errors.New("restaurant: this payout approval step is already recorded")
	ErrPayoutRunNotDraft      = errors.New("restaurant: payout run is not a draft")
	ErrPayoutApprovalRequired = errors.New("restaurant: payout run needs two-person approval before it can be processed")
)

// PayoutApproval is one recorded step.
type PayoutApproval struct {
	Step        PayoutApprovalStep `json:"step"`
	ActorUserID string             `json:"actor_user_id"`
	Note        string             `json:"note,omitempty"`
	CreatedAt   string             `json:"created_at"`
}

// RecordPayoutApproval records one step atomically. The guard predicates live in
// the INSERT itself so two concurrent callers cannot both slip past a check-then-
// insert race; the (payout_run_id, step) unique constraint makes each step single-shot.
func (s *Service) RecordPayoutApproval(ctx context.Context, runID, actorID string, step PayoutApprovalStep, note string) error {
	if actorID == "" {
		return ErrPayoutSameActor
	}
	var run string
	err := s.db.QueryRow(ctx, `SELECT status FROM restaurant_payout_runs WHERE id=$1`, runID).Scan(&run)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPayoutRunNotFound
	}
	if err != nil {
		return fmt.Errorf("restaurant: load payout run: %w", err)
	}
	if run != string(PayoutStatusDraft) {
		return ErrPayoutRunNotDraft
	}

	var q string
	switch step {
	case PayoutStepRequested:
		q = `INSERT INTO restaurant_payout_approvals (payout_run_id, step, actor_user_id, note)
		     VALUES ($1,$2,$3,NULLIF($4,''))
		     ON CONFLICT (payout_run_id, step) DO NOTHING`
	case PayoutStepEndorsed:
		q = `INSERT INTO restaurant_payout_approvals (payout_run_id, step, actor_user_id, note)
		     SELECT $1,$2,$3,NULLIF($4,'')
		      WHERE EXISTS (SELECT 1 FROM restaurant_payout_approvals WHERE payout_run_id=$1 AND step='requested')
		        AND NOT EXISTS (SELECT 1 FROM restaurant_payout_approvals WHERE payout_run_id=$1 AND step='requested' AND actor_user_id=$3)
		     ON CONFLICT (payout_run_id, step) DO NOTHING`
	case PayoutStepApproved:
		q = `INSERT INTO restaurant_payout_approvals (payout_run_id, step, actor_user_id, note)
		     SELECT $1,$2,$3,NULLIF($4,'')
		      WHERE EXISTS (SELECT 1 FROM restaurant_payout_approvals WHERE payout_run_id=$1 AND step='requested')
		        AND NOT EXISTS (SELECT 1 FROM restaurant_payout_approvals WHERE payout_run_id=$1 AND step IN ('requested','endorsed') AND actor_user_id=$3)
		     ON CONFLICT (payout_run_id, step) DO NOTHING`
	default:
		return fmt.Errorf("restaurant: unknown payout approval step %q", step)
	}
	ct, err := s.db.Exec(ctx, q, runID, string(step), actorID, note)
	if err != nil {
		return fmt.Errorf("restaurant: record payout approval: %w", err)
	}
	if ct.RowsAffected() == 1 {
		s.auditPayoutApproval(actorID, runID, step, note)
		return nil
	}
	// 0 rows: diagnose which guard refused (the row is already there, the
	// request is missing, or the actor is not distinct).
	approvals, derr := s.ListPayoutApprovals(ctx, runID)
	if derr != nil {
		return derr
	}
	var haveRequested bool
	for _, a := range approvals {
		if a.Step == step {
			return ErrPayoutStepRecorded
		}
		if a.Step == PayoutStepRequested {
			haveRequested = true
		}
	}
	if !haveRequested {
		return ErrPayoutNotRequested
	}
	return ErrPayoutSameActor
}

// ListPayoutApprovals returns the recorded steps for a run, oldest first.
func (s *Service) ListPayoutApprovals(ctx context.Context, runID string) ([]PayoutApproval, error) {
	rows, err := s.db.Query(ctx, `SELECT step, actor_user_id::text, COALESCE(note,''), created_at::text
	  FROM restaurant_payout_approvals WHERE payout_run_id=$1 ORDER BY created_at, step`, runID)
	if err != nil {
		return nil, fmt.Errorf("restaurant: list payout approvals: %w", err)
	}
	defer rows.Close()
	out := []PayoutApproval{}
	for rows.Next() {
		var a PayoutApproval
		var step string
		if err := rows.Scan(&step, &a.ActorUserID, &a.Note, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Step = PayoutApprovalStep(step)
		out = append(out, a)
	}
	return out, rows.Err()
}

// PayoutApproved reports whether the run holds a valid 'approved' step. It
// re-checks distinctness (defence in depth) so a row forged by direct SQL with the
// same actor as the requester still does not unlock processing. Fail-closed.
func (s *Service) PayoutApproved(ctx context.Context, runID string) (bool, error) {
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (
	  SELECT 1 FROM restaurant_payout_approvals a
	   WHERE a.payout_run_id=$1 AND a.step='approved'
	     AND EXISTS (SELECT 1 FROM restaurant_payout_approvals r WHERE r.payout_run_id=$1 AND r.step='requested')
	     AND NOT EXISTS (SELECT 1 FROM restaurant_payout_approvals o
	                      WHERE o.payout_run_id=$1 AND o.step IN ('requested','endorsed') AND o.actor_user_id=a.actor_user_id))`,
		runID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("restaurant: check payout approval: %w", err)
	}
	return ok, nil
}

func (s *Service) auditPayoutApproval(actorID, runID string, step PayoutApprovalStep, note string) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actorID, "", "restaurant.payout."+string(step), "restaurant", "payout_run", runID,
		nil, map[string]any{"step": string(step), "note": note}, "", "", "warning")
}

func payoutApprovalStatus(err error) int {
	switch {
	case errors.Is(err, ErrPayoutRunNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrPayoutSameActor):
		return http.StatusForbidden
	case errors.Is(err, ErrPayoutStepRecorded), errors.Is(err, ErrPayoutNotRequested), errors.Is(err, ErrPayoutRunNotDraft):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) payoutApprovalStep(step PayoutApprovalStep) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Note string `json:"note"`
		}
		_ = c.ShouldBindJSON(&body) // note is optional; an empty body is fine
		runID := c.Param("id")
		if err := h.svc.RecordPayoutApproval(c.Request.Context(), runID, ginutil.UserID(c), step, body.Note); err != nil {
			st := payoutApprovalStatus(err)
			c.JSON(st, gin.H{"error": httperr.Msg(c, st, err)})
			return
		}
		list, err := h.svc.ListPayoutApprovals(c.Request.Context(), runID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"payout_run_id": runID, "approvals": list})
	}
}

// AdminRequestPayoutRun → POST /api/restaurant/admin/payouts/:id/request
// (restaurant.admin.payouts). The maker step.
func (h *Handler) AdminRequestPayoutRun(c *gin.Context) {
	h.payoutApprovalStep(PayoutStepRequested)(c)
}

// AdminEndorsePayoutRun → POST .../payouts/:id/endorse (restaurant.admin.payout_approve).
func (h *Handler) AdminEndorsePayoutRun(c *gin.Context) {
	h.payoutApprovalStep(PayoutStepEndorsed)(c)
}

// AdminApprovePayoutRun → POST .../payouts/:id/approve (restaurant.admin.payout_approve).
func (h *Handler) AdminApprovePayoutRun(c *gin.Context) {
	h.payoutApprovalStep(PayoutStepApproved)(c)
}

// AdminPayoutApprovals → GET .../payouts/:id/approvals.
func (h *Handler) AdminPayoutApprovals(c *gin.Context) {
	list, err := h.svc.ListPayoutApprovals(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payout_run_id": c.Param("id"), "approvals": list})
}

// RequirePayoutApproved is route middleware placed in front of AdminProcessPayoutRun:
// no 'approved' step from a distinct user ⇒ 403 and ProcessRun never runs.
func (h *Handler) RequirePayoutApproved() gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, err := h.svc.PayoutApproved(c.Request.Context(), c.Param("id"))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": httperr.Msg(c, http.StatusForbidden, ErrPayoutApprovalRequired)})
			return
		}
		c.Next()
	}
}
