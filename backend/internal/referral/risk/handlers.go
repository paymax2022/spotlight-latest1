package risk

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes member + admin risk endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register wires risk routes.
//   - member: /api/finance/referral/risk/{my-status,report-abuse}
//   - admin : /api/referral/admin/risk/*  (RBAC referral.risk.*)
func Register(member, admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)

	mg := member.Group("/risk")
	mg.GET("/my-status", h.MyStatus)        // A-USR-04 my fraud-status
	mg.POST("/report-abuse", h.ReportAbuse) // member report-abuse

	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ag := admin.Group("/risk")
	// dashboard + alerts
	ag.GET("/dashboard", guard("referral.risk.view"), h.Dashboard)
	ag.GET("/alerts", guard("referral.risk.view"), h.ListAlerts)
	ag.POST("/alerts/:id/status", guard("referral.risk.manage"), h.SetAlertStatus)
	// rules CRUD
	ag.GET("/rules", guard("referral.risk.view"), h.ListRules)
	ag.PUT("/rules", guard("referral.risk.manage"), h.UpsertRule)
	ag.POST("/rules/:id/enabled", guard("referral.risk.manage"), h.SetRuleEnabled)
	// evaluate (engine trigger)
	ag.POST("/evaluate", guard("referral.risk.manage"), h.Evaluate)
	// investigation / case workbench
	ag.GET("/cases", guard("referral.risk.view"), h.ListCases)
	ag.POST("/cases", guard("referral.risk.manage"), h.OpenCase)
	ag.GET("/cases/:id", guard("referral.risk.view"), h.CaseWorkbench)
	ag.POST("/cases/:id/status", guard("referral.risk.manage"), h.UpdateCaseStatus)
	// blocklist / allowlist
	ag.GET("/blocklist", guard("referral.risk.view"), h.ListBlocklist)
	ag.POST("/blocklist", guard("referral.risk.blocklist"), h.AddBlocklist)
	ag.POST("/blocklist/:id/deactivate", guard("referral.risk.blocklist"), h.DeactivateBlocklist)
	// review queue
	ag.GET("/review-queue", guard("referral.risk.view"), h.ListReviewQueue)
	ag.POST("/review-queue/:id/approve", guard("referral.risk.manage"), h.ApproveReview)
	ag.POST("/review-queue/:id/reject", guard("referral.risk.manage"), h.RejectReview)
	// clawback exec + history
	ag.POST("/clawbacks", guard("referral.risk.manage"), h.ExecuteClawback)
	ag.GET("/clawbacks", guard("referral.risk.view"), h.ClawbackHistory)
}

func uid(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return c.GetString("user_id")
}

// --- member ---

func (h *Handler) MyStatus(c *gin.Context) {
	id := uid(c)
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	st, err := h.svc.MyFraudStatus(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": st})
}

func (h *Handler) ReportAbuse(c *gin.Context) {
	id := uid(c)
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var in ReportInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	a, err := h.svc.ReportAbuse(c.Request.Context(), id, in)
	if err != nil {
		// A reporter with no referrer is an expected state, not a malformed
		// request; give it a machine-readable reason so the app can say so.
		if errors.Is(err, ErrNoReferrerToReport) {
			c.JSON(http.StatusConflict, gin.H{
				"error": "you have no referrer to report", "reason": "no_referrer"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"alert": a})
}

// --- admin: dashboard + alerts ---

func (h *Handler) Dashboard(c *gin.Context) {
	d, err := h.svc.Dashboard(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"dashboard": d})
}

func (h *Handler) ListAlerts(c *gin.Context) {
	list, err := h.svc.ListAlerts(c.Request.Context(), c.Query("status"), 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": list})
}

func (h *Handler) SetAlertStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status"`
		CaseID string `json:"case_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.SetAlertStatus(c.Request.Context(), c.Param("id"), body.Status, body.CaseID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- admin: rules ---

func (h *Handler) ListRules(c *gin.Context) {
	list, err := h.svc.ListRules(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": list})
}

func (h *Handler) UpsertRule(c *gin.Context) {
	var in RuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	r, err := h.svc.UpsertRule(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": r})
}

func (h *Handler) SetRuleEnabled(c *gin.Context) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.SetRuleEnabled(c.Request.Context(), c.Param("id"), body.Enabled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- admin: evaluate ---

func (h *Handler) Evaluate(c *gin.Context) {
	var in EvaluateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	res, err := h.svc.Evaluate(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": res})
}

// --- admin: cases ---

func (h *Handler) ListCases(c *gin.Context) {
	list, err := h.svc.ListCases(c.Request.Context(), c.Query("status"), 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cases": list})
}

func (h *Handler) OpenCase(c *gin.Context) {
	var body struct {
		SubjectID   string   `json:"subject_id"`
		ReasonCodes []string `json:"reason_codes"`
		Notes       string   `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	cs, err := h.svc.OpenCase(c.Request.Context(), body.SubjectID, body.ReasonCodes, uid(c), body.Notes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"case": cs})
}

func (h *Handler) CaseWorkbench(c *gin.Context) {
	cs, alerts, err := h.svc.CaseWorkbench(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"case": cs, "alerts": alerts})
}

func (h *Handler) UpdateCaseStatus(c *gin.Context) {
	var body struct {
		Status     string `json:"status"`
		Resolution string `json:"resolution"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.UpdateCaseStatus(c.Request.Context(), c.Param("id"), body.Status, body.Resolution, uid(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- admin: blocklist ---

func (h *Handler) ListBlocklist(c *gin.Context) {
	list, err := h.svc.ListBlocklist(c.Request.Context(), c.Query("list_type"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": list})
}

func (h *Handler) AddBlocklist(c *gin.Context) {
	var in BlocklistInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	e, err := h.svc.AddBlocklist(c.Request.Context(), in, uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"entry": e})
}

func (h *Handler) DeactivateBlocklist(c *gin.Context) {
	if err := h.svc.DeactivateBlocklist(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- admin: review queue ---

func (h *Handler) ListReviewQueue(c *gin.Context) {
	list, err := h.svc.ListReviewQueue(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}

func (h *Handler) ApproveReview(c *gin.Context) {
	if err := h.svc.ApproveReview(c.Request.Context(), c.Param("id"), uid(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) RejectReview(c *gin.Context) {
	if err := h.svc.RejectReview(c.Request.Context(), c.Param("id"), uid(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- admin: clawback ---

func (h *Handler) ExecuteClawback(c *gin.Context) {
	var in ClawbackInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	if err := h.svc.ExecuteClawback(c.Request.Context(), in, uid(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ClawbackHistory lists clawback decisions from the review queue (status=clawed_back).
func (h *Handler) ClawbackHistory(c *gin.Context) {
	list, err := h.svc.ListReviewQueue(c.Request.Context(), ReviewClawedBack)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clawbacks": list})
}
