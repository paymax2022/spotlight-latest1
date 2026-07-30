package orchestration

// handler_cards.go — HTTP handlers for the FX virtual-cards vertical
// (mobile src/features/fx/api/fxCards.api.ts). When a CardStore is attached
// (h.cards != nil) these are persistence-backed against orch_fx_cards /
// orch_fx_card_txns; when nil they fall back to the original contract-shaped
// stubs so a DB-less dev setup still renders without 404s.
//
// Card funding is a money movement: the store performs it atomically with an
// Idempotency-Key + balanced wallet-debit/card-credit per the iron rules. The
// FundCard handler forwards the `Idempotency-Key` header and maps an insufficient
// wallet balance to HTTP 402 Payment Required.

import (
	"errors"
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

// cardJSON builds a contract-shaped Card object. Placeholder values only (stub path).
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

// writeInsufficientCardFunds renders the normalized error envelope at HTTP 402.
func writeInsufficientCardFunds(c *gin.Context) {
	e := NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient balance to fund card.")
	e.RequestID = c.GetString("request_id")
	c.JSON(http.StatusPaymentRequired, gin.H{"error": e})
}

// writeCardNotFound renders a 404-style not-found envelope for a missing card.
func writeCardNotFound(c *gin.Context) {
	writeErr(c, NewError(ErrInvalidRequest, "not_found", "Card not found.").WithParam("id"))
}

// GET /cards — persisted list, or empty stub when no store is attached.
func (h *Handler) ListCards(c *gin.Context) {
	if h.cards == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	cards, err := h.cards.ListCards(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cards})
}

// GET /cards/:id — persisted card, or synthesized placeholder when no store.
func (h *Handler) GetCard(c *gin.Context) {
	if h.cards == nil {
		c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", 0, nil))
		return
	}
	card, ok, err := h.cards.GetCard(c.Request.Context(), customerID(c), c.Param("id"))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeCardNotFound(c)
		return
	}
	c.JSON(http.StatusOK, card)
}

// POST /cards — creates a card, then applies the initial funding load (money path)
// via the idempotent FundCard so the load carries the request Idempotency-Key.
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
	if h.cards == nil {
		c.JSON(http.StatusCreated, cardJSON(stubID("card"), d.Label, d.Brand, cur, d.Color, "active", d.FundingAmount, nil))
		return
	}
	ctx := c.Request.Context()
	card, err := h.cards.CreateCard(ctx, customerID(c), CardDraft{
		Label: d.Label, Brand: d.Brand, Currency: cur, Color: d.Color, FundingAmount: d.FundingAmount,
	})
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if d.FundingAmount > 0 {
		funded, ferr := h.cards.FundCard(ctx, customerID(c), card.ID, d.FundingAmount, c.GetHeader("Idempotency-Key"))
		if ferr != nil {
			if errors.Is(ferr, ErrInsufficientCardBalance) {
				writeInsufficientCardFunds(c)
				return
			}
			writeErr(c, asAPIError(ferr))
			return
		}
		card = funded
	}
	c.JSON(http.StatusCreated, card)
}

// POST /cards/:id/reveal — deterministic synthesized PAN/CVV (test data), or the
// masked placeholder when no store is attached.
func (h *Handler) RevealCard(c *gin.Context) {
	if h.cards == nil {
		now := time.Now()
		c.JSON(http.StatusOK, gin.H{
			"pan":    "•••• •••• •••• ••••",
			"cvv":    "•••",
			"expiry": fmt.Sprintf("%02d/%02d", int(now.Month()), (now.Year()+3)%100),
		})
		return
	}
	sens, ok, err := h.cards.RevealCard(c.Request.Context(), customerID(c), c.Param("id"))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeCardNotFound(c)
		return
	}
	c.JSON(http.StatusOK, sens)
}

// POST /cards/:id/fund — money path: reads the Idempotency-Key header, debits the
// wallet and credits the card atomically. 402 on insufficient wallet balance.
func (h *Handler) FundCard(c *gin.Context) {
	var body struct {
		Amount int64 `json:"amount"`
	}
	_ = c.ShouldBindJSON(&body)
	if h.cards == nil {
		c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", body.Amount, nil))
		return
	}
	// Money path: require an Idempotency-Key so a retried fund can never double-debit
	// the wallet (the store dedupes on it). Mirrors the iron-rule idempotency guard.
	idemKey := c.GetHeader("Idempotency-Key")
	if idemKey == "" {
		writeErr(c, NewError(ErrInvalidRequest, "missing_idempotency_key", "Idempotency-Key header is required to fund a card."))
		return
	}
	card, err := h.cards.FundCard(c.Request.Context(), customerID(c), c.Param("id"), body.Amount, idemKey)
	if err != nil {
		if errors.Is(err, ErrInsufficientCardBalance) {
			writeInsufficientCardFunds(c)
			return
		}
		if errors.Is(err, ErrCardNotFound) {
			writeCardNotFound(c)
			return
		}
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, card)
}

// POST /cards/:id/freeze and /unfreeze — persist the status toggle.
func (h *Handler) FreezeCard(c *gin.Context) {
	if h.cards == nil {
		c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "frozen", 0, nil))
		return
	}
	card, ok, err := h.cards.FreezeCard(c.Request.Context(), customerID(c), c.Param("id"))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeCardNotFound(c)
		return
	}
	c.JSON(http.StatusOK, card)
}

func (h *Handler) UnfreezeCard(c *gin.Context) {
	if h.cards == nil {
		c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", 0, nil))
		return
	}
	card, ok, err := h.cards.UnfreezeCard(c.Request.Context(), customerID(c), c.Param("id"))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeCardNotFound(c)
		return
	}
	c.JSON(http.StatusOK, card)
}

// POST /cards/:id/terminate — refunds residual balance to the wallet then marks
// the card terminated (money path when a refund is due).
func (h *Handler) TerminateCard(c *gin.Context) {
	if h.cards == nil {
		c.Status(http.StatusNoContent)
		return
	}
	err := h.cards.TerminateCard(c.Request.Context(), customerID(c), c.Param("id"))
	if err != nil {
		if errors.Is(err, ErrCardNotFound) {
			writeCardNotFound(c)
			return
		}
		writeErr(c, asAPIError(err))
		return
	}
	c.Status(http.StatusNoContent)
}

// PATCH /cards/:id/controls — persist the submitted spending controls.
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
	if h.cards == nil {
		controls := gin.H{
			"monthlyLimit": ctrl.MonthlyLimit, "perTxLimit": ctrl.PerTxLimit,
			"online": ctrl.Online, "atm": ctrl.Atm,
			"international": ctrl.International, "contactless": ctrl.Contactless,
		}
		c.JSON(http.StatusOK, cardJSON(c.Param("id"), "", "", "USD", "", "active", 0, controls))
		return
	}
	card, ok, err := h.cards.UpdateControls(c.Request.Context(), customerID(c), c.Param("id"), SpendingControls{
		MonthlyLimit: ctrl.MonthlyLimit, PerTxLimit: ctrl.PerTxLimit,
		Online: ctrl.Online, Atm: ctrl.Atm, International: ctrl.International, Contactless: ctrl.Contactless,
	})
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeCardNotFound(c)
		return
	}
	c.JSON(http.StatusOK, card)
}

// GET /cards/:id/transactions — persisted per-card transactions, or empty stub.
func (h *Handler) ListCardTransactions(c *gin.Context) {
	if h.cards == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	txns, err := h.cards.ListCardTransactions(c.Request.Context(), customerID(c), c.Param("id"))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": txns})
}
