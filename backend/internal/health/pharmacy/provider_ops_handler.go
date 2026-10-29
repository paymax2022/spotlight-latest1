package healthpharmacy

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// keySuccess is the envelope flag every pharmacy response carries.
const keySuccess = "success"

// requireUser returns the authenticated caller or writes 401.
func requireUser(c *gin.Context) (string, bool) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return "", false
	}
	return id, true
}

// StockAlerts — GET /provider/stock-alerts (owner-scoped)
func (h *Handler) StockAlerts(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.StockAlertsForOwner(c.Request.Context(), uid)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "alerts": rows})
}

// RxQueue — GET /provider/rx-queue (owner-scoped, APPROVED pharmacies only)
func (h *Handler) RxQueue(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.RxQueueForOwner(c.Request.Context(), uid)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "queue": rows})
}

// ControlledLog — GET /provider/controlled-log (owner-scoped HL-4 register)
func (h *Handler) ControlledLog(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.ControlledLogForOwner(c.Request.Context(), uid)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "entries": rows})
}
