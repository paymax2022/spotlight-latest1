package estate

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"

	"spotlight/backend/go-common/httperr"
)

func (h *Handler) CreateInvoice(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req CreateInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	inv, err := h.svc.CreateInvoice(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		// The dues exemptions (EST-UAT-0048, 0045) and the override-reason rule are refused states of
		// the estate's own billing rules, not authorisation failures: an override that waives them in
		// writing succeeds, an incomplete one is a caller mistake, and an unwaived one is a conflict.
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, inv)
}

func (h *Handler) ListInvoices(c *gin.Context) {
	userID := ginutil.UserID(c)
	invs, err := h.svc.ListInvoices(c.Request.Context(), c.Param("id"), userID, c.Query(keyStatus))
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": invs})
}

// PayDues settles a dues invoice. Requires the Idempotency-Key header (money rule).
func (h *Handler) PayDues(c *gin.Context) {
	payerID := ginutil.UserID(c)
	var body struct {
		Method     string `json:"method"`
		AmountKobo int64  `json:"amount_kobo"`
	}
	_ = c.ShouldBindJSON(&body)
	req := PayDuesRequest{
		InvoiceID:      c.Param("invoiceId"),
		IdempotencyKey: ginutil.IdempotencyKey(c),
		Method:         body.Method,
		AmountKobo:     body.AmountKobo,
	}
	pay, err := h.svc.PayDues(c.Request.Context(), c.Param("id"), payerID, req)
	if err != nil {
		duesErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, pay)
}

var duesErrMap = httperr.New(http.StatusConflict,
	httperr.R(http.StatusBadRequest, ErrIdempotencyRequired),
	httperr.R(http.StatusServiceUnavailable, ErrLedgerUnavailable, ErrLedgerReconPending),
)

func (h *Handler) ApplyRestriction(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req ApplyRestrictionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	r, err := h.svc.ApplyRestriction(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) LiftRestriction(c *gin.Context) {
	adminID := ginutil.UserID(c)
	if err := h.svc.LiftRestriction(c.Request.Context(), c.Param("id"), adminID, c.Param("residentId")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"lifted": true})
}

func (h *Handler) CreateTask(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	t, err := h.svc.CreateTask(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (h *Handler) ListTasks(c *gin.Context) {
	userID := ginutil.UserID(c)
	tasks, err := h.svc.ListTasks(c.Request.Context(), c.Param("id"), userID, c.Query(keyStatus))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tasks})
}

func (h *Handler) UpdateTaskStatus(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req UpdateTaskStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.UpdateTaskStatus(c.Request.Context(), c.Param("id"), userID, c.Param("taskId"), req.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyStatus: req.Status})
}

func (h *Handler) CreateRepair(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CreateRepairRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	r, err := h.svc.CreateRepair(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) ListRepairs(c *gin.Context) {
	userID := ginutil.UserID(c)
	repairs, err := h.svc.ListRepairs(c.Request.Context(), c.Param("id"), userID, c.Query(keyStatus))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": repairs})
}

func (h *Handler) AddRepairUpdate(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req AddRepairUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	u, err := h.svc.AddRepairUpdate(c.Request.Context(), c.Param("id"), userID, c.Param("repairId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, u)
}

func (h *Handler) ListRepairUpdates(c *gin.Context) {
	userID := ginutil.UserID(c)
	ups, err := h.svc.ListRepairUpdates(c.Request.Context(), c.Param("id"), userID, c.Param("repairId"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ups})
}

func (h *Handler) CreateFacility(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req CreateFacilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	f, err := h.svc.CreateFacility(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, f)
}

func (h *Handler) ListFacilities(c *gin.Context) {
	userID := ginutil.UserID(c)
	fs, err := h.svc.ListFacilities(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": fs})
}

func (h *Handler) UpdateFacility(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req UpdateFacilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	f, err := h.svc.UpdateFacility(c.Request.Context(), c.Param("id"), adminID, c.Param("facilityId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, f)
}

func (h *Handler) BookFacility(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req BookFacilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	b, err := h.svc.BookFacility(c.Request.Context(), c.Param("id"), userID, c.Param("facilityId"), req)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
		return
	}
	c.JSON(http.StatusCreated, b)
}

func (h *Handler) ListMyBookings(c *gin.Context) {
	userID := ginutil.UserID(c)
	bs, err := h.svc.ListMyBookings(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bs})
}

func (h *Handler) CreateAnnouncement(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req CreateAnnouncementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	a, err := h.svc.CreateAnnouncement(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) ListAnnouncements(c *gin.Context) {
	userID := ginutil.UserID(c)
	as, err := h.svc.ListAnnouncements(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": as})
}

func (h *Handler) MarkAnnouncementRead(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.MarkAnnouncementRead(c.Request.Context(), c.Param("id"), userID, c.Param("annId")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"read": true})
}

func (h *Handler) RaiseEmergency(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req RaiseEmergencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	a, err := h.svc.RaiseEmergency(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) ListEmergencies(c *gin.Context) {
	userID := ginutil.UserID(c)
	as, err := h.svc.ListEmergencies(c.Request.Context(), c.Param("id"), userID, c.Query(keyStatus))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": as})
}

func (h *Handler) UpdateEmergencyStatus(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req UpdateEmergencyStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.UpdateEmergencyStatus(c.Request.Context(), c.Param("id"), adminID, c.Param("alertId"), req.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyStatus: req.Status})
}

func (h *Handler) CreateDocument(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req CreateDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.CreateDocument(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) ListDocuments(c *gin.Context) {
	userID := ginutil.UserID(c)
	ds, err := h.svc.ListDocuments(c.Request.Context(), c.Param("id"), userID, c.Query("category"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ds})
}

func (h *Handler) CreateVendor(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req CreateVendorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	v, err := h.svc.CreateVendor(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *Handler) ListVendors(c *gin.Context) {
	userID := ginutil.UserID(c)
	vs, err := h.svc.ListVendors(c.Request.Context(), c.Param("id"), userID, c.Query(keyStatus))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vs})
}

func (h *Handler) VerifyVendor(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.VerifyVendor(c.Request.Context(), c.Param("id"), adminID, c.Param("vendorId"), body.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyStatus: body.Status})
}

func (h *Handler) FinanceDashboard(c *gin.Context) {
	adminID := ginutil.UserID(c)
	d, err := h.svc.FinanceDashboard(c.Request.Context(), c.Param("id"), adminID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, d)
}

// Notifications moved to notifications_retention_handler.go (EST-UAT-0359): the route is the same, the
// handler now parses the state/category/search/paging filters the case asked for.

func (h *Handler) Report(c *gin.Context) {
	adminID := ginutil.UserID(c)
	r, err := h.svc.Report(c.Request.Context(), c.Param("id"), adminID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, r)
}

// RemindMeeting notifies members who have not RSVP'd (EST-UAT-0351).
func (h *Handler) RemindMeeting(c *gin.Context) {
	adminID := ginutil.UserID(c)
	n, err := h.svc.SendMeetingReminder(c.Request.Context(), c.Param("id"), adminID, c.Param("mid"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyReminded: n})
}

// RemindElection notifies residents who have not yet voted (EST-UAT-0352).
func (h *Handler) RemindElection(c *gin.Context) {
	adminID := ginutil.UserID(c)
	n, err := h.svc.SendElectionReminders(c.Request.Context(), c.Param("id"), adminID, c.Param("electionId"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyReminded: n})
}
