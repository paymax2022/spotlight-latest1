package healthrecords

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler — records vault routes. isAdmin is derived from the authenticated user's
// permission set, injected by the wiring layer via the IsAdmin func.
type Handler struct {
	svc     *Service
	isAdmin func(c *gin.Context) bool
}

func NewHandler(svc *Service, isAdmin func(c *gin.Context) bool) *Handler {
	if isAdmin == nil {
		isAdmin = func(*gin.Context) bool { return false }
	}
	return &Handler{svc: svc, isAdmin: isAdmin}
}

func uid(c *gin.Context) string { return c.GetString("user_id") }
func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// Create — POST /records
func (h *Handler) Create(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		OwnerUserID string  `json:"owner_user_id"` // defaults to acting user
		SubjectType string  `json:"subject_type"`
		RecordType  string  `json:"record_type"`
		Title       string  `json:"title"`
		Body        string  `json:"body"`
		PetRef      *string `json:"pet_ref"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	owner := req.OwnerUserID
	if owner == "" {
		owner = id
	}
	// Only the data subject may create records about themselves at MVP (object-level
	// authZ); clinician-authored records flow through consult.COMPLETE.
	if owner != id {
		fail(c, http.StatusForbidden, "can only create records for self")
		return
	}
	r, err := h.svc.Create(c.Request.Context(), owner, id, req.SubjectType, req.RecordType, req.Title, req.Body, req.PetRef)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "record": r})
}

// Get — GET /records/:subjectId  (consent-checked; access-logged)
func (h *Handler) Get(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	r, err := h.svc.Get(c.Request.Context(), id, c.Param("subjectId"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "record": r})
}

// AddDocument — POST /records/:subjectId/docs
func (h *Handler) AddDocument(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		StorageKey  string `json:"storage_key"`
		ContentType string `json:"content_type"`
		Label       string `json:"label"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	d, err := h.svc.AddDocument(c.Request.Context(), id, c.Param("subjectId"), req.StorageKey, req.ContentType, req.Label)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "document": d})
}

// Erase — DELETE /records/:subjectId  (right-to-erasure)
func (h *Handler) Erase(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if err := h.svc.Erase(c.Request.Context(), id, c.Param("subjectId")); err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AccessLog — GET /records/:subjectId/access-log
func (h *Handler) AccessLog(c *gin.Context) {
	id := uid(c)
	out, err := h.svc.AccessLog(c.Request.Context(), id, c.Param("subjectId"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "access_log": out})
}
