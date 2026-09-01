package engage

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

func documentStatus(err error) int {
	switch {
	case errors.Is(err, ErrDocumentNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrNotDocumentOwner):
		return http.StatusForbidden
	case errors.Is(err, ErrEmptyLabel), errors.Is(err, ErrBadDocumentType), errors.Is(err, ErrMissingUpload):
		return http.StatusBadRequest
	default:
		return commentStatus(err)
	}
}

// ListDocuments GET /campaigns/:id/documents
func (h *Handler) ListDocuments(c *gin.Context) {
	out, err := h.svc.ListDocuments(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(documentStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AttachDocument POST /campaigns/:id/documents — creator only.
func (h *Handler) AttachDocument(c *gin.Context) {
	var in AttachDocumentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AttachDocument(c.Request.Context(), c.Param("id"), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(documentStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}
