package healthlab

import (
	"errors"
	"net/http"
	"net/mail"
	"time"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
)

func resultsFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrOrderNotFound), errors.Is(err, ErrRecipientNotFound), errors.Is(err, ErrNoReportDocument):
		failErr(c, http.StatusNotFound, err)
	case errors.Is(err, ErrAckRequired):
		failErr(c, http.StatusForbidden, err)
	case errors.Is(err, ErrShareSelf), errors.Is(err, ErrBadShareDuration):
		failErr(c, http.StatusBadRequest, err)
	case errors.Is(err, ErrSharingUnavailable):
		failErr(c, http.StatusServiceUnavailable, err)
	default:
		failErr(c, http.StatusInternalServerError, err)
	}
}

func resultsUser(c *gin.Context) (string, bool) {
	uid := ginutil.UserID(c)
	if uid == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return "", false
	}
	return uid, true
}

// ListResults — GET /results  (the caller's released/escalated results, no values)
func (h *Handler) ListResults(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.ListMyResults(c.Request.Context(), uid)
	if err != nil {
		resultsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": rows})
}

// SharedResults — GET /results/shared  (results other patients shared with me)
func (h *Handler) SharedResults(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.ListSharedWithMe(c.Request.Context(), uid)
	if err != nil {
		resultsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": rows})
}

// GetResult — GET /results/:id  (id = order id; owner after acknowledgement, or a consented grantee)
func (h *Handler) GetResult(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "result id")
	if !ok {
		return
	}
	v, err := h.svc.GetResultView(c.Request.Context(), uid, id)
	if err != nil {
		resultsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": v})
}

// AcknowledgeResult — POST /results/:id/consent
func (h *Handler) AcknowledgeResult(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "result id")
	if !ok {
		return
	}
	at, err := h.svc.AcknowledgeResult(c.Request.Context(), uid, id)
	if err != nil {
		resultsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "acknowledged": true, "acknowledged_at": at})
}

// ShareResult — POST /results/:id/share  {grantee_email, days}
func (h *Handler) ShareResult(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "result id")
	if !ok {
		return
	}
	var in struct {
		GranteeEmail string `json:"grantee_email"`
		Days         int    `json:"days"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := mail.ParseAddress(in.GranteeEmail); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "grantee_email must be a valid email address")
		return
	}
	cid, exp, err := h.svc.ShareResult(c.Request.Context(), uid, id, in.GranteeEmail, in.Days)
	if err != nil {
		resultsFail(c, err)
		return
	}
	out := gin.H{"success": true, "consent_id": cid}
	if !exp.IsZero() {
		out["expires_at"] = exp.UTC().Format(time.RFC3339)
	}
	c.JSON(http.StatusCreated, out)
}

// ResultSignedURL — GET /results/:id/signed-url
func (h *Handler) ResultSignedURL(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "result id")
	if !ok {
		return
	}
	url, err := h.svc.ResultSignedURL(c.Request.Context(), uid, id)
	if err != nil {
		resultsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "url": url,
		"expires_at": time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339),
	})
}
