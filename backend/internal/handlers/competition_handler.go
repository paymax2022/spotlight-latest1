package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

type CompetitionHandler struct{ service services.CompetitionService }

func NewCompetitionHandler(service services.CompetitionService) *CompetitionHandler {
	return &CompetitionHandler{service: service}
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
	c.JSON(http.StatusCreated, gin.H{"success": true, "competition": created})
}
