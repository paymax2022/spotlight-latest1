package orchestration

// handler_stubs.go — placeholder endpoints for FX features the mobile app calls
// but that are not yet persistence-backed (rate history, add-wallet, collections
// list). Read-only stubs may echo contract-shaped display data, but anything
// that looks like a persisted object must not be fabricated: transfer-by-
// reference is a real ledger lookup (404 on a miss) and disputes refuse with
// 501 until a disputes store lands — a fake "processing" transfer or a
// "submitted" dispute that records nothing is worse than an honest error.
// WHY: the mobile FX module is governed by a single flag (EXPO_PUBLIC_FX_USE_MOCK).
// Flipping it to false to test the REAL exchange path (rates→quote→lock→convert)
// also routes these secondary calls at the backend; without these handlers they
// would 404 and break the screens. These stubs return contract-shaped responses
// (see mobile src/features/fx/types/fx.types.ts) so the app renders, WITHOUT
// pretending to persist anything.
// NOT money-path: none of these post ledger entries or move value.
// disputes/alerts/beneficiaries are metadata. When these graduate to real
// features they must gain persistence and, for any value movement, idempotency +
// double-entry per the iron rules — at which point delete the corresponding stub
// here. AddWallet has already graduated: it persists (Store.OpenWallet) instead
// of echoing a wallet the server immediately forgot.

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/timeutil"
)

// stubID builds a prefixed pseudo-unique id, e.g. "ben_1719800000000000000".
func stubID(prefix string) string { return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano()) }

// Provisioning only — opens a zero-balance wallet for a currency. No value moves,
// so no ledger entry and no Idempotency-Key: re-opening is a no-op, not a reset.
// It writes the row so the wallet persists across GET /balances.

// walletCurrencies is the set a customer may open, mirroring WALLET_CURRENCIES in
// mobile src/features/fx/constants/fx.constants.ts. Closed by design: without it
// any string would create a junk orch_balances row that the app cannot render.
var walletCurrencies = map[string]bool{
	"NGN": true, "USD": true, "EUR": true, "GBP": true, "GHS": true, "KES": true,
}

