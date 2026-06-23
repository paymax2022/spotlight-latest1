package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type CompetitionHandler struct {
	service services.CompetitionService
	// audit is an OPTIONAL sink (see StemHandler.WithAudit). nil => no-op.
	audit services.AuditService
}

func NewCompetitionHandler(service services.CompetitionService) *CompetitionHandler {
	return &CompetitionHandler{service: service}
}

// WithAudit attaches an audit sink so contest (open-mic) mutations are recorded.
func (h *CompetitionHandler) WithAudit(audit services.AuditService) *CompetitionHandler {
	h.audit = audit
	return h
}

func (h *CompetitionHandler) emitAudit(c *gin.Context, action, resourceType, resourceID string, newValues map[string]any, severity string) {
	if h.audit == nil {
		return
	}
	actorID := ""
	if actor, ok := middleware.GetAuthenticatedUser(c); ok {
		actorID = actor.ID
	}
	h.audit.LogAction(actorID, "", action, "contest", resourceType, resourceID, nil, newValues, c.ClientIP(), c.Request.UserAgent(), severity)
}

func competitionRefID(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return ""
	}
	for _, k := range []string{"id", "ID", "Id"} {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func (h *CompetitionHandler) Overview(c *gin.Context) {
	overview, err := h.service.GetOverview()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load competition overview"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "overview": overview})
}

func (h *CompetitionHandler) OpenMic(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := h.service.ListOpenMic(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load open mic competitions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "competitions": rows})
}

func (h *CompetitionHandler) CreateOpenMic(c *gin.Context) {
	var payload struct {
		Name            string `json:"name"`
		Slug            string `json:"slug"`
		Description     string `json:"description"`
		Status          string `json:"status"`
		Category        string `json:"category"`
		StartDate       string `json:"start_date"`
		EndDate         string `json:"end_date"`
		IsFeatured      bool   `json:"is_featured"`
		EntryFeeNGN     int    `json:"entry_fee_ngn"`
		VotePriceNGN    int    `json:"vote_price_ngn"`
		RulesText       string `json:"rules_text"`
		EligibilityText string `json:"eligibility_text"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "competition name is required"})
		return
	}

	created, err := h.service.CreateOpenMic(domain.OpenMicCreateInput{
		Name:            payload.Name,
		Slug:            payload.Slug,
		Description:     payload.Description,
		Status:          payload.Status,
		Category:        payload.Category,
		StartDate:       payload.StartDate,
		EndDate:         payload.EndDate,
		IsFeatured:      payload.IsFeatured,
		EntryFeeNGN:     payload.EntryFeeNGN,
		VotePriceNGN:    payload.VotePriceNGN,
		RulesText:       payload.RulesText,
		EligibilityText: payload.EligibilityText,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create open mic competition"})
		return
	}
	h.emitAudit(c, "contest.openmic.create", "open_mic_competition", competitionRefID(created), map[string]any{"name": payload.Name, "slug": payload.Slug, "status": payload.Status, "entryFeeNGN": payload.EntryFeeNGN, "votePriceNGN": payload.VotePriceNGN}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "competition": created})
}
