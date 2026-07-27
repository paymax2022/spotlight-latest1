package restaurant

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// GetKYB → GET /restaurant/:id/kyb (owner). Returns the KYB record + uploaded doc types.
func (h *Handler) GetKYB(c *gin.Context) {
	userID := c.GetString("user_id")
	k, docTypes, err := h.svc.GetKYB(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k, "documents": docTypes})
}

// SaveKYB → PUT /restaurant/:id/kyb (owner). Upserts the business/settlement details.
func (h *Handler) SaveKYB(c *gin.Context) {
	userID := c.GetString("user_id")
	var body KYB
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	k, err := h.svc.SaveKYB(c.Request.Context(), c.Param("id"), userID, body)
	if err != nil {
		c.JSON(kybErrCode(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k})
}

// AddKYBDocument → POST /restaurant/:id/kyb/documents (owner). Records a reference to
// a document the owner has already uploaded to storage.
func (h *Handler) AddKYBDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		DocType  string `json:"doc_type" binding:"required"`
		FileURL  string `json:"file_url" binding:"required"`
		FileName string `json:"file_name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AddKYBDocument(c.Request.Context(), c.Param("id"), userID, body.DocType, body.FileURL, body.FileName); err != nil {
		c.JSON(kybErrCode(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true})
}

// SubmitKYB → POST /restaurant/:id/kyb/submit (owner). Validates + submits for review.
func (h *Handler) SubmitKYB(c *gin.Context) {
	userID := c.GetString("user_id")
	k, err := h.svc.SubmitKYB(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(kybErrCode(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k})
}

// kybErrCode maps KYB errors: an incomplete submission → 422, an owner-authorization
// failure → 403, anything else (illegal transition / edit-while-locked) → 400.
func kybErrCode(err error) int {
	switch {
	case errors.Is(err, ErrKYBIncomplete):
		return http.StatusUnprocessableEntity
	case strings.Contains(err.Error(), "only the owner"), strings.Contains(err.Error(), "not found"):
		return http.StatusForbidden
	default:
		return http.StatusBadRequest
	}
}
