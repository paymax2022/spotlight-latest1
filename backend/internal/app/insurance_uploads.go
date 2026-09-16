package app

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/platform/r2"
)

// insuranceUploadHandler backs POST /api/finance/insurance/uploads.
//
// The mobile app's DynamicField file/image controls are URL-VALUED: MyCover's
// image_url / id_image_url / device_about_image_url fields are fetched and
// content-checked by MyCover itself at quote/bind time, so a private R2
// object key or an opaque upload id is not enough — the field needs a URL
// MyCover can actually GET. This handler receives the file server-side (so
// the R2 credentials never reach the client), PUTs it to R2 via the same
// presign mechanism used everywhere else in this codebase, and returns a
// presigned GET URL with a TTL generous enough to survive the rest of the
// application flow (the applicant may keep filling the form for minutes
// after picking the photo) and a retried bind.
type insuranceUploadHandler struct {
	presigner *r2.Presigner
	bucket    string
}

// allowedInsuranceUploadTypes mirrors the content-type allow-lists already
// used for doctor/restaurant/health-provider presigned uploads elsewhere in
// this codebase.
var allowedInsuranceUploadTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

const insuranceUploadMaxBytes = 8 << 20 // 8MB

func (h *insuranceUploadHandler) Upload(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	ext, ok := allowedInsuranceUploadTypes[contentType]
	if !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unsupported file type — use PNG, JPEG, or WEBP"})
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, insuranceUploadMaxBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read file"})
		return
	}
	if len(data) > insuranceUploadMaxBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file too large — max 8MB"})
		return
	}

	purpose := c.PostForm("purpose")
	if purpose == "" {
		purpose = "document"
	}
	key := fmt.Sprintf("insurance/uploads/%s/%s-%s%s", userID, purpose, uuid.New().String(), ext)

	putURL, err := h.presigner.PresignPut(key, contentType, 10*time.Minute)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare upload"})
		return
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPut, putURL, bytes.NewReader(data))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare upload"})
		return
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(data))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not upload file"})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not upload file"})
		return
	}

	getURL, err := h.presigner.PresignGet(key, 7*24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "uploaded, but could not generate an access url"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": getURL})
}
