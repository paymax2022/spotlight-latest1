package estate

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ── Block 29: Dues / Rent money path ─────────────────────────────────────────

func (h *Handler) CreateInvoice(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CreateInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inv, err := h.svc.CreateInvoice(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, inv)
}

func (h *Handler) ListInvoices(c *gin.Context) {
	userID := c.GetString("user_id")
	invs, err := h.svc.ListInvoices(c.Request.Context(), c.Param("id"), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": invs})
}

// PayDues settles a dues invoice. Requires the Idempotency-Key header (money rule).
func (h *Handler) PayDues(c *gin.Context) {
	payerID := c.GetString("user_id")
	var body struct {
		Method     string `json:"method"`
		AmountKobo int64  `json:"amount_kobo"`
	}
	_ = c.ShouldBindJSON(&body)
	req := PayDuesRequest{
		InvoiceID:      c.Param("invoiceId"),
		IdempotencyKey: c.GetHeader("Idempotency-Key"),
		Method:         body.Method,
		AmountKobo:     body.AmountKobo,
	}
	pay, err := h.svc.PayDues(c.Request.Context(), c.Param("id"), payerID, req)
	if err != nil {
		c.JSON(payDuesStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, pay)
}

func payDuesStatus(err error) int {
	switch {
	case errors.Is(err, ErrIdempotencyRequired):
		return http.StatusBadRequest
	case errors.Is(err, ErrLedgerUnavailable):
		return http.StatusServiceUnavailable
	default:
		return http.StatusConflict
	}
}

func (h *Handler) ApplyRestriction(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ApplyRestrictionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.ApplyRestriction(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) LiftRestriction(c *gin.Context) {
	adminID := c.GetString("user_id")
	if err := h.svc.LiftRestriction(c.Request.Context(), c.Param("id"), adminID, c.Param("residentId")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"lifted": true})
}

// ── Block 31: Tasks ──────────────────────────────────────────────────────────

func (h *Handler) CreateTask(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.CreateTask(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (h *Handler) ListTasks(c *gin.Context) {
	userID := c.GetString("user_id")
	tasks, err := h.svc.ListTasks(c.Request.Context(), c.Param("id"), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tasks})
}

func (h *Handler) UpdateTaskStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	var req UpdateTaskStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateTaskStatus(c.Request.Context(), c.Param("id"), userID, c.Param("taskId"), req.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": req.Status})
}

// ── Block 32: Maintenance / Repairs ──────────────────────────────────────────

func (h *Handler) CreateRepair(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateRepairRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.CreateRepair(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) ListRepairs(c *gin.Context) {
	userID := c.GetString("user_id")
	repairs, err := h.svc.ListRepairs(c.Request.Context(), c.Param("id"), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": repairs})
}

func (h *Handler) AddRepairUpdate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AddRepairUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	u, err := h.svc.AddRepairUpdate(c.Request.Context(), c.Param("id"), userID, c.Param("repairId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, u)
}

func (h *Handler) ListRepairUpdates(c *gin.Context) {
	userID := c.GetString("user_id")
	ups, err := h.svc.ListRepairUpdates(c.Request.Context(), c.Param("id"), userID, c.Param("repairId"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ups})
}

// ── Block 33: Facilities / Amenities ─────────────────────────────────────────

func (h *Handler) CreateFacility(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CreateFacilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	f, err := h.svc.CreateFacility(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, f)
}

func (h *Handler) ListFacilities(c *gin.Context) {
	userID := c.GetString("user_id")
	fs, err := h.svc.ListFacilities(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": fs})
}

func (h *Handler) BookFacility(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BookFacilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.BookFacility(c.Request.Context(), c.Param("id"), userID, c.Param("facilityId"), req)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, b)
}

func (h *Handler) ListMyBookings(c *gin.Context) {
	userID := c.GetString("user_id")
	bs, err := h.svc.ListMyBookings(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bs})
}

// ── Block 34: Announcements ──────────────────────────────────────────────────

func (h *Handler) CreateAnnouncement(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CreateAnnouncementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.CreateAnnouncement(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) ListAnnouncements(c *gin.Context) {
	userID := c.GetString("user_id")
	as, err := h.svc.ListAnnouncements(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": as})
}

func (h *Handler) MarkAnnouncementRead(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.MarkAnnouncementRead(c.Request.Context(), c.Param("id"), userID, c.Param("annId")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"read": true})
}

// ── Block 35: Emergencies ────────────────────────────────────────────────────

func (h *Handler) RaiseEmergency(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RaiseEmergencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.RaiseEmergency(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) ListEmergencies(c *gin.Context) {
	userID := c.GetString("user_id")
	as, err := h.svc.ListEmergencies(c.Request.Context(), c.Param("id"), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": as})
}

func (h *Handler) UpdateEmergencyStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req UpdateEmergencyStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateEmergencyStatus(c.Request.Context(), c.Param("id"), adminID, c.Param("alertId"), req.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": req.Status})
}

// ── Block 36: Documents ──────────────────────────────────────────────────────

func (h *Handler) CreateDocument(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CreateDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.CreateDocument(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) ListDocuments(c *gin.Context) {
	userID := c.GetString("user_id")
	ds, err := h.svc.ListDocuments(c.Request.Context(), c.Param("id"), userID, c.Query("category"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ds})
}

// ── Block 37: Vendors ────────────────────────────────────────────────────────

func (h *Handler) CreateVendor(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CreateVendorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.CreateVendor(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *Handler) ListVendors(c *gin.Context) {
	userID := c.GetString("user_id")
	vs, err := h.svc.ListVendors(c.Request.Context(), c.Param("id"), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vs})
}

func (h *Handler) VerifyVendor(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.VerifyVendor(c.Request.Context(), c.Param("id"), adminID, c.Param("vendorId"), body.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": body.Status})
}

// ── Block 40/43/44: aggregates ───────────────────────────────────────────────

func (h *Handler) FinanceDashboard(c *gin.Context) {
	adminID := c.GetString("user_id")
	d, err := h.svc.FinanceDashboard(c.Request.Context(), c.Param("id"), adminID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *Handler) Notifications(c *gin.Context) {
	userID := c.GetString("user_id")
	ns, err := h.svc.Notifications(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ns})
}

func (h *Handler) Report(c *gin.Context) {
	adminID := c.GetString("user_id")
	r, err := h.svc.Report(c.Request.Context(), c.Param("id"), adminID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}
