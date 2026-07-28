package reviews

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member + extranet + admin review surfaces. RBAC is applied at
// the route by the aggregator; object-level checks are in the service.
type Handler struct {
	svc *Service
}

// NewHandler constructs the reviews handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotCompleted):
		c.JSON(http.StatusPreconditionFailed, gin.H{"error": err.Error(), "code": "REVIEW_LOCKED"})
	case errors.Is(err, ErrNotOwner), errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrAlreadyReviewed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "ALREADY_REVIEWED"})
	case errors.Is(err, ErrBadScore):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func pageParams(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	return limit, offset
}

// RegisterMember wires the guest-facing review routes onto the member group. Paths
// are chosen to avoid Gin param-node collisions with the SB0 member tree (which uses
// /properties/:rail/... and /reservations/:id/...): property/review lookups take
// query params rather than introducing a conflicting wildcard at /properties/:X or
// /reviews/:X, and the verified-guest create/eligibility reuse the SB0 :id node.
func (h *Handler) RegisterMember(g *gin.RouterGroup) {
	g.GET("/reviews", h.ListByProperty)                          // ?property_id= (PUBLISHED)
	g.GET("/reviews-mine", h.ListMine)                           // my reviews
	g.GET("/review-response", h.GetResponse)                     // ?review_id= (hotelier response)
	g.GET("/reservations/:id/review-eligibility", h.CanReview)   // REVIEWABLE check
	g.POST("/reservations/:id/review", h.Create)                 // verified-guest create
}

// RegisterExtranet wires the hotelier review routes onto the extranet group.
func (h *Handler) RegisterExtranet(g *gin.RouterGroup) {
	g.GET("/properties/:propertyId/reviews", h.ListForHotelier)
	g.POST("/reviews/:reviewId/response", h.Respond)
	g.POST("/reviews/:reviewId/flag", h.Flag)
}

// RegisterAdmin wires the admin moderation routes onto the admin group. The review
// listing takes property_id as a QUERY param (not a path param) so it never collides
// with the SB0 admin tree's /properties/:id/* nodes when both register on the same
// /api/stays/admin group.
func (h *Handler) RegisterAdmin(g *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	g.GET("/reviews", guard("stays.admin.review"), h.ListForAdminProperty)
	g.POST("/reviews/:reviewId/moderate", guard("stays.admin.review"), h.Moderate)
}

// --- member handlers ---

// ListByProperty: GET /reviews?property_id=...
func (h *Handler) ListByProperty(c *gin.Context) {
	limit, offset := pageParams(c)
	out, err := h.svc.ListByProperty(c.Request.Context(), c.Query("property_id"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CanReview: GET /reservations/:id/review-eligibility
func (h *Handler) CanReview(c *gin.Context) {
	ok, err := h.svc.CanReview(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		// Distinguish locked vs not-owner but never 500 for the normal "locked" path.
		switch {
		case errors.Is(err, ErrNotCompleted):
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"can_review": false, "reason": "NOT_COMPLETED"}})
			return
		case errors.Is(err, ErrNotOwner):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		default:
			mapErr(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"can_review": ok}})
}

// Create: POST /reservations/:id/review {overall_score, sub_scores, title, body}
func (h *Handler) Create(c *gin.Context) {
	var b struct {
		OverallScore int            `json:"overall_score" binding:"required"`
		SubScores    map[string]any `json:"sub_scores"`
		Title        string         `json:"title"`
		Body         string         `json:"body"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.Create(c.Request.Context(), uid(c), c.Param("id"), b.OverallScore, b.SubScores, b.Title, b.Body)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"id": id}})
}

// ListMine: GET /me/reviews
func (h *Handler) ListMine(c *gin.Context) {
	limit, offset := pageParams(c)
	out, err := h.svc.ListMine(c.Request.Context(), uid(c), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetResponse: GET /review-response?review_id=...
func (h *Handler) GetResponse(c *gin.Context) {
	rsp, err := h.svc.GetResponse(c.Request.Context(), c.Query("review_id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rsp})
}

// --- extranet handlers ---

// ListForHotelier: GET /properties/:propertyId/reviews (extranet)
func (h *Handler) ListForHotelier(c *gin.Context) {
	limit, offset := pageParams(c)
	out, err := h.svc.ListForHotelier(c.Request.Context(), uid(c), c.Param("propertyId"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Respond: POST /reviews/:reviewId/response {body}
func (h *Handler) Respond(c *gin.Context) {
	var b struct {
		Body string `json:"body" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.Respond(c.Request.Context(), uid(c), c.Param("reviewId"), b.Body)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// Flag: POST /reviews/:reviewId/flag {reason}
func (h *Handler) Flag(c *gin.Context) {
	var b struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&b)
	if err := h.svc.FlagAsHotelier(c.Request.Context(), uid(c), c.Param("reviewId"), b.Reason); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// --- admin handlers ---

// ListForAdminProperty: GET /reviews?property_id=... (admin)
func (h *Handler) ListForAdminProperty(c *gin.Context) {
	limit, offset := pageParams(c)
	out, err := h.svc.ListForAdminProperty(c.Request.Context(), c.Query("property_id"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Moderate: POST /reviews/:reviewId/moderate {status, reason}
func (h *Handler) Moderate(c *gin.Context) {
	var b struct {
		Status string `json:"status" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Moderate(c.Request.Context(), c.Param("reviewId"), b.Status, b.Reason); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
