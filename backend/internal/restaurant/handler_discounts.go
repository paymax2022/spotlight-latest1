package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// discountErrStatus maps discount errors: a bad request is 422, a missing row is 404,
// and anything else falls back to the owner status mapping.
func discountErrStatus(err error) int {
	switch {
	case errors.Is(err, ErrDiscountNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrDiscountInvalid):
		return http.StatusUnprocessableEntity
	default:
		return ownerErrStatus(err)
	}
}

// ListDiscounts → GET /restaurant/:id/discounts
func (h *Handler) ListDiscounts(c *gin.Context) {
	out, err := h.svc.ListDiscounts(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		status := discountErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CreateDiscount → POST /restaurant/:id/discounts
func (h *Handler) CreateDiscount(c *gin.Context) {
	var in DiscountInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.CreateDiscount(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in)
	if err != nil {
		status := discountErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": d})
}

// SetDiscountActive → PATCH /restaurant/:id/discounts/:discountId  body: {"is_active": bool}
func (h *Handler) SetDiscountActive(c *gin.Context) {
	var body struct {
		IsActive *bool `json:"is_active" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.SetDiscountActive(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("discountId"), *body.IsActive)
	if err != nil {
		status := discountErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

// DeleteDiscount → DELETE /restaurant/:id/discounts/:discountId
func (h *Handler) DeleteDiscount(c *gin.Context) {
	if err := h.svc.DeleteDiscount(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("discountId")); err != nil {
		status := discountErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}
