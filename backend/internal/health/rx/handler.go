package healthrx

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }
func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// Issue — POST /prescriptions  (vet/clinician)
func (h *Handler) Issue(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		PatientID      string  `json:"patient_id"`
		ConsultID      *string `json:"consult_id"`
		Items          []Item  `json:"items"`
		OverrideReason string  `json:"override_reason"` // documents proceeding past a safety hard stop (RX-011)
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	// Human path: the injected ClinicalContextProvider supplies allergies/meds; a
	// hard stop blocks unless override_reason is provided (audited).
	p, err := h.svc.IssueChecked(c.Request.Context(), id, req.PatientID, req.ConsultID, req.Items, nil, req.OverrideReason)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "prescription": p})
}

// Get — GET /prescriptions/:id
func (h *Handler) Get(c *gin.Context) {
	p, err := h.svc.Get(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescription": p})
}

// Send — POST /prescriptions/:id/send  { pharmacy_provider_id }
func (h *Handler) Send(c *gin.Context) {
	var req struct {
		PharmacyProviderID string `json:"pharmacy_provider_id"`
	}
	_ = c.ShouldBindJSON(&req)
	p, err := h.svc.SendToPharmacy(c.Request.Context(), uid(c), c.Param("id"), req.PharmacyProviderID)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescription": p})
}

// Verify — POST /prescriptions/:id/verify  { approve, reason }  (pharmacist, HL-3)
func (h *Handler) Verify(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Begin   bool   `json:"begin"` // true → move SENT→VERIFYING first
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Begin {
		if _, err := h.svc.BeginVerify(c.Request.Context(), id, c.Param("id")); err != nil {
			fail(c, http.StatusConflict, err.Error())
			return
		}
	}
	p, err := h.svc.Verify(c.Request.Context(), id, c.Param("id"), req.Approve, req.Reason)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescription": p})
}

// Dispense — POST /prescriptions/:id/dispense  (pharmacist, HL-3 dispense-once)
func (h *Handler) Dispense(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	p, err := h.svc.Dispense(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescription": p})
}
