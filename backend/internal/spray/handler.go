package spray

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes spray member endpoints (send + leaderboard). The sender is always
// the authenticated caller (user_id from context) — a client can never spray FROM
// another user.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GuardFunc returns a permission-checking middleware.
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes.
//
//	member: /api/finance/spray/*
//	admin : /api/spray/admin/*  (RBAC spray.*)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.POST("/spray", h.Spray)
	member.GET("/spray/leaderboard/:contextRef", h.Leaderboard)

	// Admin: AML oversight reads the same leaderboard projection plus raw transfers.
	admin.GET("/spray/leaderboard/:contextRef", guard("spray.read"), h.Leaderboard)
}

type sprayRequest struct {
	ToUserID   string `json:"to_user_id" binding:"required"`
	ContextRef string `json:"context_ref" binding:"required"`
	AmountKobo int64  `json:"amount_kobo" binding:"required"`
}

func (h *Handler) Spray(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req sprayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sp, err := h.svc.Spray(c.Request.Context(), userID, req.ToUserID, req.ContextRef, idem, req.AmountKobo)
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case ErrAMLSingleLimit, ErrAMLDailyLimit, ErrAMLDailyCount:
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "spray": sp})
}

func (h *Handler) Leaderboard(c *gin.Context) {
	rows, err := h.svc.Leaderboard(c.Request.Context(), c.Param("contextRef"), 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "leaderboard": rows})
}
