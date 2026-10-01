// Package handlers — Thin engagement/contest handlers: chat-moderation views, lead capture,
// support handoffs, competition admin actions and the reality-TV dashboard.
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

type ChatHandler struct{ service services.ChatService }

func NewChatHandler(service services.ChatService) *ChatHandler { return &ChatHandler{service: service} }

func (h *ChatHandler) ListSessions(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "50")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	chats, err := h.service.ListSessions(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chats"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chats": chats})
}

func (h *ChatHandler) GetSession(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "chat id is required"})
		return
	}
	detail, err := h.service.GetSessionDetail(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chat transcript"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"session":  detail.Session,
		"messages": detail.Messages,
		"events":   detail.Events,
	})
}

type HandoffHandler struct {
	service services.HandoffService
}

func NewHandoffHandler(service services.HandoffService) *HandoffHandler {
	return &HandoffHandler{service: service}
}

func (h *HandoffHandler) List(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "200")
	status := c.Query("status")
	sessionID := c.Query("sessionId")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}

	handoffs, err := h.service.List(limit, status, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load handoff requests"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "handoffs": handoffs})
}

func (h *HandoffHandler) UpdateStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "handoff id is required"})
		return
	}

	var payload struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	status := strings.TrimSpace(strings.ToLower(payload.Status))
	switch status {
	case "pending", "in_progress", "resolved":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid status"})
		return
	}

	if err := h.service.UpdateStatus(id, status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update handoff"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "id": id, "status": status})
}

type LeadHandler struct {
	service services.LeadService
}

func NewLeadHandler(service services.LeadService) *LeadHandler {
	return &LeadHandler{service: service}
}

func (h *LeadHandler) List(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "200")
	sessionID := c.Query("sessionId")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}

	leads, err := h.service.List(limit, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load leads"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "leads": leads})
}

func (h *LeadHandler) UpdateStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "lead id is required"})
		return
	}

	var payload struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	status := strings.TrimSpace(strings.ToLower(payload.Status))
	switch status {
	case "new", "in_review", "contacted", "closed":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid status"})
		return
	}

	if err := h.service.UpdateStatus(id, status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update lead"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "id": id, "status": status})
}

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

type RealityTVHandler struct {
	service services.RealityTVService
}

func NewRealityTVHandler(service services.RealityTVService) *RealityTVHandler {
	return &RealityTVHandler{service: service}
}

func (h *RealityTVHandler) Dashboard(c *gin.Context) {
	metrics, err := h.service.GetDashboardMetrics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load reality tv dashboard"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "metrics": metrics})
}
