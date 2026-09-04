package extranet

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// RegisterAdmin wires the ops KYB review route onto the admin group. guard is the
// per-route RBAC middleware factory the aggregator supplies. Reuses the existing
// stays.admin.hotelier permission ("Approve/suspend hotelier profiles + grants") —
// deciding a property's business verification is exactly that.
func (h *Handler) RegisterAdmin(g *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	g.POST("/hoteliers/:propertyId/kyb/decision", guard("stays.admin.hotelier"), h.AdminDecideKYB)
}

// GetVerificationStatus: GET /verification — the caller's go-live checklist.
func (h *Handler) GetVerificationStatus(c *gin.Context) {
	out, err := h.svc.GetVerificationStatus(c.Request.Context(), uid(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetBusinessVerification: GET /verification/business — the caller's KYC record.
func (h *Handler) GetBusinessVerification(c *gin.Context) {
	out, err := h.svc.GetBusinessVerification(c.Request.Context(), uid(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// SubmitForReview: POST /verification/submit — re-validates required checklist
// items server-side (the frontend's own gate is convenience only) before moving
// the record to 'submitted'.
func (h *Handler) SubmitForReview(c *gin.Context) {
	out, err := h.svc.SubmitForReview(c.Request.Context(), uid(c))
	if err != nil {
		if errors.Is(err, ErrVerificationIncomplete) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminDecideKYB (admin): POST /hoteliers/:propertyId/kyb/decision
// {legal_name, business_type, rc_number, tin, director_name, director_bvn,
//
//	contact_email, contact_phone, decision, note}. decision: approve|reject|needs_changes.
func (h *Handler) AdminDecideKYB(c *gin.Context) {
	var b struct {
		LegalName    string `json:"legal_name"`
		BusinessType string `json:"business_type"`
		RCNumber     string `json:"rc_number"`
		TIN          string `json:"tin"`
		DirectorName string `json:"director_name"`
		DirectorBVN  string `json:"director_bvn"`
		ContactEmail string `json:"contact_email"`
		ContactPhone string `json:"contact_phone"`
		Decision     string `json:"decision" binding:"required"`
		Note         string `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AdminDecideKYB(c.Request.Context(), c.Param("propertyId"), uid(c),
		BusinessVerificationInput{
			LegalName: b.LegalName, BusinessType: b.BusinessType, RCNumber: b.RCNumber, TIN: b.TIN,
			DirectorName: b.DirectorName, DirectorBVN: b.DirectorBVN,
			ContactEmail: b.ContactEmail, ContactPhone: b.ContactPhone,
		}, b.Decision, b.Note)
	if err != nil {
		if errors.Is(err, ErrBadDecision) || errors.Is(err, ErrDecisionNoteRequired) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
