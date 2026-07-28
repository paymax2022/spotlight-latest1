package orchestration

// handler_cards.go — STUB handlers for the FX virtual-cards vertical
// (mobile src/features/fx/api/fxCards.api.ts). Contract-shaped, NOT persisted:
// no card issuing provider is wired yet, so these let the cards screens render
// without 404s when EXPO_PUBLIC_FX_USE_MOCK=false.
//
// When real card issuing lands (Maplerad/other), replace these with a provider-
// backed service + store. Card funding is a money movement, so the real fund
// handler MUST require an Idempotency-Key and post double-entry ledger rows per
// the iron rules — these stubs deliberately do neither.

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// defaultControls mirrors the mobile SpendingControls default shape.
func defaultControls() gin.H {
	return gin.H{
		"monthlyLimit": nil, "perTxLimit": nil,
		"online": true, "atm": false, "international": true, "contactless": true,
	}
}

// cardJSON builds a contract-shaped Card object. Placeholder values only.
func cardJSON(id, label, brand, currency, color, status string, balanceMinor int64, controls gin.H) gin.H {
	now := time.Now()
	if controls == nil {
		controls = defaultControls()
	}
	if label == "" {
		label = "Virtual card"
	}
	if brand == "" {
		brand = "visa"
	}
	if color == "" {
		color = "purple"
	}
	return gin.H{
		"id": id, "label": label, "brand": brand, "currency": strings.ToUpper(currency),
		"last4":          fmt.Sprintf("%04d", now.UnixNano()%10000),
		"expMonth":       int(now.Month()),
		"expYear":        (now.Year() + 3) % 100,
		"cardholderName": "SPOTLIGHT USER",
		"balance":        balanceMinor,
		"status":         status,
		"color":          color,
		"spentThisMonth": 0,
		"controls":       controls,
		"provider":       "maplerad",
		"createdAt":      nowISO(),
	}
}

// GET /cards — empty until a card provider is wired.
func (h *Handler) ListCards(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

// GET /cards/:id — synthesized placeholder for the id (not persisted).
func (h *Handler) GetCard(c *gin.Context) {
	c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", 0, nil))
}

// POST /cards — echoes a new card built from the draft.
func (h *Handler) CreateCard(c *gin.Context) {
	var d struct {
		Label         string `json:"label"`
		Brand         string `json:"brand"`
		Currency      string `json:"currency"`
		Color         string `json:"color"`
		FundingAmount int64  `json:"fundingAmount"`
	}
	if err := c.ShouldBindJSON(&d); err != nil {
		bindErr(c, err)
		return
	}
	cur := d.Currency
	if cur == "" {
		cur = "USD"
	}
	c.JSON(http.StatusCreated, cardJSON(stubID("card"), d.Label, d.Brand, cur, d.Color, "active", d.FundingAmount, nil))
}

// POST /cards/:id/reveal — placeholder PAN/CVV/expiry (masked; not real).
func (h *Handler) RevealCard(c *gin.Context) {
	now := time.Now()
	c.JSON(http.StatusOK, gin.H{
		"pan":    "•••• •••• •••• ••••",
		"cvv":    "•••",
		"expiry": fmt.Sprintf("%02d/%02d", int(now.Month()), (now.Year()+3)%100),
	})
}

// POST /cards/:id/fund — echoes the card with the funded amount as balance.
// NOTE: real funding is money-path (needs idempotency + ledger); stub does not.
func (h *Handler) FundCard(c *gin.Context) {
	var body struct {
		Amount int64 `json:"amount"`
	}
	_ = c.ShouldBindJSON(&body)
	c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", body.Amount, nil))
}

// POST /cards/:id/freeze and /unfreeze — echo the toggled status.
func (h *Handler) FreezeCard(c *gin.Context) {
	c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "frozen", 0, nil))
}
func (h *Handler) UnfreezeCard(c *gin.Context) {
	c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", 0, nil))
}

// POST /cards/:id/terminate — nothing to persist.
func (h *Handler) TerminateCard(c *gin.Context) { c.Status(http.StatusNoContent) }

// PATCH /cards/:id/controls — echoes the card with the submitted controls.
func (h *Handler) UpdateCardControls(c *gin.Context) {
	var ctrl struct {
		MonthlyLimit  *int64 `json:"monthlyLimit"`
		PerTxLimit    *int64 `json:"perTxLimit"`
		Online        bool   `json:"online"`
		Atm           bool   `json:"atm"`
		International bool   `json:"international"`
		Contactless   bool   `json:"contactless"`
	}
	_ = c.ShouldBindJSON(&ctrl)
	controls := gin.H{
		"monthlyLimit": ctrl.MonthlyLimit, "perTxLimit": ctrl.PerTxLimit,
		"online": ctrl.Online, "atm": ctrl.Atm,
		"international": ctrl.International, "contactless": ctrl.Contactless,
	}
	c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", 0, controls))
}

// GET /cards/:id/transactions — empty until card issuing is wired.
func (h *Handler) ListCardTransactions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}
