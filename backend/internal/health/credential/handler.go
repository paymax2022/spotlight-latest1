package credential

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Mode-B VCN verification API. Member routes are owner-scoped
// (object-level authZ in the service); admin routes are RBAC-gated by the wiring
// (health.vet.review) and additionally enforce no-self-approval in the service.
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func status(err error) int {
	switch {
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrIllegalTransition):
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}

// ---- Member (vet) ----

// Submit POST /verification/submit
func (h *Handler) Submit(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		ApplicationID string `json:"application_id" binding:"required"`
		RegNumber     string `json:"reg_number" binding:"required"`
		FullName      string `json:"full_name" binding:"required"`
		DOB           string `json:"dob"`
		Consent       bool   `json:"consent"`
		Docs          []struct {
			Type       string `json:"type"`
			StorageKey string `json:"storage_key"`
		} `json:"docs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in := SubmitInput{ApplicationID: body.ApplicationID, RegNumber: body.RegNumber, FullName: body.FullName, DOB: body.DOB, Consent: body.Consent}
	for _, d := range body.Docs {
		in.Docs = append(in.Docs, SubmitDoc{Type: d.Type, StorageKey: d.StorageKey})
	}
	rec, err := h.svc.Submit(c.Request.Context(), uid, in)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	// Return only the sanitised stage to the vet (never record internals).
	c.JSON(http.StatusCreated, gin.H{"application_id": rec.ProviderApplicationID, "stage": publicStage(rec.Status)})
}

// MyStatus GET /verification/status?application_id=
func (h *Handler) MyStatus(c *gin.Context) {
	uid := c.GetString("user_id")
	appID := c.Query("application_id")
	if appID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "application_id required"})
		return
	}
	st, err := h.svc.MyStatus(c.Request.Context(), uid, appID)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

// MyDocURL GET /verification/documents/:docId/url — owner-scoped signed URL.
func (h *Handler) MyDocURL(c *gin.Context) {
	uid := c.GetString("user_id")
	url, err := h.svc.DocSignedURL(c.Request.Context(), uid, c.Param("docId"), false)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url})
}

// ---- Admin (ops reviewer) ----

// Queue GET /verification/queue
func (h *Handler) Queue(c *gin.Context) {
	items, err := h.svc.ListQueue(c.Request.Context(), 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// GetRecord GET /verification/:recordId
func (h *Handler) GetRecord(c *gin.Context) {
	rec, err := h.svc.GetRecordAdmin(c.Request.Context(), c.Param("recordId"))
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// ReviewerDocURL GET /verification/documents/:docId/url — reviewer signed URL (access-logged).
func (h *Handler) ReviewerDocURL(c *gin.Context) {
	uid := c.GetString("user_id")
	url, err := h.svc.DocSignedURL(c.Request.Context(), uid, c.Param("docId"), true)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url})
}

// Decide POST /verification/:recordId/decision
func (h *Handler) Decide(c *gin.Context) {
	uid := c.GetString("user_id")
	var body struct {
		Action        string `json:"action" binding:"required"` // approve | need_info | reject
		LicenceExpiry string `json:"licence_expiry"`            // YYYY-MM-DD (required for approve)
		Notes         string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var expiry *time.Time
	if body.LicenceExpiry != "" {
		t, perr := time.Parse("2006-01-02", body.LicenceExpiry)
		if perr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "licence_expiry must be YYYY-MM-DD"})
			return
		}
		expiry = &t
	}
	rec, err := h.svc.Decide(c.Request.Context(), uid, c.Param("recordId"), body.Action, expiry, body.Notes)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}
