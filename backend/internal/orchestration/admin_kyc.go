package orchestration

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// FX KYC review queue for the admin console.
//
// The queue reads the SAME rows the customer-facing KYC flow writes
// (orch_fx_customer_verifications), so a submission is visible to a reviewer the
// moment it is made — no second copy, no sync job. Before this existed the console
// had no endpoint at all and rendered in-file sample customers, which is why a real
// submission looked like it had vanished.

// adminVerificationQueueLimit caps one page of the review queue.
const adminVerificationQueueLimit = 200

// AdminVerificationRow is one submission in the review queue (camelCase for the
// console, matching the other /admin/fx responses).
type AdminVerificationRow struct {
	CustomerID      string  `json:"customerId"`
	Email           string  `json:"email,omitempty"`
	Status          string  `json:"status"`
	AccountType     string  `json:"accountType"`
	Tier            int     `json:"tier"`
	DocType         string  `json:"docType,omitempty"`
	IDNumber        string  `json:"idNumber,omitempty"`
	LegalName       string  `json:"legalName,omitempty"`
	SubmittedAt     *string `json:"submittedAt,omitempty"`
	ReviewedAt      *string `json:"reviewedAt,omitempty"`
	RejectionReason *string `json:"rejectionReason,omitempty"`
}

var verificationStatuses = map[string]bool{
	"unstarted": true, "pending": true, "review": true, "approved": true, "rejected": true,
}

// AdminListVerifications serves GET /api/finance/admin/fx/verifications.
// Optional ?status=pending,review narrows the queue; pending/review sort first.
func (h *Handler) AdminListVerifications(c *gin.Context) {
	var filter []string
	for _, s := range strings.Split(c.Query("status"), ",") {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" {
			continue
		}
		if !verificationStatuses[s] {
			writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "unknown verification status").WithParam("status"))
			return
		}
		filter = append(filter, s)
	}
	if h.verif == nil {
		writeErr(c, NewError(ErrNotImplemented, "verifications_unavailable",
			"The FX KYC queue needs the orchestration database, which is not configured."))
		return
	}
	rows, err := h.verif.List(c.Request.Context(), filter, adminVerificationQueueLimit)
	if err != nil {
		writeErr(c, NewError(ErrInternal, "verifications_unavailable", "Could not read the FX KYC queue."))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows})
}

// AdminDecideVerification serves POST /api/finance/admin/fx/verifications/:customerId/decision.
// Only approve/reject, and only against an existing submission.
func (h *Handler) AdminDecideVerification(c *gin.Context) {
	customerID := strings.TrimSpace(c.Param("customerId"))
	if customerID == "" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "customer id is required").WithParam("customerId"))
		return
	}
	var req struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "invalid request body"))
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "approved" && status != "rejected" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "status must be approved or rejected").WithParam("status"))
		return
	}
	reason := strings.TrimSpace(req.Reason)
	// The customer is shown the rejection reason, so an empty one would leave them
	// with a dead end and nothing to fix.
	if status == "rejected" && reason == "" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "a rejection needs a reason — the customer sees it").WithParam("reason"))
		return
	}
	if h.verif == nil {
		writeErr(c, NewError(ErrNotImplemented, "verifications_unavailable",
			"The FX KYC queue needs the orchestration database, which is not configured."))
		return
	}
	rec, err := h.verif.SetStatus(c.Request.Context(), customerID, status, reason)
	if errors.Is(err, ErrNoVerification) {
		writeErr(c, NewError(ErrNotFound, "verification_not_found", "No FX KYC submission on file for that customer."))
		return
	}
	if err != nil {
		writeErr(c, NewError(ErrInternal, "decision_failed", "Could not record the KYC decision."))
		return
	}
	log.Printf("[fx-admin] KYC %s for customer %s by %s (reason=%q)", status, customerID, ginutil.UserID(c), reason)
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// List returns the review queue: newest submissions are NOT what an operator
// wants first, so pending/review rows lead and each group is oldest-first.
func (s *sqlVerificationStore) List(ctx context.Context, statuses []string, limit int) ([]AdminVerificationRow, error) {
	if limit <= 0 || limit > adminVerificationQueueLimit {
		limit = adminVerificationQueueLimit
	}
	var filter any
	if len(statuses) > 0 {
		filter = statuses
	}
	rows, err := s.db.Query(ctx, `
		SELECT v.customer_id,
		       coalesce(u.email, ''),
		       v.status, v.account_type, v.tier,
		       coalesce(v.submission->'identity'->>'docType', ''),
		       coalesce(v.submission->'identity'->>'idNumber', ''),
		       coalesce(nullif(v.submission->'business'->>'legalName', ''),
		                nullif(v.submission->'business'->>'rcNumber', ''), ''),
		       v.submitted_at, v.reviewed_at, v.rejection_reason
		FROM orch_fx_customer_verifications v
		LEFT JOIN auth.users u ON u.id::text = v.customer_id
		WHERE ($1::text[] IS NULL OR v.status = ANY($1::text[]))
		ORDER BY CASE WHEN v.status IN ('pending','review') THEN 0 ELSE 1 END,
		         v.submitted_at ASC NULLS LAST
		LIMIT $2`, filter, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AdminVerificationRow, 0, 16)
	for rows.Next() {
		var r AdminVerificationRow
		var submitted, reviewed *time.Time
		if err := rows.Scan(
			&r.CustomerID, &r.Email, &r.Status, &r.AccountType, &r.Tier,
			&r.DocType, &r.IDNumber, &r.LegalName,
			&submitted, &reviewed, &r.RejectionReason,
		); err != nil {
			return nil, err
		}
		r.SubmittedAt = tsPtr(submitted)
		r.ReviewedAt = tsPtr(reviewed)
		out = append(out, r)
	}
	return out, rows.Err()
}
