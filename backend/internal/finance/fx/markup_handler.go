package fx

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// MarkupHandler is the admin console for the Paymax FX markup
// (RBAC finance.admin.fx_markup). Operators work in PERCENT; the store keeps
// integer basis points.
type MarkupHandler struct {
	store *MarkupStore
}

// NewMarkupHandler builds the admin handler over a markup store.
func NewMarkupHandler(store *MarkupStore) *MarkupHandler { return &MarkupHandler{store: store} }

// SetMarkupRequest is the admin payload for PUT /api/finance/admin/fx/markup.
//
// RatePercent is a json.Number so the submitted literal survives parsing: "1.15"
// stays "1.15" and converts to exactly 115 bps, where a float64 round-trip yields
// 114.999…. Corridor defaults to the DEFAULT row. Active defaults to true when
// omitted, so the common case ("set the rate to 1%") is a one-field body.
type SetMarkupRequest struct {
	Corridor    string      `json:"corridor"`
	RatePercent json.Number `json:"ratePercent" binding:"required"`
	Active      *bool       `json:"active"`
	Notes       string      `json:"notes"`
	Note        string      `json:"note"` // free-text reason, recorded in the audit row
}

// ListRates handles GET /api/finance/admin/fx/markup.
func (h *MarkupHandler) ListRates(c *gin.Context) {
	rates, err := h.store.ListRates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rates})
}

// SetRate handles PUT /api/finance/admin/fx/markup.
//
// This changes what every customer pays on FX, so it is deliberately strict: an
// unparseable, too-precise, or out-of-range percentage is a 400 with a message
// naming the limit, never a silent clamp to something we invented.
func (h *MarkupHandler) SetRate(c *gin.Context) {
	var req SetMarkupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	bps, err := PercentToBPS(req.RatePercent.String())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	corridor := req.Corridor
	if NormalizeCorridor(corridor) == "" {
		corridor = DefaultCorridor
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}

	rate, err := h.store.SetRate(c.Request.Context(), corridor, bps, active,
		req.Notes, c.GetString("user_id"), req.Note)
	if err != nil {
		if errors.Is(err, ErrMarkupOutOfRange) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rate})
}

// ListAudit handles GET /api/finance/admin/fx/markup/audit?corridor=&limit=.
func (h *MarkupHandler) ListAudit(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	entries, err := h.store.ListAudit(c.Request.Context(), c.Query("corridor"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}
