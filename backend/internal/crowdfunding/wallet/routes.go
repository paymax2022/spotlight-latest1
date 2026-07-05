package wallet

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Register wires the crowdfunding wallet routes onto the supplied router group.
// The caller (finance route wiring) is responsible for mounting `rg` under the
// crowdfunding prefix and applying auth middleware that sets `user_id`.
//
// Routes (relative to rg):
//
//	GET  /campaigns/:id/wallet              → wallet summary (derived)
//	GET  /campaigns/:id/ledger              → projected ledger feed
//	GET  /ledger/:id                        → single projected ledger entry
//	GET  /bank-accounts                     → caller's saved bank accounts
//	POST /campaigns/:id/withdrawal-request  → file a PENDING withdrawal request
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	rg.GET("/campaigns/:id/wallet", h.GetWallet)
	rg.GET("/campaigns/:id/ledger", h.GetLedger)
	rg.GET("/ledger/:id", h.GetLedgerEntry)
	rg.GET("/bank-accounts", h.GetBankAccounts)
	rg.POST("/campaigns/:id/withdrawal-request", h.SubmitWithdrawal)
}
