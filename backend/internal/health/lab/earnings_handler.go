package healthlab

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

func earningsFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotLabOwner):
		failErr(c, http.StatusForbidden, err)
	case errors.Is(err, ErrSharingUnavailable):
		failErr(c, http.StatusServiceUnavailable, err)
	default:
		failErr(c, http.StatusInternalServerError, err)
	}
}

// ProviderEarnings — GET /provider/earnings  (lab owner; read-only)
func (h *Handler) ProviderEarnings(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	e, err := h.svc.ProviderEarnings(c.Request.Context(), uid)
	if err != nil {
		earningsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "earnings": e})
}

// ProviderReviews — GET /provider/reviews  (lab owner)
func (h *Handler) ProviderReviews(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.ProviderReviews(c.Request.Context(), uid)
	if err != nil {
		earningsFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "reviews": rows})
}
