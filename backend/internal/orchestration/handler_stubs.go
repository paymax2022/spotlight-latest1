package orchestration

// handler_stubs.go — placeholder endpoints for FX features the mobile app calls
// but that are not yet persistence-backed (beneficiaries, rate alerts, rate
// history, add-wallet, transfer-by-reference, collections list, disputes).
//
// WHY: the mobile FX module is governed by a single flag (EXPO_PUBLIC_FX_USE_MOCK).
// Flipping it to false to test the REAL exchange path (rates→quote→lock→convert)
// also routes these secondary calls at the backend; without these handlers they
// would 404 and break the screens. These stubs return contract-shaped responses
// (see mobile src/features/fx/types/fx.types.ts) so the app renders, WITHOUT
// pretending to persist anything.
//
// NOT money-path: none of these post ledger entries or move value. Add-wallet
// only provisions a zero-balance wallet view; disputes/alerts/beneficiaries are
// metadata. When these graduate to real features they must gain persistence and,
// for any value movement, idempotency + double-entry per the iron rules — at
// which point delete the corresponding stub here.

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// nowISO returns an RFC3339/UTC timestamp (matches the mobile ISO string fields).
func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

// stubID builds a prefixed pseudo-unique id, e.g. "ben_1719800000000000000".
func stubID(prefix string) string { return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano()) }

// ─── Balances: add wallet (POST /balances) ───────────────────────────────────
// Provisioning only — opens a zero-balance wallet view for a currency. No ledger.

func (h *Handler) AddWallet(c *gin.Context) {
	var req struct {
		Currency string `json:"currency"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Currency) == "" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "currency is required").WithParam("currency"))
		return
	}
	// Returns the WalletBalance shape { currency, available, ledger } directly.
	c.JSON(http.StatusCreated, gin.H{
		"currency":  strings.ToUpper(req.Currency),
		"available": 0,
		"ledger":    0,
	})
}

// ─── Rates: history (GET /rates/history?from&to&range) ───────────────────────
// Deterministic indicative series for the rate-history chart. Display-only.

func (h *Handler) GetRateHistory(c *gin.Context) {
	from := strings.ToUpper(c.Query("from"))
	to := strings.ToUpper(c.Query("to"))
	rng := strings.ToUpper(c.Query("range"))

	// points + step per range (mirrors the mobile mock cadence).
	points, stepMs := 30, int64(86_400_000)
	switch rng {
	case "1D":
		points, stepMs = 24, 3_600_000
	case "1W":
		points, stepMs = 28, 6*3_600_000
	case "1M":
		points, stepMs = 30, 86_400_000
	case "3M":
		points, stepMs = 36, 3*86_400_000
	case "1Y":
		points, stepMs = 52, 7*86_400_000
	}

	base := indicativeBase(from, to)
	seed := 0
	for _, ch := range from + to + rng {
		seed += int(ch)
	}
	now := time.Now().UnixMilli()
	series := make([]gin.H, 0, points)
	for i := 0; i < points; i++ {
		wobble := math.Sin(float64(seed+i)/3)*0.02 + math.Cos(float64(seed+i)/7)*0.012
		rate := math.Round(base*(1+wobble)*10000) / 10000
		t := time.UnixMilli(now - int64(points-i)*stepMs).UTC().Format(time.RFC3339)
		series = append(series, gin.H{"t": t, "rate": rate})
	}
	c.JSON(http.StatusOK, gin.H{"data": series})
}

// indicativeBase returns a plausible display rate for a pair. Known majors are
// hard-coded; anything else derives a stable value from the pair string so the
// chart is deterministic. NOT executable — quotes come from the live providers.
func indicativeBase(from, to string) float64 {
	known := map[string]float64{
		"USD-NGN": 1650, "NGN-USD": 1.0 / 1650,
		"EUR-NGN": 1780, "GBP-NGN": 2080,
		"USD-GHS": 15.6, "USD-KES": 129, "USD-XAF": 605, "USD-ZAR": 18.3,
		"USD-EUR": 0.92, "USD-GBP": 0.79, "USD-USDC": 1, "USD-USDT": 1,
	}
	if v, ok := known[from+"-"+to]; ok {
		return v
	}
	h := 0
	for _, ch := range from + to {
		h = h*31 + int(ch)
	}
	if h < 0 {
		h = -h
	}
	return 100 + float64(h%900) // 100..999, stable per pair
}

// ─── Transfers: get by reference (GET /transfers/:reference) ─────────────────
// The mobile polls this after POST /transfers. Not tracked in this stub, so we
// echo the reference in a schema-complete, clearly-placeholder Transfer.

func (h *Handler) GetTransferByReference(c *gin.Context) {
	ref := c.Param("reference")
	zero := gin.H{"amount": 0, "currency": "NGN"}
	c.JSON(http.StatusOK, gin.H{
		"id":           stubID("tr"),
		"reference":    ref,
		"status":       "processing", // honest: terminal status not tracked here
		"source":       zero,
		"destination":  zero,
		"quotedRate":   nil,
		"executedRate": nil,
		"fees":         []any{},
		"route":        gin.H{"provider": "maplerad", "corridor": "", "rail": "bank_transfer"},
		"beneficiary": gin.H{
			"id": "", "name": "Beneficiary", "rail": "bank_transfer", "scheme": "BANK",
			"currency": "NGN", "accountNumber": "", "bankName": nil, "countryCode": "NG",
		},
		"narration":     nil,
		"transactionId": "",
		"createdAt":     nowISO(),
		"statusHistory": []gin.H{{"status": "processing", "at": nowISO()}},
	})
}

// NOTE: beneficiary handlers (List/Create/Validate/Update/Favorite/Delete) are
// persistence-backed in handler_secondary.go, not stubbed here.

// ─── Collections list (GET /collections and GET /collections/virtual-accounts)
// Reads only; creation of virtual accounts is the real CreateCollection handler.

func (h *Handler) ListCollections(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

func (h *Handler) ListVirtualAccounts(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

// ─── Disputes (POST /transactions/:id/dispute) ───────────────────────────────
// Records nothing yet; echoes a "submitted" dispute so the support flow renders.

func (h *Handler) DisputeTransaction(c *gin.Context) {
	var req struct {
		TransactionID string `json:"transactionId"`
		Reference     string `json:"reference"`
		Reason        string `json:"reason"`
		Note          string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	txID := req.TransactionID
	if txID == "" {
		txID = c.Param("id")
	}
	c.JSON(http.StatusCreated, gin.H{
		"id": stubID("dsp"), "transactionId": txID, "reference": req.Reference,
		"reason": req.Reason, "note": req.Note, "status": "submitted", "createdAt": nowISO(),
	})
}

// NOTE: rate-alert handlers (List/Create/Delete) are persistence-backed in
// handler_secondary.go, not stubbed here.
