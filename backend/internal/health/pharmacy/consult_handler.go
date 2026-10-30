package healthpharmacy

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// ConsultMessages — GET /consult/messages (caller's own thread)
func (h *Handler) ConsultMessages(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.ConsultThread(c.Request.Context(), uid)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "messages": rows})
}

// SendConsultMessage — POST /consult/messages  body: { body }
func (h *Handler) SendConsultMessage(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var req struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	m, err := h.svc.SendConsultMessage(c.Request.Context(), uid, req.Body)
	if err != nil {
		if errors.Is(err, ErrConsultBody) {
			ginutil.FailOK(c, http.StatusBadRequest, err.Error())
			return
		}
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keySuccess: true, "message": m})
}
