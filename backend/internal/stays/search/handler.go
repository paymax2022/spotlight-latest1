package search

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/stays/gateway"
)

// Handler exposes the member search + property-content routes.
type Handler struct {
	svc *Service
}

// NewHandler constructs the search handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Search (member): GET /search?city=&check_in=&check_out=&rooms=&adults=&currency=
// Multi-rail fan-out + dedup + priced results. Per-rail failures are reported as
// `degraded` rails but never fail the whole search.
func (h *Handler) Search(c *gin.Context) {
	city := c.Query("city")
	ci, err1 := time.Parse("2006-01-02", c.Query("check_in"))
	co, err2 := time.Parse("2006-01-02", c.Query("check_out"))
	if err1 != nil || err2 != nil || !co.After(ci) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid check_in/check_out"})
		return
	}
	rooms := atoiDefault(c.Query("rooms"), 1)
	adults := atoiDefault(c.Query("adults"), 2)
	currency := c.DefaultQuery("currency", "NGN")

	results, railErrs := h.svc.Search(c.Request.Context(), gateway.SearchRequest{
		City:        city,
		CheckIn:     ci,
		CheckOut:    co,
		Rooms:       rooms,
		Occupancy:   gateway.Occupancy{Adults: adults},
		Currency:    currency,
		LoyaltyTier: c.Query("loyalty_tier"),
	})

	degraded := make([]string, 0, len(railErrs))
	for _, e := range railErrs {
		degraded = append(degraded, string(e.Rail))
	}
	c.JSON(http.StatusOK, gin.H{"data": results, "degraded_rails": degraded})
}

// Content (member): GET /properties/:rail/:supplier/:ref — normalised content.
func (h *Handler) Content(c *gin.Context) {
	content, err := h.svc.GetContent(c.Request.Context(),
		gateway.SourceRail(c.Param("rail")), c.Param("supplier"), c.Param("ref"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": content})
}

func atoiDefault(s string, def int) int {
	n := 0
	if s == "" {
		return def
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	if n == 0 {
		return def
	}
	return n
}
