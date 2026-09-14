package telemedicine

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ─── Specialties ─────────────────────────────────────────────────────────────

func (h *Handler) ListSpecialties(c *gin.Context) {
	specialties, err := h.svc.ListSpecialties(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": specialties})
}

// ─── Doctors ─────────────────────────────────────────────────────────────────

func (h *Handler) RegisterDoctor(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RegisterDoctorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.RegisterDoctor(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) RegisterDoctorV2(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RegisterDoctorV2Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.RegisterDoctorV2(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"doctor_id": d.ID}})
}

func (h *Handler) ListDoctors(c *gin.Context) {
	var q ListDoctorsQuery
	q.SpecialtyID = c.Query("specialty_id")
	if q.SpecialtyID == "" {
		q.SpecialtyID = c.Query("specialty") // accept both param names
	}
	q.Search = c.Query("search")
	q.AvailableNow = c.Query("available_now") == "true"
	q.TopRated = c.Query("top_rated") == "true"
	if me, err := strconv.Atoi(c.Query("min_experience")); err == nil {
		q.MinExperience = me
	}
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil {
		q.Limit = l
	}
	if o, err := strconv.Atoi(c.DefaultQuery("offset", "0")); err == nil {
		q.Offset = o
	}

	doctors, err := h.svc.ListDoctors(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": doctors})
}

func (h *Handler) GetDoctor(c *gin.Context) {
	doctor, err := h.svc.GetDoctor(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": doctor})
}

func (h *Handler) ToggleAvailability(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ToggleAvailabilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ToggleDoctorAvailability(c.Request.Context(), userID, req.IsOnline); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) GetDoctorDashboard(c *gin.Context) {
	userID := c.GetString("user_id")
	dash, err := h.svc.GetDoctorDashboard(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": dash})
}

// ─── Appointments ────────────────────────────────────────────────────────────

func (h *Handler) BookAppointment(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BookAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Accept Idempotency-Key from header OR body.
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	appt, err := h.svc.BookAppointment(c.Request.Context(), userID, req)
	if err != nil {
		// A stale client quote is a conflict, not a server fault: no money moved,
		// and the fix is to re-read the doctor's booking quote — not to retry the
		// same amount (ADR-044).
		if errors.Is(err, ErrQuoteMismatch) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": appt})
}

func (h *Handler) ListMyAppointments(c *gin.Context) {
	userID := c.GetString("user_id")
	filter := c.Query("filter") // "upcoming" | "past" | ""
	appts, err := h.svc.ListMyAppointments(c.Request.Context(), userID, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": appts})
}

func (h *Handler) GetAppointment(c *gin.Context) {
	userID := c.GetString("user_id")
	appt, err := h.svc.GetAppointment(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": appt})
}

func (h *Handler) CompleteAppointment(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.CompleteAppointment(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) CancelAppointment(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.CancelAppointment(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) IssuePrescription(c *gin.Context) {
	userID := c.GetString("user_id")
	var req IssuePrescriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.IssuePrescription(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// GetPrescription reads back the prescription issued for an appointment
// (GET /appointments/:id/prescription). Object-level authZ enforced in the
// service layer (patient or assigned doctor only).
func (h *Handler) GetPrescription(c *gin.Context) {
	userID := c.GetString("user_id")
	p, err := h.svc.GetPrescription(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// ─── SOAP Notes ──────────────────────────────────────────────────────────────

func (h *Handler) SubmitSOAPNote(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SubmitSOAPNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	note, err := h.svc.SubmitSOAPNote(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": note})
}

// ─── Licence Documents ───────────────────────────────────────────────────────

func (h *Handler) UploadLicenceDoc(c *gin.Context) {
	userID := c.GetString("user_id")
	var req UploadLicenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	doc, err := h.svc.UploadLicenceDoc(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"upload_id": doc.ID}})
}
