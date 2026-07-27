package restaurant

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// RaiseFoodDispute → POST /restaurant/orders/:orderId/dispute (party). Opens a dispute
// on a delivered order.
func (h *Handler) RaiseFoodDispute(c *gin.Context) {
	actorID := c.GetString("user_id")
	var body struct {
		Type        string `json:"type" binding:"required"`
		Description string `json:"description" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.RaiseFoodDispute(c.Request.Context(), c.Param("orderId"), actorID, body.Type, body.Description)
	if err != nil {
		c.JSON(disputeErrCode(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"dispute": d})
}

// GetFoodDispute → GET /restaurant/disputes/:id (party).
func (h *Handler) GetFoodDispute(c *gin.Context) {
	actorID := c.GetString("user_id")
	d, err := h.svc.GetFoodDispute(c.Request.Context(), c.Param("id"), actorID)
	if err != nil {
		c.JSON(disputeErrCode(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"dispute": d})
}

// AdminListFoodDisputes → GET /api/restaurant/admin/disputes (ops). ?status=&limit=&offset=.
func (h *Handler) AdminListFoodDisputes(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	list, err := h.svc.AdminListFoodDisputes(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"disputes": list})
}

// AdminResolveFoodDispute → POST /api/restaurant/admin/disputes/:id/resolve (ops). Body
// {resolution, refund_kobo?, note?}. A refund resolution issues a platform-funded credit.
func (h *Handler) AdminResolveFoodDispute(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body struct {
		Resolution string `json:"resolution" binding:"required"`
		RefundKobo int64  `json:"refund_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.AdminResolveFoodDispute(c.Request.Context(), c.Param("id"), adminID, FoodDisputeResolution(body.Resolution), body.RefundKobo, body.Note)
	if err != nil {
		c.JSON(disputeErrCode(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"dispute": d})
}

// disputeErrCode maps dispute errors: authorization → 403, invalid state/amount/type →
// 422, anything else → 400.
func disputeErrCode(err error) int {
	switch {
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrDisputeInvalid):
		return http.StatusUnprocessableEntity
	default:
		return http.StatusBadRequest
	}
}