func (h *Handler) AddWallet(c *gin.Context) {
	var req struct {
		Currency string `json:"currency"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Currency) == "" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "currency is required").WithParam("currency"))
		return
	}
	cur := strings.ToUpper(strings.TrimSpace(req.Currency))
	if !walletCurrencies[cur] {
		writeErr(c, NewError(ErrInvalidRequest, "unsupported_currency", cur+" wallets are not available.").WithParam("currency"))
		return
	}

	customer := ginutil.UserID(c)
	if err := h.svc.OpenWallet(c.Request.Context(), customer, cur); err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	// Echo the balance as STORED, not a hardcoded zero: re-opening a funded wallet
	// must return what is in it, or the client would render a zero over real money.
	bal, err := h.svc.Balance(c.Request.Context(), customer, cur)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	// The WalletBalance shape { currency, available, ledger }. available == ledger
	// until holds are modelled (same contract as GetBalances).
	c.JSON(http.StatusCreated, gin.H{"currency": cur, "available": bal, "ledger": bal})
}

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
	for i := range points {
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

// GetTransferByReference handles GET /transfers/:reference — the mobile polls
// this after POST /transfers. This is a REAL lookup: the reference is resolved
// against the orchestration transaction ledger (the same store CreateTransfer
// persists to). We return the actual status, amounts, rates, route and status
// history. An unresolvable reference answers 404 — a phantom "processing"
// transfer is worse than an honest miss because a poller can never distinguish
// a fat-fingered reference from an in-flight payout.
func (h *Handler) GetTransferByReference(c *gin.Context) {
	ref := c.Param("reference")

	// Resolve the persisted transaction for THIS customer by reference. Transaction
	// matches on either id or reference and is object-scoped to the caller (no
	// cross-customer leakage). A transfer is Type == "transfer".
	tx, ok, err := h.svc.Transaction(c.Request.Context(), ginutil.UserID(c), ref)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if ok && tx.Type == "transfer" {
		history := make([]gin.H, 0)
		if len(tx.Fees) == 0 {
			tx.Fees = []Fee{}
		}
		history = append(history, gin.H{"status": tx.Status, "at": tx.CreatedAt.UTC().Format(time.RFC3339)})
		c.JSON(http.StatusOK, gin.H{
			"id":           tx.ID,
			"reference":    tx.Reference,
			"status":       tx.Status,
			"source":       gin.H{"amount": tx.Source.AmountMinor, "currency": tx.Source.Currency},
			"destination":  gin.H{"amount": tx.Destination.AmountMinor, "currency": tx.Destination.Currency},
			"quotedRate":   tx.QuotedRate,
			"executedRate": tx.ExecutedRate,
			"fees":         tx.Fees,
			"route":        tx.Route,
			"beneficiary": gin.H{
				"id": "", "name": "Beneficiary", "rail": string(tx.Route.Rail), "scheme": "BANK",
				"currency": tx.Destination.Currency, "accountNumber": "", "bankName": nil, "countryCode": "NG",
			},
			"narration":     nil,
			"transactionId": tx.ProviderRef,
			"createdAt":     tx.CreatedAt.UTC().Format(time.RFC3339),
			"statusHistory": history,
		})
		return
	}

	// Not found: the reference is not a persisted transfer for this customer.
	writeErr(c, NewError(ErrNotFound, "not_found", "Transfer not found.").WithParam("reference"))
}

// NOTE: beneficiary handlers (List/Create/Validate/Update/Favorite/Delete) are
// persistence-backed in handler_secondary.go, not stubbed here.

// Reads only; creation of virtual accounts is the real CreateCollection handler.

// GET /collections — inbound collection events for the caller. Store-backed when
// a CollectionStore is attached (currently an empty non-nil slice until a provider
// collection feed lands), else the empty-slice stub.
func (h *Handler) ListCollections(c *gin.Context) {
	if h.coll == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	events, err := h.coll.ListCollectionEvents(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": events})
}

// GET /collections/virtual-accounts — the caller's virtual accounts, read from the
// existing orch_collections persistence (CreateCollection writes it), else stub.
func (h *Handler) ListVirtualAccounts(c *gin.Context) {
	if h.coll == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	vas, err := h.coll.ListVirtualAccounts(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vas})
}

// disputeReasons mirrors DisputeReason in mobile src/features/fx/types/fx.types.ts.
var disputeReasons = map[string]bool{
	"not_received": true, "wrong_amount": true, "duplicate": true,
	"unauthorized": true, "wrong_rate": true, "other": true,
}

// DisputeTransaction handles POST /transactions/:id/dispute. Disputes have no
// persistence yet (no orch_fx_disputes table, no provider dispute rail), so
// this endpoint refuses honestly instead of echoing a "submitted" dispute that
// records nothing: a valid request on a real transaction gets 501
// not_implemented; anything else gets the usual typed 400/404.
// FxDisputeRequest requires transactionId + reason (contract).
func (h *Handler) DisputeTransaction(c *gin.Context) {
	var req struct {
		TransactionID string `json:"transactionId"`
		Reference     string `json:"reference"`
		Reason        string `json:"reason"`
		Note          string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	txID := strings.TrimSpace(req.TransactionID)
	if txID == "" {
		txID = strings.TrimSpace(c.Param("id"))
	}
	if txID == "" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "transactionId is required").WithParam("transactionId"))
		return
	}
	if !disputeReasons[strings.ToLower(strings.TrimSpace(req.Reason))] {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "unsupported reason").WithParam("reason"))
		return
	}
	if h.svc != nil {
		_, ok, err := h.svc.Transaction(c.Request.Context(), ginutil.UserID(c), txID)
		if err != nil {
			writeErr(c, asAPIError(err))
			return
		}
		if !ok {
			writeErr(c, NewError(ErrNotFound, "not_found", "Transaction not found.").WithParam("transactionId"))
			return
		}
	}
	writeErr(c, NewError(ErrNotImplemented, "not_implemented", "Transaction disputes are not yet supported — nothing was recorded."))
}

// Contract-shaped placeholders so the mobile FX KYC screens render against the
// real backend. NOT persistence-backed yet: GetVerification always reports the
// caller as "unstarted"; Submit/Restart echo the resulting status without storing
// it. When the KYC subsystem lands (provider integration, document handling, tier
// progression, admin review) these graduate to real handlers — delete these stubs.

// defaultVerification returns the schema-complete "no record yet" Verification.
func defaultVerification() gin.H {
	return gin.H{"status": "unstarted", "accountType": "individual", "tier": 0}
}

// GetVerification (GET /customers/verification) — current KYC status for the caller.
// Persistence-backed when a store is attached; the stub default otherwise.
func (h *Handler) GetVerification(c *gin.Context) {
	if h.verif == nil {
		c.JSON(http.StatusOK, gin.H{"data": defaultVerification()})
		return
	}
	rec, err := h.verif.Get(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// kycDocTypes mirrors IdDocType in mobile src/features/fx/types/fx.types.ts.
var kycDocTypes = map[string]bool{
	"nin": true, "passport": true, "drivers_license": true, "voters_card": true,
}

// SubmitCustomer (POST /customers) — records a KYC submission and routes the status
// (individuals → pending, businesses → manual review). Persists the full payload
// when a store is attached; echoes the routed status otherwise.
//
// The body is validated BEFORE any state change: this is a persistent write, so
// an empty or malformed payload must not mint a "pending" verification record.
// Required fields mirror KycSubmission in the mobile client (accountType,
// consents, identity{docType,idNumber,dateOfBirth}).
func (h *Handler) SubmitCustomer(c *gin.Context) {
	raw, err := c.GetRawData()
	if err != nil {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "invalid request body"))
		return
	}
	var req struct {
		AccountType string `json:"accountType"`
		Consents    *struct {
			Terms        bool `json:"terms"`
			Privacy      bool `json:"privacy"`
			FxDisclosure bool `json:"fxDisclosure"`
		} `json:"consents"`
		Identity *struct {
			DocType     string `json:"docType"`
			IDNumber    string `json:"idNumber"`
			DateOfBirth string `json:"dateOfBirth"`
		} `json:"identity"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "invalid JSON body"))
		return
	}
	bad := func(param, msg string) *APIError {
		return NewError(ErrInvalidRequest, "invalid_request", msg).WithParam(param)
	}
	acct := strings.ToLower(strings.TrimSpace(req.AccountType))
	if acct != "individual" && acct != "business" {
		writeErr(c, bad("accountType", "accountType must be individual or business"))
		return
	}
	if req.Consents == nil {
		writeErr(c, bad("consents", "consents is required"))
		return
	}
	if req.Identity == nil {
		writeErr(c, bad("identity", "identity is required"))
		return
	}
	if !kycDocTypes[strings.ToLower(strings.TrimSpace(req.Identity.DocType))] {
		writeErr(c, bad("identity.docType", "unsupported docType"))
		return
	}
	if strings.TrimSpace(req.Identity.IDNumber) == "" {
		writeErr(c, bad("identity.idNumber", "identity.idNumber is required"))
		return
	}
	if strings.TrimSpace(req.Identity.DateOfBirth) == "" {
		writeErr(c, bad("identity.dateOfBirth", "identity.dateOfBirth is required"))
		return
	}
	if h.verif == nil {
		status := "pending"
		if acct == "business" {
			status = "review"
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"status": status, "accountType": acct, "tier": 1, "submittedAt": timeutil.RFC3339(time.Now()),
		}})
		return
	}
	rec, err := h.verif.Submit(c.Request.Context(), ginutil.UserID(c), acct, raw)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// RestartVerification (POST /customers/verification/restart) — reset to unstarted so
// the user can resubmit after a rejection.
func (h *Handler) RestartVerification(c *gin.Context) {
	if h.verif == nil {
		c.JSON(http.StatusOK, gin.H{"data": defaultVerification()})
		return
	}
	rec, err := h.verif.Restart(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// NOTE: rate-alert handlers (List/Create/Delete) are persistence-backed in
// handler_secondary.go, not stubbed here.
