package transport

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Admin proof-of-delivery review for parcels. Record-only: it moves no money
// and does not change the parcel status (a rejected POD that needs a dispute
// goes through PATCH /parcels/:id/status, which has its own audit trail).

// ParcelPodReviewRequest is PATCH /admin/transport/parcels/:id/pod-review.
type ParcelPodReviewRequest struct {
	Decision string `json:"decision" binding:"required"`
	Reason   string `json:"reason"`
}

// parcelPodReviewResult is the response (and replay) payload.
type parcelPodReviewResult struct {
	OK        bool   `json:"ok"`
	ParcelID  string `json:"parcelId"`
	PodStatus string `json:"podStatus"`
	Replayed  bool   `json:"replayed"`
}

type podReviewAudit struct {
	PodReviewStatus *string `json:"pod_review_status"`
}

// validatePodReview is the pure input gate.
func validatePodReview(decision, reason string, proofURL *string) *CodedError {
	if decision != "approved" && decision != "rejected" {
		return codedErr(http.StatusBadRequest, CodeInvalidState, "decision must be approved or rejected")
	}
	if decision == "rejected" && strings.TrimSpace(reason) == "" {
		return codedErr(http.StatusBadRequest, CodeInvalidState, "a reason is required to reject a proof of delivery")
	}
	if proofURL == nil || strings.TrimSpace(*proofURL) == "" {
		return codedErr(http.StatusConflict, CodeInvalidState, "this parcel has no proof of delivery to review")
	}
	return nil
}

// ReviewParcelPod records an admin POD decision under a row lock with its audit
// row in the same transaction. Re-sending the current decision is a no-op
// replay (no second audit row); a changed decision is an audited overturn.
func (a *AdminService) ReviewParcelPod(ctx context.Context, adminID, parcelID string, req ParcelPodReviewRequest) (*parcelPodReviewResult, error) {
	tx, err := a.svc.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var proofURL, current *string
	err = tx.QueryRow(ctx, `SELECT proof_url, pod_review_status FROM parcels WHERE id::text=$1 FOR UPDATE`, parcelID).
		Scan(&proofURL, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if err != nil {
		return nil, err
	}
	if cerr := validatePodReview(req.Decision, req.Reason, proofURL); cerr != nil {
		return nil, cerr
	}
	res := &parcelPodReviewResult{OK: true, ParcelID: parcelID, PodStatus: req.Decision}
	if current != nil && *current == req.Decision {
		res.Replayed = true
		return res, nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcels SET pod_review_status=$2, pod_reviewed_by=$3, pod_reviewed_at=NOW(),
		       pod_review_reason=$4, updated_at=NOW()
		WHERE id::text=$1`, parcelID, req.Decision, adminID, req.Reason); err != nil {
		return nil, err
	}
	decision := req.Decision
	if err := writeAudit(ctx, tx, adminID, "parcel.pod.review", "parcel", parcelID,
		podReviewAudit{PodReviewStatus: current}, podReviewAudit{PodReviewStatus: &decision}, req.Reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return res, nil
}

// AdminParcelPodReview approves or rejects a parcel's proof of delivery.
func (h *AdminHandler) AdminParcelPodReview(c *gin.Context) {
	var req ParcelPodReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.ReviewParcelPod(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
