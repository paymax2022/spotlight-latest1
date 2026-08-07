package social

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/cashtag"
)

// Handler exposes the Social Pay member API. user_id is mirrored onto the gin
// context by the finance group. Object-level authZ is enforced in the service:
// the caller's session id is ALWAYS used as the acting identity (never a
// client-supplied id) so a user can never act as someone else.
type Handler struct {
	svc  *Service
	tags *cashtag.Service
}

func NewHandler(svc *Service, tags *cashtag.Service) *Handler {
	return &Handler{svc: svc, tags: tags}
}

func uid(c *gin.Context) string { return c.GetString("user_id") }

func reqIdem(c *gin.Context) (string, bool) {
	k := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Idempotency-Key required"})
		return "", false
	}
	return k, true
}

func fail(c *gin.Context, err error) {
	switch err {
	case ErrForbidden:
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
	case ErrNotFound, cashtag.ErrNotFound:
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
	case ErrAMLSingleLimit, ErrAMLCountLimit, ErrAMLAmountLimit:
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": err.Error()})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
	}
}

// ───────────────────────── cashtag ─────────────────────────

func (h *Handler) ClaimHandle(c *gin.Context) {
	var req struct {
		Handle string `json:"handle"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	hd, err := h.tags.Claim(c.Request.Context(), uid(c), req.Handle)
	if err != nil {
		switch err {
		case cashtag.ErrTaken, cashtag.ErrAlreadyClaimed:
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error()})
		case cashtag.ErrReserved, cashtag.ErrImpersonation:
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "handle": hd})
}

func (h *Handler) ResolveHandle(c *gin.Context) {
	id, err := h.tags.Resolve(c.Request.Context(), c.Param("handle"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "user_id": id})
}

func (h *Handler) MyHandle(c *gin.Context) {
	hd, err := h.tags.HandleFor(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "handle": hd})
}

// ───────────────────────── P2P ─────────────────────────

func (h *Handler) Send(c *gin.Context) {
	key, ok := reqIdem(c)
	if !ok {
		return
	}
	var req struct {
		Handle     string `json:"handle"`
		AmountKobo int64  `json:"amount_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	p, err := h.svc.Send(c.Request.Context(), uid(c), req.Handle, req.Note, key, req.AmountKobo)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "payment": p})
}

func (h *Handler) CreateRequest(c *gin.Context) {
	var req struct {
		Handle     string `json:"handle"`
		AmountKobo int64  `json:"amount_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	r, err := h.svc.CreateRequest(c.Request.Context(), uid(c), req.Handle, req.Note, req.AmountKobo)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "request": r})
}

func (h *Handler) PayRequest(c *gin.Context) {
	if err := h.svc.PayRequest(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) DeclineRequest(c *gin.Context) {
	if err := h.svc.DeclineRequest(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) CancelRequest(c *gin.Context) {
	if err := h.svc.CancelRequest(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ───────────────────────── split ─────────────────────────

func (h *Handler) CreateSplit(c *gin.Context) {
	var req struct {
		Title     string       `json:"title"`
		TotalKobo int64        `json:"total_kobo"`
		Mode      string       `json:"mode"`
		Shares    []ShareInput `json:"shares"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bill, shares, err := h.svc.CreateSplit(c.Request.Context(), uid(c), req.Title, req.TotalKobo, SplitMode(strings.ToUpper(req.Mode)), req.Shares)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "bill": bill, "shares": shares})
}

func (h *Handler) GetSplit(c *gin.Context) {
	splitID := c.Param("id")
	ok, err := h.svc.IsSplitParticipant(c.Request.Context(), splitID, uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "not a participant"})
		return
	}
	bill, shares, err := h.svc.GetSplit(c.Request.Context(), splitID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "bill": bill, "shares": shares})
}

func (h *Handler) PayShare(c *gin.Context) {
	key, _ := reqIdem(c)
	if err := h.svc.PayShare(c.Request.Context(), uid(c), c.Param("shareId"), key); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ───────────────────────── pool ─────────────────────────

func (h *Handler) CreatePool(c *gin.Context) {
	var req struct {
		Title         string  `json:"title"`
		BeneficiaryID *string `json:"beneficiary_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	p, err := h.svc.CreatePool(c.Request.Context(), uid(c), req.Title, req.BeneficiaryID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "pool": p})
}

func (h *Handler) ContributePool(c *gin.Context) {
	key, ok := reqIdem(c)
	if !ok {
		return
	}
	var req struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bal, err := h.svc.ContributePool(c.Request.Context(), uid(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) PayoutPool(c *gin.Context) {
	key, ok := reqIdem(c)
	if !ok {
		return
	}
	if err := h.svc.PayoutPool(c.Request.Context(), uid(c), c.Param("id"), key); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) PoolBalance(c *gin.Context) {
	bal, err := h.svc.PoolBalance(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

// ───────────────────────── member lists (go-live gap) ─────────────────────────

func queryLimit(c *gin.Context) int {
	n, _ := strconv.Atoi(c.Query("limit"))
	return n
}

func (h *Handler) Activity(c *gin.Context) {
	items, err := h.svc.ActivityFeed(c.Request.Context(), uid(c), queryLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "activity": items})
}

func (h *Handler) ListRequests(c *gin.Context) {
	items, err := h.svc.ListRequests(c.Request.Context(), uid(c), queryLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "requests": items})
}

func (h *Handler) ListSplits(c *gin.Context) {
	items, err := h.svc.ListSplits(c.Request.Context(), uid(c), queryLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "splits": items})
}

func (h *Handler) ListPools(c *gin.Context) {
	items, err := h.svc.ListPools(c.Request.Context(), uid(c), queryLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pools": items})
}

// Register mounts social member routes on the finance group; admin oversight on
// the social admin group (RBAC social.admin.*).
func (h *Handler) Register(member *gin.RouterGroup, admin *gin.RouterGroup, guard func(string) gin.HandlerFunc) {
	g := member.Group("/social")
	// activity feed
	g.GET("/activity", h.Activity)
	// cashtag directory
	g.POST("/handle", h.ClaimHandle)
	g.GET("/handle/me", h.MyHandle)
	g.GET("/handle/:handle", h.ResolveHandle)
	// P2P
	g.POST("/send", h.Send)
	g.GET("/requests", h.ListRequests)
	g.POST("/requests", h.CreateRequest)
	g.POST("/requests/:id/pay", h.PayRequest)
	g.POST("/requests/:id/decline", h.DeclineRequest)
	g.POST("/requests/:id/cancel", h.CancelRequest)
	// split bill
	g.GET("/splits", h.ListSplits)
	g.POST("/splits", h.CreateSplit)
	g.GET("/splits/:id", h.GetSplit)
	g.POST("/splits/:id/shares/:shareId/pay", h.PayShare)
	// group pool
	g.GET("/pools", h.ListPools)
	g.POST("/pools", h.CreatePool)
	g.GET("/pools/:id/balance", h.PoolBalance)
	g.POST("/pools/:id/contribute", h.ContributePool)
	g.POST("/pools/:id/payout", h.PayoutPool)

	if admin != nil && guard != nil {
		admin.GET("/splits/:id", guard("social.admin.view"), h.GetSplit)
	}
}
