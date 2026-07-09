package crypto

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// This file adds the crypto ADMIN oversight HTTP handlers that back the admin
// console (frontend-admin/app/admin/crypto/{withdrawals,swaps,addresses,
// reconciliation}). They are gated by RBAC crypto.admin at the route (see
// routes.go). Response envelopes match what the frontend service unwraps
// (cryptoAdminService.ts):
//   GET  /admin/crypto/withdrawals            → {withdrawals:[...]}
//   POST /admin/crypto/withdrawals/:id/decision → {withdrawal:{...}}
//   GET  /admin/crypto/swaps                  → {swaps:[...]}
//   GET  /admin/crypto/addresses              → {addresses:[...]}
//   POST /admin/crypto/addresses/:id/decision → {address:{...}}
//   GET  /admin/crypto/reconciliation         → {rows:[...],breaks:N,as_of:"..."}
// Error handling reuses httpErrExt (extended-path error → HTTP mapping).

// AdminListWithdrawals GET /admin/crypto/withdrawals?status=&limit=&offset=.
func (h *Handler) AdminListWithdrawals(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	limit, offset := pageParams(c)
	ws, err := h.svc.AdminListWithdrawals(c.Request.Context(), status, limit, offset)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "withdrawals": ws})
}

// AdminDecideWithdrawal POST /admin/crypto/withdrawals/:id/decision.
// Body: {decision:'approve'|'reject', note}. Note is mandatory (audited).
func (h *Handler) AdminDecideWithdrawal(c *gin.Context) {
	var req struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	req.Decision = strings.ToLower(strings.TrimSpace(req.Decision))
	req.Note = strings.TrimSpace(req.Note)
	if req.Note == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "note is required"})
		return
	}
	if req.Decision != "approve" && req.Decision != "reject" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "decision must be approve or reject"})
		return
	}
	w, err := h.svc.AdminDecideWithdrawal(c.Request.Context(), userID(c), c.Param("id"), req.Decision, req.Note)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "withdrawal": w})
}

// AdminListSwaps GET /admin/crypto/swaps?limit=&offset=.
func (h *Handler) AdminListSwaps(c *gin.Context) {
	limit, offset := pageParams(c)
	ss, err := h.svc.AdminListSwaps(c.Request.Context(), limit, offset)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swaps": ss})
}

// AdminListAddresses GET /admin/crypto/addresses?limit=&offset=.
func (h *Handler) AdminListAddresses(c *gin.Context) {
	review := strings.TrimSpace(c.Query("review_status"))
	limit, offset := pageParams(c)
	as, err := h.svc.AdminListAddresses(c.Request.Context(), review, limit, offset)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "addresses": as})
}

// AdminDecideAddress POST /admin/crypto/addresses/:id/decision.
// Body: {decision:'approve'|'reject', note}. Note is mandatory (audited).
func (h *Handler) AdminDecideAddress(c *gin.Context) {
	var req struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	req.Decision = strings.ToLower(strings.TrimSpace(req.Decision))
	req.Note = strings.TrimSpace(req.Note)
	if req.Note == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "note is required"})
		return
	}
	if req.Decision != "approve" && req.Decision != "reject" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "decision must be approve or reject"})
		return
	}
	a, err := h.svc.AdminDecideAddress(c.Request.Context(), userID(c), c.Param("id"), req.Decision, req.Note)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "address": a})
}

// AdminReconciliation GET /admin/crypto/reconciliation.
func (h *Handler) AdminReconciliation(c *gin.Context) {
	sum, err := h.svc.AdminReconciliation(c.Request.Context())
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rows": sum.Rows, "breaks": sum.Breaks, "as_of": sum.AsOf})
}
