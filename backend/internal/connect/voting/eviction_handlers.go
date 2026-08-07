package connectvoting

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// EvictionRequest for triggering evictions
type EvictionRequest struct {
	StageNumber         int    `json:"stage_number" binding:"required,gt=0"`
	EvictionPercentage  int    `json:"eviction_percentage,omitempty"`
	GracePeriodHours    int    `json:"grace_period_hours,omitempty"`
}

// SaveRequest for saving a contestant from eviction
type SaveRequest struct {
	EvictionID string `json:"eviction_id" binding:"required"`
	Reason     string `json:"reason,omitempty"`
}

// ExtendGracePeriodRequest for extending eviction grace periods
type ExtendGracePeriodRequest struct {
	EvictionID       string `json:"eviction_id" binding:"required"`
	AdditionalHours  int    `json:"additional_hours,omitempty"`
}

// FinalizEvictionsRequest for finalizing evictions
type FinalizeEvictionsRequest struct {
	StageNumber int `json:"stage_number" binding:"required,gt=0"`
}

// EvictionResponse for eviction results
type EvictionResponse struct {
	ContestantID   string    `json:"contestant_id"`
	VoteCount      int       `json:"vote_count"`
	EvictionRank   int       `json:"eviction_rank"`
	EvictionID     string    `json:"eviction_id"`
	EvictedAt      time.Time `json:"evicted_at"`
	GracePeriodEnd time.Time `json:"grace_period_end"`
}

// SaveResponse for save results
type SaveResponse struct {
	Success     bool   `json:"success"`
	Message     string `json:"message"`
	SaveRecordID string `json:"save_record_id"`
}

// TriggerEvictions — POST /api/v1/connect/contests/:id/stages/:stageNum/evict (admin only).
// Marks the bottom 20% of contestants for eviction.
func (h *Handler) TriggerEvictions(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Check admin permission (implement your RBAC here)
	// For now, we assume the endpoint is protected at the route level

	contestID := c.Param("id")

	var req EvictionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set defaults
	if req.EvictionPercentage == 0 {
		req.EvictionPercentage = 20
	}
	if req.GracePeriodHours == 0 {
		req.GracePeriodHours = 24
	}

	results, err := h.svc.TriggerEvictions(c.Request.Context(), contestID, req, uid)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": results,
		"message": "Evictions triggered successfully",
	})
}

// SaveContestant — POST /api/v1/connect/contests/:id/save (judge/admin).
// Saves a contestant marked for eviction.
func (h *Handler) SaveContestant(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var req SaveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine save type (admin vs judge) - implement your RBAC here
	saveType := "judge" // Default to judge
	// if isAdmin(uid) { saveType = "admin" }

	result, err := h.svc.SaveContestant(c.Request.Context(), req.EvictionID, uid, saveType, req.Reason)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

// ExtendGracePeriod — POST /api/v1/connect/contests/:id/extend-grace-period (admin only).
// Extends the grace period for evictions.
func (h *Handler) ExtendGracePeriod(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var req ExtendGracePeriodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.AdditionalHours == 0 {
		req.AdditionalHours = 24
	}

	result, err := h.svc.ExtendGracePeriod(c.Request.Context(), req.EvictionID, req.AdditionalHours, uid)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

// FinalizeEvictions — POST /api/v1/connect/contests/:id/stages/:stageNum/finalize-evictions (admin only).
// Finalizes evictions after grace period ends.
func (h *Handler) FinalizeEvictions(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	contestID := c.Param("id")
	stageNum := c.Param("stageNum")

	stageNumber, err := strconv.Atoi(stageNum)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid stage number"})
		return
	}

	result, err := h.svc.FinalizeEvictions(c.Request.Context(), contestID, stageNumber)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetContestantsByStage — GET /api/v1/connect/contests/:id/stages/:stageNum/contestants (public).
// Gets all contestants in a stage with eviction status.
func (h *Handler) GetContestantsByStage(c *gin.Context) {
	contestID := c.Param("id")
	stageNum := c.Param("stageNum")

	stageNumber, err := strconv.Atoi(stageNum)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid stage number"})
		return
	}

	contestants, err := h.svc.GetContestantsByStage(c.Request.Context(), contestID, stageNumber)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": contestants})
}

// GetEvictions — GET /api/v1/connect/contests/:id/evictions (admin/judge).
// Gets all pending evictions for a contest.
func (h *Handler) GetEvictions(c *gin.Context) {
	contestID := c.Param("id")
	stageNum := c.Query("stage")

	evictions, err := h.svc.GetEvictions(c.Request.Context(), contestID, stageNum)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": evictions})
}

// AdminVote — POST /api/v1/connect/contests/:id/admin-vote (admin only, unlimited).
// Allows admin to vote unlimited without payment.
func (h *Handler) AdminVote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Verify admin status - implement your RBAC here

	var req struct {
		ContestantID string `json:"contestant_id" binding:"required"`
		VoteQuantity int    `json:"vote_quantity,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.VoteQuantity == 0 {
		req.VoteQuantity = 1
	}

	vote, err := h.svc.AdminVote(c.Request.Context(), c.Param("id"), req.ContestantID, uid, req.VoteQuantity)
	if err != nil {
		mapError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": vote})
}
