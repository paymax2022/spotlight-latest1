package app

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
)

// academy_wallet_routes.go — MEMBER academy wallet read.
//
// GET /api/finance/academy/wallet returns the authenticated user's REAL Paymax wallet
// balance. It is a thin PROXY over the EXISTING finance ledger read (ledger.Service.
// GetBalance → the wallet projection of the double-entry ledger) — golden rule: reuse
// the Paymax rails, never spin up a parallel wallet/ledger. Read-only: it posts NO
// ledger entry and moves NO money. Balance is an integer in minor units (kobo); the
// currency is the platform base currency (NGN).
//
// Mounted on the member academy group (memberAcad = /api/finance/academy), which already
// carries RequireAuthContext + requireUserID (see finance_routes.go), so user_id is in
// context. nil ledger ⇒ the route is skipped (no shadow read).
func registerAcademyMemberWallet(member *gin.RouterGroup, ledgerSvc *ledger.Service) {
	if member == nil || ledgerSvc == nil {
		return
	}
	member.GET("/wallet", func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			if u, ok := middleware.GetAuthenticatedUser(c); ok {
				userID = u.ID
			}
		}
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}
		// Reuse the EXISTING ledger read — the same wallet projection the finance layer
		// (finance/wallet.Service.GetBalance) uses. No parallel balance store.
		balanceKobo, err := ledgerSvc.GetBalance(c.Request.Context(), userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"balanceKobo": balanceKobo, "currency": "NGN"})
	})
}
