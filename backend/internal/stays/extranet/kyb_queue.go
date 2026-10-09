package extranet

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/httperr"
)

// KYBQueueItem is one row of the admin KYB review queue. Everything sensitive
// (RC number, TIN, director name, BVN) is masked or reduced to a presence flag:
// the reviewer decides from the masked view plus the status columns, and the
// full values are only ever supplied *to* the decision route, never read back.
type KYBQueueItem struct {
	PropertyID        string                 `json:"property_id"`
	PropertyName      string                 `json:"property_name"`
	City              string                 `json:"city"`
	LegalName         string                 `json:"legal_name"`
	BusinessType      string                 `json:"business_type"`
	RCNumberMasked    string                 `json:"rc_number_masked"`
	HasTIN            bool                   `json:"has_tin"`
	DirectorMasked    string                 `json:"director_masked"`
	DirectorBVNLast4  string                 `json:"director_bvn_last4"`
	KYCStatus         VerificationItemStatus `json:"kyc_status"`
	BusinessDocStatus VerificationItemStatus `json:"business_doc_status"`
	Status            VerificationItemStatus `json:"status"`
	SubmittedAt       *time.Time             `json:"submitted_at,omitempty"`
	ReviewedAt        *time.Time             `json:"reviewed_at,omitempty"`
	ReviewerNote      string                 `json:"reviewer_note,omitempty"`
}

func validKYBListStatus(s string) bool {
	switch VerificationItemStatus(s) {
	case "", VerifPending, VerifInProgress, VerifSubmitted, VerifApproved, VerifRejected, VerifNeedsChanges:
		return true
	}
	return false
}

// maskRC keeps the last 4 characters of an RC number behind a "RC ••••" prefix.
func maskRC(rc string) string {
	if len(rc) < 4 {
		if rc == "" {
			return ""
		}
		return "RC ••••"
	}
	return "RC ••••" + rc[len(rc)-4:]
}

// maskPersonName keeps the first name and the first letter of the rest.
func maskPersonName(name string) string {
	f := strings.Fields(name)
	switch len(f) {
	case 0:
		return ""
	case 1:
		return string([]rune(f[0])[:1]) + "••••"
	}
	return f[0] + " " + string([]rune(f[1])[:1]) + "••••"
}

func toKYBQueueItem(k kyb, propertyName, city string) KYBQueueItem {
	kyc, doc, st := k.KYCStatus, k.BusinessDocStatus, k.Status
	if kyc == "" {
		kyc = VerifPending
	}
	if doc == "" {
		doc = VerifPending
	}
	if st == "" {
		st = VerifPending
	}
	note := ""
	if k.ReviewerNote != nil {
		note = *k.ReviewerNote
	}
	return KYBQueueItem{
		PropertyID: k.PropertyID, PropertyName: propertyName, City: city,
		LegalName: k.LegalName, BusinessType: k.BusinessType,
		RCNumberMasked: maskRC(k.RCNumber), HasTIN: k.TIN != "",
		DirectorMasked: maskPersonName(k.DirectorName), DirectorBVNLast4: bvnLast4(k.DirectorBVN),
		KYCStatus: kyc, BusinessDocStatus: doc, Status: st,
		SubmittedAt: k.SubmittedForReviewAt, ReviewedAt: k.ReviewedAt, ReviewerNote: note,
	}
}

// ListKYBQueue returns KYB rows (optionally one status), oldest submission first
// so the queue is worked FIFO. Capped: this is a review queue, not an export.
func (r *Repository) ListKYBQueue(ctx context.Context, status string) ([]KYBQueueItem, error) {
	rows, err := r.db.Query(ctx, `
		SELECT k.property_id, COALESCE(p.name,''), COALESCE(p.city,''),
		       COALESCE(k.legal_name,''), k.business_type, k.rc_number, k.tin,
		       k.director_name, k.director_bvn,
		       k.kyc_status, k.business_doc_status, k.status,
		       k.submitted_for_review_at, k.reviewed_at, k.reviewer_note
		FROM public.stays_hotelier_kyb k
		LEFT JOIN public.stays_property p ON p.id = k.property_id
		WHERE ($1 = '' OR k.status = $1)
		ORDER BY k.submitted_for_review_at ASC NULLS LAST, k.created_at ASC
		LIMIT 200`, status)
	if err != nil {
		return nil, fmt.Errorf("extranet: list kyb queue: %w", err)
	}
	defer rows.Close()
	out := []KYBQueueItem{}
	for rows.Next() {
		var k kyb
		var name, city string
		var bt, rc, tin, dn, bvn *string
		if err := rows.Scan(&k.PropertyID, &name, &city, &k.LegalName, &bt, &rc, &tin, &dn, &bvn,
			&k.KYCStatus, &k.BusinessDocStatus, &k.Status,
			&k.SubmittedForReviewAt, &k.ReviewedAt, &k.ReviewerNote); err != nil {
			return nil, fmt.Errorf("extranet: scan kyb queue: %w", err)
		}
		k.BusinessType, k.RCNumber, k.TIN = dbutil.DerefString(bt), dbutil.DerefString(rc), dbutil.DerefString(tin)
		k.DirectorName, k.DirectorBVN = dbutil.DerefString(dn), dbutil.DerefString(bvn)
		out = append(out, toKYBQueueItem(k, name, city))
	}
	return out, rows.Err()
}

// AdminListKYB (admin): GET /kyb?status= — the KYB review queue.
func (h *Handler) AdminListKYB(c *gin.Context) {
	status := c.Query("status")
	if !validKYBListStatus(status) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "unknown status filter"})
		return
	}
	out, err := h.svc.repo.ListKYBQueue(c.Request.Context(), status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}
