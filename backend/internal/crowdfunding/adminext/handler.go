package adminext

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the crowdfunding admin domain over gin. The admin id is read
// from the gin context ("user_id"), populated by the requireUserID() middleware
// the admin group is registered with.
type Handler struct{ svc *Service }

// NewHandler constructs the admin handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ─── Finance ─────────────────────────────────────────────────────────────────

// FinanceSummary — GET /finance/summary (singleton, returned directly).
func (h *Handler) FinanceSummary(c *gin.Context) {
	res, err := h.svc.GetFinanceSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListRefunds — GET /refunds.
func (h *Handler) ListRefunds(c *gin.Context) {
	items, err := h.svc.ListRefunds(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"refunds": items})
}

// ApproveRefund — POST /refunds/:id/approve.
func (h *Handler) ApproveRefund(c *gin.Context) { h.decideRefund(c, true) }

// RejectRefund — POST /refunds/:id/reject.
func (h *Handler) RejectRefund(c *gin.Context) { h.decideRefund(c, false) }

func (h *Handler) decideRefund(c *gin.Context, approve bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.DecideRefund(c.Request.Context(), c.Param("id"), c.GetString("user_id"), approve, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListSettlements — GET /settlements.
func (h *Handler) ListSettlements(c *gin.Context) {
	items, err := h.svc.ListSettlements(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"batches": items})
}

// ─── Disputes ────────────────────────────────────────────────────────────────

// ListDisputes — GET /disputes.
func (h *Handler) ListDisputes(c *gin.Context) {
	items, err := h.svc.ListDisputes(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"disputes": items})
}

// ResolveDispute — POST /disputes/:id/resolve.
func (h *Handler) ResolveDispute(c *gin.Context) {
	var req ResolveDisputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ResolveDispute(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req.Resolution, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Withdrawals ─────────────────────────────────────────────────────────────

// ListWithdrawals — GET /withdrawals.
func (h *Handler) ListWithdrawals(c *gin.Context) {
	items, err := h.svc.ListWithdrawals(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": items})
}

// ApproveWithdrawal — POST /withdrawals/:id/approve.
//
// MONEY-PATH: releases campaign escrow to the payout-clearing account and marks
// the withdrawal COMPLETED. Requires an Idempotency-Key header (fail-closed).
func (h *Handler) ApproveWithdrawal(c *gin.Context) {
	idempotencyKey := c.GetHeader("Idempotency-Key")
	if idempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header is required"})
		return
	}
	res, err := h.svc.ApproveWithdrawal(c.Request.Context(), c.Param("id"), c.GetString("user_id"), idempotencyKey)
	if err != nil {
		switch {
		case errors.Is(err, ErrWithdrawalNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case errors.Is(err, ErrWithdrawalIllegalState):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, res)
}

// RejectWithdrawal — POST /withdrawals/:id/reject.
func (h *Handler) RejectWithdrawal(c *gin.Context) { h.decideWithdrawal(c, false) }

func (h *Handler) decideWithdrawal(c *gin.Context, approve bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.DecideWithdrawal(c.Request.Context(), c.Param("id"), c.GetString("user_id"), approve, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Fraud ───────────────────────────────────────────────────────────────────

// ListFraudAlerts — GET /fraud-alerts.
func (h *Handler) ListFraudAlerts(c *gin.Context) {
	items, err := h.svc.ListFraudAlerts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": items})
}

// FreezeCampaign — POST /campaigns/:id/freeze.
func (h *Handler) FreezeCampaign(c *gin.Context) { h.setFreeze(c, true) }

// UnfreezeCampaign — POST /campaigns/:id/unfreeze.
func (h *Handler) UnfreezeCampaign(c *gin.Context) { h.setFreeze(c, false) }

func (h *Handler) setFreeze(c *gin.Context, freeze bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.SetCampaignFreeze(c.Request.Context(), c.Param("id"), c.GetString("user_id"), freeze, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── KYC / KYB ───────────────────────────────────────────────────────────────

// ListKyc — GET /kyc.
func (h *Handler) ListKyc(c *gin.Context) {
	items, err := h.svc.ListKyc(c.Request.Context(), c.Query("kind"), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cases": items})
}

// ApproveKyc — POST /kyc/:id/approve.
func (h *Handler) ApproveKyc(c *gin.Context) { h.decideKyc(c, true) }

// RejectKyc — POST /kyc/:id/reject.
func (h *Handler) RejectKyc(c *gin.Context) { h.decideKyc(c, false) }

func (h *Handler) decideKyc(c *gin.Context, approve bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.DecideKyc(c.Request.Context(), c.Param("id"), c.GetString("user_id"), approve, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Compliance ──────────────────────────────────────────────────────────────

// ComplianceSummary — GET /compliance/summary (singleton, returned directly).
func (h *Handler) ComplianceSummary(c *gin.Context) {
	res, err := h.svc.GetComplianceSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListAuditLogs — GET /compliance/audit-logs.
func (h *Handler) ListAuditLogs(c *gin.Context) {
	items, err := h.svc.ListAuditLogs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"logs": items})
}

// ListDataRequests — GET /compliance/data-requests.
func (h *Handler) ListDataRequests(c *gin.Context) {
	items, err := h.svc.ListDataRequests(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": items})
}

// FulfilDataRequest — POST /compliance/data-requests/:id/fulfil.
func (h *Handler) FulfilDataRequest(c *gin.Context) {
	if err := h.svc.FulfilDataRequest(c.Request.Context(), c.Param("id"), c.GetString("user_id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Users ───────────────────────────────────────────────────────────────────

// ListUsers — GET /users.
func (h *Handler) ListUsers(c *gin.Context) {
	items, err := h.svc.ListUsers(c.Request.Context(), c.Query("role"), c.Query("status"), c.Query("search"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": items})
}

// SetUserStatus — POST /users/:id/status.
func (h *Handler) SetUserStatus(c *gin.Context) {
	var req SetUserStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetUserStatus(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req.Status, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
