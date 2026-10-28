package healthlab

import (
	"errors"
	"net/http"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// QuoteOrder — POST /orders/quote  {lab_provider_id, collection_method, test_ids, package_ids}
// Returns the server's price (lines, subtotal, home fee, total) — the figure
// CreateOrder will hold. Read-only: no money moves and nothing is stored.
func (h *Handler) QuoteOrder(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		LabProviderID    string   `json:"lab_provider_id"`
		CollectionMethod string   `json:"collection_method"`
		TestIDs          []string `json:"test_ids"`
		PackageIDs       []string `json:"package_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(req.LabProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
		return
	}
	for _, id := range append(append([]string{}, req.TestIDs...), req.PackageIDs...) {
		if _, err := uuid.Parse(id); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "test_ids and package_ids must be uuids")
			return
		}
	}
	q, err := h.svc.QuoteOrder(c.Request.Context(), CreateOrderInput{
		LabProviderID:    req.LabProviderID,
		CollectionMethod: CollectionMethod(req.CollectionMethod),
		TestIDs:          req.TestIDs,
		PackageIDs:       req.PackageIDs,
	})
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"success": true, "quote": q})
	case errors.Is(err, ErrEmptyOrder), errors.Is(err, ErrOrderTooLarge), errors.Is(err, ErrDuplicateItem):
		failErr(c, http.StatusBadRequest, err)
	default:
		failErr(c, http.StatusUnprocessableEntity, err)
	}
}
