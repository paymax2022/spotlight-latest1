package healthpharmacy

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

func failRxUpload(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrUploadsNotConfigured):
		ginutil.FailOK(c, http.StatusServiceUnavailable, ErrUploadsNotConfigured.Error())
	case errors.Is(err, ErrRxUploadInvalid):
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
	default:
		failErr(c, http.StatusInternalServerError, err)
	}
}

// PresignRxUpload — POST /prescriptions/upload/presign  body: { file_name, content_type }
func (h *Handler) PresignRxUpload(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		FileName    string `json:"file_name"`
		ContentType string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	p, err := h.svc.PresignRxUpload(c.Request.Context(), uid, req.FileName, req.ContentType)
	if err != nil {
		failRxUpload(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "presign": p})
}

// RecordRxUpload — POST /prescriptions/upload  body: { storage_key, content_type, patient_name, note }
func (h *Handler) RecordRxUpload(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		StorageKey  string `json:"storage_key"`
		ContentType string `json:"content_type"`
		PatientName string `json:"patient_name"`
		Note        string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	u, err := h.svc.RecordRxUpload(c.Request.Context(), uid, req.StorageKey, req.ContentType, req.PatientName, req.Note)
	if err != nil {
		failRxUpload(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keySuccess: true, "upload": u})
}
