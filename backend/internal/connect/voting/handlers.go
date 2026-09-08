package connectvoting

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/config"
)

// Handler exposes contests + free/paid voting over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a voting handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string  { return c.GetString("user_id") }
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func mapError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "contest not found"})
	case errors.Is(err, ErrNotOnRoster):
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": "that contestant is not in this contest"})
	case errors.Is(err, ErrContestClosed), errors.Is(err, ErrPaidUnavailable),
		errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrInvalidQuantity):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrFreeVoteUsed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrVelocity):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotContestant):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	default:
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"), strings.Contains(msg, "disabled"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "vote failed"})
		}
	}
}

// ListContests — GET /api/v1/connect/contests (member).
func (h *Handler) ListContests(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	out, err := h.svc.ListContests(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetContest — GET /api/v1/connect/contests/:id (member).
func (h *Handler) GetContest(c *gin.Context) {
	out, err := h.svc.GetContest(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// FreeVote — POST /api/v1/connect/contests/:id/vote (member). No money.
func (h *Handler) FreeVote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req FreeVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.FreeVote(c.Request.Context(), c.Param("id"), uid, req)
	if err != nil {
		mapError(c, err)
		return
	}
	// Return the post-vote allowance so the client shows the real remaining
	// count instead of inferring one.
	allowance, allowErr := h.svc.FreeVoteAllowanceFor(c.Request.Context(), c.Param("id"), uid)
	resp := gin.H{"data": v}
	if allowErr == nil {
		resp["allowance"] = allowance
	}
	c.JSON(http.StatusCreated, resp)
}

// PaidVote — POST /api/v1/connect/contests/:id/paid-vote (member, Idempotency-Key).
func (h *Handler) PaidVote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req PaidVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.PaidVote(c.Request.Context(), c.Param("id"), uid, idemKey(c), req)
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": v})
}

// Results — GET /api/v1/connect/contests/:id/results (member).
func (h *Handler) Results(c *gin.Context) {
	out, err := h.svc.Results(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListRoster — GET /api/v1/connect/contests/:id/contestants (member).
// The contest's active contestants, ranked by total votes. This is what the
// mobile app renders as the contestant list and the leaderboard: both views
// are the same ranked roster, so a vote cast moves both consistently.
func (h *Handler) ListRoster(c *gin.Context) {
	roster, err := h.svc.ListRoster(c.Request.Context(), c.Param("id"), false)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "contest not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load contestants"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": roster})
}

// FreeVoteAllowance — GET /api/v1/connect/contests/:id/free-vote-allowance.
// How many free votes the caller has left in this contest. Server-computed:
// the client must not derive it, or two surfaces will disagree about how many
// votes a user really has.
func (h *Handler) FreeVoteAllowance(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	a, err := h.svc.FreeVoteAllowanceFor(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// GetContestant — GET /api/v1/connect/contestants/:id (member).
// One contestant with its live tally and rank, keyed on the contestant id alone.
func (h *Handler) GetContestant(c *gin.Context) {
	e, err := h.svc.GetContestant(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "contestant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load contestant"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": e})
}

// GetStages — GET /api/v1/connect/contests/:id/stages (member).
func (h *Handler) GetStages(c *gin.Context) {
	stages, err := h.svc.GetStages(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stages})
}

// PermissionGuard mirrors middleware.RequirePermission: route file supplies
// a factory that builds the per-permission gin.HandlerFunc.
type PermissionGuard func(permission string) gin.HandlerFunc

// Register wires the voting routes onto the auth-gated member group.
func Register(member gin.IRouter, svc *Service, cfg config.Config) {
	h := NewHandler(svc)
	member.GET("/contests", h.ListContests)
	member.GET("/contests/:id", h.GetContest)
	member.POST("/contests/:id/vote", h.FreeVote)      // free
	member.POST("/contests/:id/paid-vote", h.PaidVote) // Idempotency-Key required
	member.GET("/contests/:id/results", h.Results)
	member.GET("/contests/:id/contestants", h.ListRoster)
	member.GET("/contests/:id/free-vote-allowance", h.FreeVoteAllowance)
	member.GET("/contestants/:id", h.GetContestant)
	// The caller's own voting history, and — for a contestant — who voted for
	// them. Both are member-group routes: authorisation is per-row inside the
	// service (own votes; own contestant), not per-route.
	member.GET("/votes/mine", h.MyVotes)
	member.GET("/votes/:id", h.VoteReceipt)
	member.GET("/notifications", h.Notifications)
	member.GET("/contestants/:id/supporters", h.Supporters)
	member.GET("/contests/:id/stages", h.GetStages)

	// Stage eviction routes — gated behind FEATURE_CONTEST_STAGE_EVICTION_ENABLED.
	// Admin routes with RBAC guards are in RegisterAdmin.
	if !cfg.FeatureContestStageEvictionEnabled {
		log.Println("[connect-voting] FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off — skipping eviction routes")
		return
	}

	// READ-ONLY for members. The eviction MUTATIONS (evict, save,
	// extend-grace-period, finalize-evictions, admin-vote) are deliberately NOT
	// registered here: the member group carries authentication but no RBAC, and
	// the handlers themselves do not check permissions, so registering them on
	// this group let any signed-in user evict contestants or cast admin votes.
	// They live in RegisterAdmin only, each behind its connect.contests.* guard.
	member.GET("/contests/:id/stages/:stageNum/contestants", h.GetContestantsByStage)
	member.GET("/contests/:id/evictions", h.GetEvictions)
}

// RegisterAdmin wires admin eviction routes with RBAC permission guards.
// The caller passes a guard factory (built from middleware.RequirePermission + the RBAC
// service) so each route enforces its connect.contests.* permission.
// Gated behind FEATURE_CONTEST_STAGE_EVICTION_ENABLED.
func RegisterAdmin(admin gin.IRouter, svc *Service, guard PermissionGuard, cfg config.Config) {
	if !cfg.FeatureContestStageEvictionEnabled {
		log.Println("[connect-voting-admin] FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off — skipping admin eviction routes")
		return
	}

	h := NewHandler(svc)
	g := admin.Group("/contests")

	// Admin-only eviction management
	g.POST("/:id/stages/:stageNum/evict",
		guard("connect.contests.manage"),
		h.TriggerEvictions)
	g.POST("/:id/extend-grace-period",
		guard("connect.contests.manage"),
		h.ExtendGracePeriod)
	g.POST("/:id/stages/:stageNum/finalize-evictions",
		guard("connect.contests.manage"),
		h.FinalizeEvictions)
	g.POST("/:id/admin-vote",
		guard("connect.contests.manage"),
		h.AdminVote)

	// Judge/admin save (can have different permission if needed)
	g.POST("/:id/save",
		guard("connect.contests.judge"),
		h.SaveContestant)

	// View routes (lower permission level)
	g.GET("/:id/evictions",
		guard("connect.contests.view"),
		h.GetEvictions)
	g.GET("/:id/stages/:stageNum/contestants",
		guard("connect.contests.view"),
		h.GetContestantsByStage)
}

// ─── My votes / contestant supporters ────────────────────────────────────────

// MyVotes — GET /connect/votes/mine?contestId=&voteType=FREE|PAID
//
// The screen that reads this used to call GET /voting/my-votes, a path nothing
// served: it answered 404 with an HTML body, and with mock mode off the list
// could never render a single row.
func (h *Handler) MyVotes(c *gin.Context) {
	vt := strings.ToUpper(strings.TrimSpace(c.Query("voteType")))
	list, err := h.svc.MyVotes(c.Request.Context(), userID(c), c.Query("contestId"),
		vt == "PAID", vt == "FREE")
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// Supporters — GET /connect/contestants/:id/supporters
//
// Contestant-only: the service refuses anyone who does not own the contestant.
// Votes cast under allow_anonymous_free_vote come back flagged with no name.
func (h *Handler) Supporters(c *gin.Context) {
	list, err := h.svc.Supporters(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// VoteReceipt — GET /connect/votes/:id
//
// The receipt screen called GET /voting/transactions/:id/receipt, another path
// nothing served. My Votes rows are tappable and push straight here, so a
// working list would otherwise have led to a dead screen.
func (h *Handler) VoteReceipt(c *gin.Context) {
	v, err := h.svc.MyVote(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": v})
}

// Notifications — GET /connect/notifications
//
// The screen called GET /voting/notifications, which nothing served. The feed is
// DERIVED: there is no notifications store in this module, so it reports the two
// kinds the database can actually evidence. See Repository.Notifications.
func (h *Handler) Notifications(c *gin.Context) {
	list, err := h.svc.Notifications(c.Request.Context(), userID(c))
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}
