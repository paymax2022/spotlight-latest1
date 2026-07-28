package doctor

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// handler_mdcn_review.go — admin (ops) HTTP surface for assisted MDCN doctor
// verification review. Mounted under an RBAC-gated admin group (health.doctor.review);
// the service additionally forbids self-approval.

type MDCNReviewHandler struct{ svc *MDCNReviewService }

func NewMDCNReviewHandler(svc *MDCNReviewService) *MDCNReviewHandler {
	return &MDCNReviewHandler{svc: svc}
}

func reviewStatus(err error) int {
	switch {
	case errors.Is(err, ErrReviewForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrReviewIllegalTransition):
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}

// Queue GET /verification/queue
func (h *MDCNReviewHandler) Queue(c *gin.Context) {
	items, err := h.svc.ListQueue(c.Request.Context(), 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// GetRecord GET /verification/:verificationId
func (h *MDCNReviewHandler) GetRecord(c *gin.Context) {
	rec, err := h.svc.GetForReview(c.Request.Context(), c.Param("verificationId"))
	if err != nil {
		c.JSON(reviewStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// DocURL GET /verification/documents/:docId/url — reviewer signed URL (access-logged).
func (h *MDCNReviewHandler) DocURL(c *gin.Context) {
	uid := c.GetString("user_id")
	url, err := h.svc.DocSignedURL(c.Request.Context(), uid, c.Param("docId"), true)
	if err != nil {
		c.JSON(reviewStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url})
}

// Decide POST /verification/:verificationId/decision
func (h *MDCNReviewHandler) Decide(c *gin.Context) {
	uid := c.GetString("user_id")
	var body struct {
		Action        string `json:"action" binding:"required"` // approve | need_info | reject
		LicenceExpiry string `json:"licence_expiry"`            // YYYY-MM-DD (required for approve)
		Discipline    string `json:"discipline"`                // medical | dental (required for approve)
		Notes         string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in := MDCNDecision{Action: body.Action, Notes: body.Notes}
	if body.LicenceExpiry != "" {
		t, perr := time.Parse("2006-01-02", body.LicenceExpiry)
		if perr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "licence_expiry must be YYYY-MM-DD"})
			return
		}
		in.LicenceExpiry = &t
	}
	if body.Discipline != "" {
		in.Discipline = &body.Discipline
	}
	rec, err := h.svc.Decide(c.Request.Context(), uid, c.Param("verificationId"), in)
	if err != nil {
		c.JSON(reviewStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}
