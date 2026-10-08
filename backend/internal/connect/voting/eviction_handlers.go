package connectvoting

import (
	"context"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// EvictionRequest for triggering evictions
type EvictionRequest struct {
	StageNumber        int `json:"stage_number" binding:"required,gt=0"`
	EvictionPercentage int `json:"eviction_percentage,omitempty"`
	GracePeriodHours   int `json:"grace_period_hours,omitempty"`
}

// SaveRequest for saving a contestant from eviction
type SaveRequest struct {
	EvictionID string `json:"eviction_id" binding:"required"`
	Reason     string `json:"reason,omitempty"`
}

// ExtendGracePeriodRequest for extending eviction grace periods
type ExtendGracePeriodRequest struct {
	EvictionID      string `json:"eviction_id" binding:"required"`
	AdditionalHours int    `json:"additional_hours,omitempty"`
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
	Success      bool   `json:"success"`
	Message      string `json:"message"`
	SaveRecordID string `json:"save_record_id"`
}

// TriggerEvictions — POST /api/v1/connect/contests/:id/stages/:stageNum/evict (admin only).
// Marks the bottom 20% of contestants for eviction.
func (h *Handler) TriggerEvictions(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Permission is enforced by the connect.contests.manage guard on the admin
	// route (see RegisterAdmin). This handler must never be mounted on a group
	// without that guard.
	// For now, we assume the endpoint is protected at the route level

	contestID := c.Param("id")

	var req EvictionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

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
		"data":    results,
		"message": "Evictions triggered successfully",
	})
}

// SaveContestant — POST /api/v1/connect/contests/:id/save (judge/admin).
// Saves a contestant marked for eviction.
func (h *Handler) SaveContestant(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var req SaveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	saveType := "judge"

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
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var req ExtendGracePeriodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
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
	uid := ginutil.UserID(c)
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
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Permission is enforced by the connect.contests.manage guard on the admin
	// route (see RegisterAdmin). This handler must never be mounted on a group
	// without that guard.

	var req struct {
		ContestantID string `json:"contestant_id" binding:"required"`
		VoteQuantity int    `json:"vote_quantity,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
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

// TriggerEvictions marks the bottom 20% of contestants for eviction.
func (s *Service) TriggerEvictions(ctx context.Context, contestID string, req EvictionRequest, actorID string) ([]EvictionResponse, error) {
	results, err := s.repo.TriggerEvictions(ctx, contestID, req.StageNumber, req.EvictionPercentage, req.GracePeriodHours, actorID)
	if err != nil {
		return nil, fmt.Errorf("failed to trigger evictions: %w", err)
	}

	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "evict_contestants", actorID, "contest", contestID, map[string]any{
			"stage_number":        req.StageNumber,
			"eviction_percentage": req.EvictionPercentage,
			"grace_period_hours":  req.GracePeriodHours,
			"count":               len(results),
		})
	}

	return results, nil
}

// SaveContestant saves a contestant from eviction.
// Judges can save only one per stage; admins can save unlimited.
func (s *Service) SaveContestant(ctx context.Context, evictionID, actorID, saveType, reason string) (*SaveResponse, error) {
	result, err := s.repo.SaveContestant(ctx, evictionID, actorID, saveType, reason)
	if err != nil {
		return nil, fmt.Errorf("failed to save contestant: %w", err)
	}

	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "save_contestant", actorID, "eviction", evictionID, map[string]any{
			"save_type": saveType,
			"reason":    reason,
		})
	}

	return result, nil
}

// ExtendGracePeriod extends the grace period for evictions.
func (s *Service) ExtendGracePeriod(ctx context.Context, evictionID string, additionalHours int, actorID string) (*SaveResponse, error) {
	result, err := s.repo.ExtendGracePeriod(ctx, evictionID, additionalHours, actorID)
	if err != nil {
		return nil, fmt.Errorf("failed to extend grace period: %w", err)
	}

	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "extend_grace_period", actorID, "eviction", evictionID, map[string]any{
			"additional_hours": additionalHours,
		})
	}

	return result, nil
}

// FinalizeEvictions finalizes evictions after grace period ends.
func (s *Service) FinalizeEvictions(ctx context.Context, contestID string, stageNumber int) (*SaveResponse, error) {
	result, err := s.repo.FinalizeEvictions(ctx, contestID, stageNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to finalize evictions: %w", err)
	}

	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "finalize_evictions", "system", "contest", contestID, map[string]any{
			"stage_number": stageNumber,
		})
	}

	return result, nil
}

// StageContestant — GetContestantsByStage retrieves all contestants in a stage with eviction status.
type StageContestant struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	PhotoURL         string     `json:"photo_url"`
	VoteCount        int        `json:"vote_count"`
	EvictionStatus   string     `json:"eviction_status"`
	EvictionTemplate string     `json:"eviction_template"`
	EvictionID       *string    `json:"eviction_id,omitempty"`
	GracePeriodEnd   *time.Time `json:"grace_period_end,omitempty"`
}

func (s *Service) GetContestantsByStage(ctx context.Context, contestID string, stageNumber int) ([]StageContestant, error) {
	contestants, err := s.repo.GetContestantsByStage(ctx, contestID, stageNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to get contestants: %w", err)
	}

	return contestants, nil
}

// EvictionInfo represents a single pending eviction
type EvictionInfo struct {
	ID                string    `json:"id"`
	ContestantID      string    `json:"contestant_id"`
	ContestantName    string    `json:"contestant_name"`
	StageNumber       int       `json:"stage_number"`
	VoteCount         int       `json:"vote_count"`
	EvictionRank      int       `json:"eviction_rank"`
	GracePeriodEndsAt time.Time `json:"grace_period_ends_at"`
	Status            string    `json:"status"`
	SaveCount         int       `json:"save_count"`
	CanBeSaved        bool      `json:"can_be_saved"`
}

// GetEvictions retrieves all pending evictions for a contest.
func (s *Service) GetEvictions(ctx context.Context, contestID string, stageNum string) ([]EvictionInfo, error) {
	evictions, err := s.repo.GetEvictions(ctx, contestID, stageNum)
	if err != nil {
		return nil, fmt.Errorf("failed to get evictions: %w", err)
	}

	return evictions, nil
}

// AdminVote allows admin to vote unlimited without payment.
func (s *Service) AdminVote(ctx context.Context, contestID, contestantID, actorID string, voteQuantity int) (*Vote, error) {
	_, err := s.repo.GetContest(ctx, contestID)
	if err != nil {
		return nil, ErrNotFound
	}

	// Admin votes bypass the ledger — no debit, no idempotency key.
	vote, err := s.repo.AdminVote(ctx, contestID, contestantID, actorID, voteQuantity)
	if err != nil {
		return nil, fmt.Errorf("failed to record admin vote: %w", err)
	}

	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "admin_vote", actorID, "contest", contestID, map[string]any{
			"contestant_id": contestantID,
			"vote_quantity": voteQuantity,
		})
	}

	return vote, nil
}
