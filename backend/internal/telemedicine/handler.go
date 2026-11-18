package telemedicine

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/platform/r2"
)

type Handler struct {
	svc           *Service
	presigner     *r2.Presigner
	presignBucket string
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithPresigner enables patient-facing photo reads. Without it (or with R2 env
// absent) avatars stay exactly as stored, which is the pre-existing behaviour.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// avatarViewTTL bounds how long a signed patient-facing photo link stays live.
// The link is handed to whoever can read the directory, so it expires; the
// doctor's own provider header uses the same window (internal/doctor).
const avatarViewTTL = 10 * time.Minute

// resolveMedia turns a stored doctors.avatar_url into something a client can
// render: an R2 object key becomes a short-lived signed GET, an absolute URL is
// returned as it is, and anything that cannot be signed (no creds, unconfigured
// bucket, signing error) is returned unchanged rather than failing the read.
// The bucket is private — R2_PUBLIC_BASE_URL is unset — so an unsigned key is
// exactly what left the doctor profile showing initials where a photo should be.
func (h *Handler) resolveMedia(stored string) string {
	if stored == "" || strings.Contains(stored, "://") {
		return stored
	}
	if h.presigner == nil || !h.presigner.Configured() {
		return stored
	}
	signed, err := h.presigner.PresignGet(stored, avatarViewTTL)
	if err != nil {
		return stored
	}
	return signed
}

// viewableAvatar signs one doctor's photo in place. A nil AvatarURL — the common
// case, since the column is nullable — stays nil, so a doctor who never uploaded
// a photo keeps rendering initials instead of a broken image.
func (h *Handler) viewableAvatar(d *Doctor) {
	if d == nil || d.AvatarURL == nil {
		return
	}
	viewable := h.resolveMedia(*d.AvatarURL)
	d.AvatarURL = &viewable
}

func (h *Handler) ListSpecialties(c *gin.Context) {
	specialties, err := h.svc.ListSpecialties(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": specialties})
}

func (h *Handler) RegisterDoctor(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req RegisterDoctorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.RegisterDoctor(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) RegisterDoctorV2(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req RegisterDoctorV2Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.RegisterDoctorV2(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
	// min_rating is a float ("4.5"), unlike the int filters above.
	if mr, err := strconv.ParseFloat(c.Query("min_rating"), 64); err == nil {
		q.MinRating = mr
	}
	q.Featured = c.Query("featured") == "true"
	q.Limit, q.Offset = ginutil.PageParams(c, 20, 0)

	doctors, err := h.svc.ListDoctors(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	for i := range doctors {
		h.viewableAvatar(&doctors[i])
	}
	c.JSON(http.StatusOK, gin.H{"data": doctors})
}

func (h *Handler) GetDoctor(c *gin.Context) {
	doctor, err := h.svc.GetDoctor(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	}
	h.viewableAvatar(doctor)
	c.JSON(http.StatusOK, gin.H{"data": doctor})
}

func (h *Handler) ToggleAvailability(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req ToggleAvailabilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.ToggleDoctorAvailability(c.Request.Context(), userID, req.IsOnline); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) GetDoctorDashboard(c *gin.Context) {
	userID := ginutil.UserID(c)
	dash, err := h.svc.GetDoctorDashboard(c.Request.Context(), userID)
	if err != nil {
		// A caller with no doctor profile gets 404 — there is no dashboard for
		// them. Before this, the not-found path returned a bare error that the
		// blanket 500 mapping surfaced as a server outage.
		if errors.Is(err, ErrDoctorNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": dash})
}

func (h *Handler) BookAppointment(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req BookAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// Accept Idempotency-Key from header OR body. The body field is not
	// binding-required (model.go) precisely so the header path is reachable;
	// the merge below is the single presence check — a money mutation that
	// cannot dedupe itself must not run.
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = ginutil.IdempotencyKey(c)
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key required"})
		return
	}
	appt, err := h.svc.BookAppointment(c.Request.Context(), userID, req)
	if err != nil {
		// A stale client quote is a conflict, not a server fault: no money moved,
		// and the fix is to re-read the doctor's booking quote — not to retry the
		// same amount (ADR-044).
		switch {
		case errors.Is(err, ErrQuoteMismatch):
			c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
			return
		case errors.Is(err, ErrDoctorNotFound):
			// A doctor_id that resolves to nothing is a client error (404), not a
			// server fault — previously indistinguishable from a real outage.
			c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
			return
		case errors.Is(err, ErrPackageRequired), errors.Is(err, ErrPackageInvalid),
			errors.Is(err, ErrConsultModeInvalid):
			c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": appt})
}

func (h *Handler) ListMyAppointments(c *gin.Context) {
	userID := ginutil.UserID(c)
	filter := c.Query("filter") // "upcoming" | "past" | ""
	appts, err := h.svc.ListMyAppointments(c.Request.Context(), userID, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": appts})
}

func (h *Handler) GetAppointment(c *gin.Context) {
	userID := ginutil.UserID(c)
	appt, err := h.svc.GetAppointment(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": appt})
}

func (h *Handler) CompleteAppointment(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.CompleteAppointment(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// OpenConsultSession starts (or returns) the LiveKit session pinned to this
// appointment. Both participants may call it; a stranger gets 404 so existence
// is never confirmed.
func (h *Handler) OpenConsultSession(c *gin.Context) {
	userID := ginutil.UserID(c)
	sess, err := h.svc.OpenConsultSession(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAppointmentNotFound):
			c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		case errors.Is(err, ErrSessionNotOpenable):
			c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
		case errors.Is(err, ErrConsultUnavailable),
			errors.Is(err, consultengine.ErrMediaUnavailable),
			errors.Is(err, consultengine.ErrEscrowUnavailable):
			c.JSON(http.StatusServiceUnavailable, gin.H{keyError: httperr.Msg(c, http.StatusServiceUnavailable, err)})
		case errors.Is(err, consultengine.ErrInvalid), errors.Is(err, consultengine.ErrState):
			c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

func (h *Handler) CancelAppointment(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.CancelAppointment(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) IssuePrescription(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req IssuePrescriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.IssuePrescription(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// GetPrescription reads back the prescription issued for an appointment
// (GET /appointments/:id/prescription). Object-level authZ enforced in the
// service layer (patient or assigned doctor only).
func (h *Handler) GetPrescription(c *gin.Context) {
	userID := ginutil.UserID(c)
	p, err := h.svc.GetPrescription(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) SubmitSOAPNote(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req SubmitSOAPNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	note, err := h.svc.SubmitSOAPNote(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": note})
}

func (h *Handler) UploadLicenceDoc(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req UploadLicenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = ginutil.IdempotencyKey(c)
	}
	doc, err := h.svc.UploadLicenceDoc(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"upload_id": doc.ID}})
}
