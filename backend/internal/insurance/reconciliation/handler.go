package reconciliation

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the admin reconciliation workbench + commission ledger view.
type Handler struct {
	svc *Service
}

// NewHandler constructs the reconciliation handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	case errors.Is(err, ErrAlreadyReversed):
		c.JSON(http.StatusConflict, gin.H{"error": "already_reversed"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// MatchStatement (admin): POST /reconciliation/match
// body: {provider, lines:[{policy_id, statement_ref, amount_kobo}]}
func (h *Handler) MatchStatement(c *gin.Context) {
	var body struct {
		Provider string          `json:"provider" binding:"required"`
		Lines    []StatementLine `json:"lines" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	recs, err := h.svc.MatchStatement(c.Request.Context(), body.Provider, body.Lines)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": recs})
}

// ListRecords (admin): GET /reconciliation?status=&provider=
func (h *Handler) ListRecords(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	recs, err := h.svc.ListRecords(c.Request.Context(), c.Query("status"), c.Query("provider"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": recs})
}

// ResolveBreak (admin): POST /reconciliation/:id/resolve {note}
func (h *Handler) ResolveBreak(c *gin.Context) {
	var body struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.ResolveBreak(c.Request.Context(), c.Param("id"), body.Note); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"resolved": true}})
}

// ConfirmCommission (admin): POST /commission/:policy_id/confirm
func (h *Handler) ConfirmCommission(c *gin.Context) {
	ce, err := h.svc.ConfirmCommission(c.Request.Context(), c.Param("policy_id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ce})
}

// ReverseCommission (admin): POST /commission/:policy_id/reverse {reason}
func (h *Handler) ReverseCommission(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	ce, err := h.svc.ReverseCommission(c.Request.Context(), c.Param("policy_id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ce})
}

// ListCommission (admin): GET /commission?status=&provider= — commission ledger view.
func (h *Handler) ListCommission(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	entries, err := h.svc.ListCommission(c.Request.Context(), c.Query("status"), c.Query("provider"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	total, _ := h.svc.CommissionSummary(c.Request.Context(), c.Query("status"), c.Query("provider"))
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"entries": entries, "total_kobo": total}})
}
