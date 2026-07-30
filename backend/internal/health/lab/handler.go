package healthlab

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the HEALTH-BUILD §6 Laboratory API. AuthN is the finance auth
// chain (user_id mirrored onto the gin context); per-route RBAC + object-level
// authZ is applied here and in the service. isAdmin reports the caller's health
// lab admin permission (drives admin-basis reads).
type Handler struct {
	svc     *Service
	isAdmin func(c *gin.Context) bool
}

func NewHandler(svc *Service, isAdmin func(c *gin.Context) bool) *Handler {
	if isAdmin == nil {
		isAdmin = func(c *gin.Context) bool { return false }
	}
	return &Handler{svc: svc, isAdmin: isAdmin}
}

func uid(c *gin.Context) string { return c.GetString("user_id") }

func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// ListTests — GET /tests?lab_provider_id=  (catalog: prep, TAT, price)
func (h *Handler) ListTests(c *gin.Context) {
	tests, err := h.svc.ListTests(c.Request.Context(), c.Query("lab_provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tests": tests})
}

// UpsertTest — POST /tests  (lab owner, HL-2 catalog governance)
func (h *Handler) UpsertTest(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var t Test
	if err := c.ShouldBindJSON(&t); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.UpsertTest(c.Request.Context(), id, t)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "test": out})
}

// CreateOrder — POST /orders  (patient, payment HELD, HL-9)
func (h *Handler) CreateOrder(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		LabProviderID    string   `json:"lab_provider_id"`
		CollectionMethod string   `json:"collection_method"`
		IdempotencyKey   string   `json:"idempotency_key"`
		TestIDs          []string `json:"test_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	idem := req.IdempotencyKey
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		idem = hk
	}
	in := CreateOrderInput{
		LabProviderID:    req.LabProviderID,
		CollectionMethod: CollectionMethod(req.CollectionMethod),
		IdempotencyKey:   idem,
		TestIDs:          req.TestIDs,
	}
	o, err := h.svc.CreateOrder(c.Request.Context(), id, in)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "order": o})
}

// Schedule — POST /orders/:id/schedule  (phlebotomist dispatch for HOME)
func (h *Handler) Schedule(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	o, err := h.svc.Schedule(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Collect — POST /orders/:id/collect  (phlebotomist: sample + custody, HL-6)
func (h *Handler) Collect(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Collect(c.Request.Context(), id, c.Param("id"), req.Note)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "sample": sample})
}

// Handover — POST /samples/:id/handover  (custody transfer, HL-6)
func (h *Handler) Handover(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		ToCustodianID string `json:"to_custodian_id"`
		Note          string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Handover(c.Request.Context(), id, c.Param("id"), req.ToCustodianID, req.Note)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sample": sample})
}

// FlagBreach — POST /samples/:id/breach  (chain break → recollect, HL-6)
func (h *Handler) FlagBreach(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.FlagBreach(c.Request.Context(), id, c.Param("id"), req.Reason)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sample": sample})
}

// Accession — POST /samples/:id/accession  (lab intake, HL-6 chain gate)
func (h *Handler) Accession(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Note           string `json:"note"`
		ScannedBarcode string `json:"scanned_barcode"` // EC-001: verified against the sample's minted barcode
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Accession(c.Request.Context(), id, c.Param("id"), req.ScannedBarcode, req.Note)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sample": sample})
}

// EnterResults — POST /orders/:id/results  (scientist enter + validate, HL-7)
func (h *Handler) EnterResults(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		ScannedBarcode string `json:"scanned_barcode"` // LR-001: verified against this order's sample
		Results        []struct {
			TestID   string `json:"test_id"`
			Value    string `json:"value"`
			Unit     string `json:"unit"`
			RefRange string `json:"ref_range"`
			Status   string `json:"status"`
		} `json:"results"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	in := make([]EnterResultInput, 0, len(req.Results))
	for _, r := range req.Results {
		in = append(in, EnterResultInput{
			TestID: r.TestID, Value: r.Value, Unit: r.Unit, RefRange: r.RefRange, Status: ResultStatus(r.Status),
		})
	}
	o, err := h.svc.EnterResults(c.Request.Context(), id, c.Param("id"), req.ScannedBarcode, in)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Release — POST /orders/:id/release  (scientist sign-off → vault; release payment, HL-7/8/9)
func (h *Handler) Release(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	o, err := h.svc.Release(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Cancel — POST /orders/:id/cancel  (patient, pre-collection → refund, HL-9)
func (h *Handler) Cancel(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	o, err := h.svc.Cancel(c.Request.Context(), id, c.Param("id"), req.Reason)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Get — GET /orders/:id  (object-level authZ: patient / lab / admin)
func (h *Handler) Get(c *gin.Context) {
	o, err := h.svc.Get(c.Request.Context(), uid(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Results — GET /orders/:id/results  (object-level authZ, HL-8)
func (h *Handler) Results(c *gin.Context) {
	rows, err := h.svc.Results(c.Request.Context(), uid(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": rows})
}

// Custody — GET /orders/:id/custody  (chain-of-custody trail, HL-6/12)
func (h *Handler) Custody(c *gin.Context) {
	rows, err := h.svc.CustodyTrail(c.Request.Context(), uid(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "custody": rows})
}

// ─── Admin handlers (RBAC health.lab.* applied at route registration) ────────

// AdminListOrders — GET /admin/orders  order/results oversight.
func (h *Handler) AdminListOrders(c *gin.Context) {
	rows, err := h.svc.AdminListOrders(c.Request.Context(), c.Query("state"), c.Query("lab_provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": rows})
}

// AdminCustodyAudit — GET /admin/custody-audit  chain-of-custody oversight (HL-6/12).
func (h *Handler) AdminCustodyAudit(c *gin.Context) {
	rows, err := h.svc.AdminCustodyAudit(c.Request.Context(), c.Query("lab_provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": rows})
}

// AdminEscalations — GET /admin/escalations  critical-result escalation oversight (HL-7).
func (h *Handler) AdminEscalations(c *gin.Context) {
	rows, err := h.svc.AdminEscalations(c.Request.Context(), c.Query("lab_provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalations": rows})
}

// AdminDeactivateTest — POST /admin/tests/:id/deactivate  catalog governance.
func (h *Handler) AdminDeactivateTest(c *gin.Context) {
	if err := h.svc.AdminDeactivateTest(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
