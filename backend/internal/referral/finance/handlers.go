package finance

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes admin finance/payout endpoints (no member surface — payouts are
// admin-governed; members see their rewards via the RB0 ledger handler).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires finance routes onto the referral admin group.
//   - admin: /api/referral/admin/finance/*  (RBAC referral.payout.* / referral.finance.view)
func Register(admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	ag := admin.Group("/finance")
	// payout queue + approvals
	ag.GET("/payouts", guard("referral.payout.view"), h.ListPayouts)
	ag.POST("/payouts", guard("referral.payout.manage"), h.QueuePayout)
	ag.POST("/payouts/:id/approve", guard("referral.payout.manage"), h.ApprovePayout)
	ag.POST("/payouts/:id/reject", guard("referral.payout.manage"), h.RejectPayout)
	// reconciliation
	ag.GET("/reconciliation", guard("referral.finance.view"), h.ListReconciliations)
	ag.POST("/reconciliation", guard("referral.finance.view"), h.Reconcile)
	// budgets & burn
	ag.GET("/budgets", guard("referral.finance.view"), h.ListBudgets)
	ag.PUT("/budgets", guard("referral.payout.manage"), h.UpsertBudget)
	// float
	ag.GET("/float", guard("referral.finance.view"), h.LatestFloat)
	ag.POST("/float", guard("referral.payout.manage"), h.SnapshotFloat)
	// reward-to-LTV
	ag.GET("/reward-to-ltv", guard("referral.finance.view"), h.RewardToLTV)
}

func uid(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return c.GetString("user_id")
}

func (h *Handler) ListPayouts(c *gin.Context) {
	list, err := h.svc.ListPayouts(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payouts": list})
}

func (h *Handler) QueuePayout(c *gin.Context) {
	var in PayoutRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	p, err := h.svc.QueuePayout(c.Request.Context(), in, uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"payout": p})
}

func (h *Handler) ApprovePayout(c *gin.Context) {
	p, err := h.svc.ApprovePayout(c.Request.Context(), c.Param("id"), uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payout": p})
}

func (h *Handler) RejectPayout(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.RejectPayout(c.Request.Context(), c.Param("id"), uid(c), body.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ListReconciliations(c *gin.Context) {
	list, err := h.svc.ListReconciliations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliations": list})
}

func (h *Handler) Reconcile(c *gin.Context) {
	rc, err := h.svc.Reconcile(c.Request.Context(), c.Query("since"), c.Query("until"), uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": rc})
}

func (h *Handler) ListBudgets(c *gin.Context) {
	list, err := h.svc.ListBudgets(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"budgets": list})
}

func (h *Handler) UpsertBudget(c *gin.Context) {
	var in BudgetInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	b, err := h.svc.UpsertBudget(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"budget": b})
}

func (h *Handler) LatestFloat(c *gin.Context) {
	f, err := h.svc.LatestFloat(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"float": f})
}

func (h *Handler) SnapshotFloat(c *gin.Context) {
	var body struct {
		FundedKobo int64  `json:"funded_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	f, err := h.svc.SnapshotFloat(c.Request.Context(), body.FundedKobo, body.Note)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"float": f})
}

func (h *Handler) RewardToLTV(c *gin.Context) {
	r, err := h.svc.RewardToLTV(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reward_to_ltv": r})
}
