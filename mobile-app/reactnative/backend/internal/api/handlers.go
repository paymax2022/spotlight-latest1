package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/recon"
	"paymax/crypto-backend/internal/store"
	"paymax/crypto-backend/internal/webhook"
)

// ── Eligibility ───────────────────────────────────────────────────────────────

// getEligibility computes the trading gate from the user's compliance facts
// (KYC tier + suitability + agreements + crypto product flag). The decision is
// server-authoritative (Rule 2) and fail-closed (engine.EvaluateEligibility).
func (s *Server) getEligibility(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, engine.EvaluateEligibility(s.S.Eligibility()))
}

// requireEligible is the pre-trade compliance gate run before every money
// movement (buy/sell/swap/withdraw). It blocks fail-closed with a structured
// reason when the user has not cleared KYC + suitability + agreements + product.
// Returns true when the caller may proceed.
func (s *Server) requireEligible(w http.ResponseWriter) bool {
	elig := engine.EvaluateEligibility(s.S.Eligibility())
	if elig.State == "eligible" {
		return true
	}
	// 403: the request is well-formed and authenticated but the user is not
	// permitted to trade until the named requirement is satisfied.
	writeJSON(w, http.StatusForbidden, map[string]any{
		"type":     "ineligible",
		"code":     "ineligible",
		"reason":   elig.Reason,
		"message":  elig.Message,
		"ctaRoute": elig.CtaRoute,
		"state":    elig.State,
	})
	return false
}

// ── Assets / market data ──────────────────────────────────────────────────────

func (s *Server) getAssets(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.MD.Assets())
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	a, ok := s.MD.Asset(r.PathValue("symbol"))
	if !ok {
		writeErr(w, http.StatusNotFound, "asset_unavailable", "Asset not found.")
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) getChart(w http.ResponseWriter, r *http.Request) {
	rng := r.URL.Query().Get("range")
	if rng == "" {
		rng = "1D"
	}
	pts, ok := s.MD.Chart(r.PathValue("symbol"), rng)
	if !ok {
		writeErr(w, http.StatusNotFound, "asset_unavailable", "Asset not found.")
		return
	}
	writeJSON(w, http.StatusOK, pts)
}

// ── Quote (buy/sell or swap, discriminated by `side`) ─────────────────────────

type quoteReq struct {
	Side     string `json:"side"`
	AssetID  string `json:"assetId"`
	Basis    string `json:"basis"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Lock     bool   `json:"lock"`
	// swap fields
	FromAssetID string `json:"fromAssetId"`
	ToAssetID   string `json:"toAssetId"`
	FromAmount  int64  `json:"fromAmount"`
}

func (s *Server) postQuote(w http.ResponseWriter, r *http.Request) {
	var req quoteReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	if req.Side == "swap" {
		q, ok := s.LQ.SwapQuote(req.FromAssetID, req.ToAssetID, req.FromAmount)
		if !ok {
			writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
			return
		}
		s.S.PutSwapQuote(q)
		writeJSON(w, http.StatusOK, q)
		return
	}
	cur := req.Currency
	if cur == "" {
		cur = "NGN"
	}
	q, ok := s.LQ.Quote(req.AssetID, req.Side, req.Basis, req.Amount, cur, req.Lock)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}
	s.S.PutQuote(q)
	writeJSON(w, http.StatusOK, q)
}

// ── Buy / sell — execute strictly against a persisted server quote ────────────

// tradeReq is the execute payload. The client sends back the quoteId it was
// shown; the server fetches that exact persisted quote and executes it. We never
// re-price at execute time, so the executed numbers are byte-for-byte the quote
// the user confirmed (Rule 2 + quote integrity). `id` is accepted as an alias so
// the older client (which posts the full domain.Quote) keeps working.
type tradeReq struct {
	QuoteID string `json:"quoteId"`
	ID      string `json:"id"`
}

func (r tradeReq) quoteID() string {
	if r.QuoteID != "" {
		return r.QuoteID
	}
	return r.ID
}

func (s *Server) postBuy(w http.ResponseWriter, r *http.Request)  { s.trade(w, r, "buy") }
func (s *Server) postSell(w http.ResponseWriter, r *http.Request) { s.trade(w, r, "sell") }

func (s *Server) trade(w http.ResponseWriter, r *http.Request, side string) {
	// Compliance gate first: block ineligible users before any state is touched.
	if !s.requireEligible(w) {
		return
	}

	key := r.Header.Get("Idempotency-Key")
	if cached, ok := s.S.Idempotent(key); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	var req tradeReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	qid := req.quoteID()
	if qid == "" {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Missing quoteId.")
		return
	}

	// Quote integrity: consume the persisted quote by id. GetQuote returns false
	// for missing / consumed / expired quotes, so each is rejected fail-closed.
	q, ok := s.S.GetQuote(qid)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "quote_expired", "Quote is invalid, already used, or expired. Please re-quote.")
		return
	}
	if q.Side != side {
		writeErr(w, http.StatusUnprocessableEntity, "invalid_request", "Quote side does not match this endpoint.")
		return
	}

	var order domain.Order
	var ee *store.ExecError
	if side == "buy" {
		order, ee = s.S.ExecuteBuy(q)
	} else {
		order, ee = s.S.ExecuteSell(q)
	}
	if ee != nil {
		writeErr(w, http.StatusUnprocessableEntity, ee.Type, ee.Message)
		return
	}
	order.IdempotencyKey = key
	s.S.SaveIdempotent(key, order)
	writeJSON(w, http.StatusOK, order)
}

// ── Swap ──────────────────────────────────────────────────────────────────────

func (s *Server) postSwap(w http.ResponseWriter, r *http.Request) {
	if !s.requireEligible(w) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if cached, ok := s.S.Idempotent(key); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	var req tradeReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	qid := req.quoteID()
	if qid == "" {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Missing quoteId.")
		return
	}
	// Quote integrity: execute the persisted swap quote, never a re-priced one.
	q, ok := s.S.GetSwapQuote(qid)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "quote_expired", "Quote is invalid, already used, or expired. Please re-quote.")
		return
	}
	res, e := s.S.ExecuteSwap(q)
	if e != nil {
		writeErr(w, http.StatusUnprocessableEntity, e.Type, e.Message)
		return
	}
	res.IdempotencyKey = key
	s.S.SaveIdempotent(key, res)
	writeJSON(w, http.StatusOK, res)
}

// ── Deposit ───────────────────────────────────────────────────────────────────

func (s *Server) getDepositAddress(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	network := r.URL.Query().Get("network")
	addr, ok := s.CU.DepositAddress(symbol, network)
	if !ok {
		writeErr(w, http.StatusNotFound, "asset_unavailable", "Asset not found.")
		return
	}
	writeJSON(w, http.StatusOK, addr)
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

// getPortfolio serves crypto by default; `?assetType=stock` returns the stock
// portfolio (the mobile crypto + stock modules share this path).
func (s *Server) getPortfolio(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("assetType") == "stock" {
		writeJSON(w, http.StatusOK, s.Stocks.Portfolio())
		return
	}
	writeJSON(w, http.StatusOK, s.S.Portfolio())
}

func (s *Server) getPositions(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("assetType") == "stock" {
		writeJSON(w, http.StatusOK, s.Stocks.Positions())
		return
	}
	writeJSON(w, http.StatusOK, s.S.Positions())
}

// ── Transactions ──────────────────────────────────────────────────────────────

func (s *Server) getTransactions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.S.Transactions(r.URL.Query().Get("side")))
}

func (s *Server) getTransaction(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.S.Transaction(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "invalid_request", "Transaction not found.")
		return
	}
	writeJSON(w, http.StatusOK, tx)
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

func (s *Server) getWatchlist(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.S.Watchlist())
}

func (s *Server) postWatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	s.S.AddWatch(body.AssetID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) deleteWatch(w http.ResponseWriter, r *http.Request) {
	s.S.RemoveWatch(r.PathValue("assetId"))
	writeJSON(w, http.StatusNoContent, nil)
}

// ── Alerts ────────────────────────────────────────────────────────────────────

func (s *Server) getAlerts(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.S.Alerts())
}

func (s *Server) postAlert(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID     string `json:"assetId"`
		Condition   string `json:"condition"`
		TargetPrice int64  `json:"targetPrice"`
		Currency    string `json:"currency"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	cur := body.Currency
	if cur == "" {
		cur = "NGN"
	}
	al, ok := s.S.CreateAlert(body.AssetID, body.Condition, body.TargetPrice, cur)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}
	writeJSON(w, http.StatusOK, al)
}

func (s *Server) deleteAlert(w http.ResponseWriter, r *http.Request) {
	s.S.DeleteAlert(r.PathValue("id"))
	writeJSON(w, http.StatusNoContent, nil)
}

// ── Address book ──────────────────────────────────────────────────────────────

func (s *Server) getAddresses(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.S.Addresses(r.URL.Query().Get("symbol")))
}

func (s *Server) postScreen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Address string `json:"address"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	writeJSON(w, http.StatusOK, s.CU.ScreenAddress(body.Address))
}

func (s *Server) postAddress(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label     string `json:"label"`
		Symbol    string `json:"symbol"`
		NetworkID string `json:"networkId"`
		Address   string `json:"address"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	addr, ok := s.S.AddAddress(body.Label, body.Symbol, body.NetworkID, body.Address)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}
	writeJSON(w, http.StatusOK, addr)
}

func (s *Server) deleteAddress(w http.ResponseWriter, r *http.Request) {
	s.S.DeleteAddress(r.PathValue("id"))
	writeJSON(w, http.StatusNoContent, nil)
}

// ── Withdrawal ────────────────────────────────────────────────────────────────

func (s *Server) getWithdrawalEligibility(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, domain.WithdrawalEligibility{
		Gate:                  "eligible",
		KycTier:               2,
		ManualReviewOnly:      true,
		DailyLimit:            domain.Money{Amount: 5_000_000_00, Currency: "NGN"},
		DailyUsed:             domain.Money{Amount: 0, Currency: "NGN"},
		ManualReviewThreshold: domain.Money{Amount: 500_000_00, Currency: "NGN"},
		Message:               "Withdrawals are reviewed by compliance before broadcast.",
	})
}

type withdrawalDraft struct {
	AssetID   string `json:"assetId"`
	Symbol    string `json:"symbol"`
	NetworkID string `json:"networkId"`
	AddressID string `json:"addressId"`
	Amount    int64  `json:"amount"`
}

func (s *Server) postWithdrawalQuote(w http.ResponseWriter, r *http.Request) {
	var d withdrawalDraft
	if err := readJSON(r, &d); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	q, ok := s.CU.WithdrawalQuote(d.AssetID, d.NetworkID, d.Amount)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}
	writeJSON(w, http.StatusOK, q)
}

// ── Admin: reconciliation ─────────────────────────────────────────────────────

// getReconciliation reports ledger/holdings reconciliation + exceptions.
// s.S (store.Repository) satisfies recon.Source structurally.
func (s *Server) getReconciliation(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, recon.Reconcile(s.S))
}

// ── Provider webhooks (Rule 7: verify signature + prevent replay) ─────────────

// txEventStatus maps provider event types to a transaction status (status-only
// transitions). Balance-affecting events (deposit.confirmed) are handled apart.
var txEventStatus = map[string]string{
	"order.filled":            "Filled",
	"order.partially_filled":  "PartiallyFilled",
	"order.failed":            "Failed",
	"withdrawal.approved":     "WithdrawalApproved",
	"withdrawal.broadcasting": "WithdrawalBroadcasting",
	"withdrawal.confirmed":    "WithdrawalConfirmed",
	// withdrawal.failed is handled by ReverseWithdrawal (re-credits the holding).
}

func (s *Server) postWebhook(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Unreadable body.")
		return
	}

	// Verify the HMAC signature + timestamp window when a secret is configured.
	// (Unset secret = dev mode: accept unsigned, so local testing works.)
	if secret := os.Getenv("CRYPTO_WEBHOOK_SECRET"); secret != "" {
		if !webhook.Verify(secret, body, r.Header.Get("X-Paymax-Signature")) {
			writeErr(w, http.StatusUnauthorized, "authentication", "Invalid webhook signature.")
			return
		}
		if !webhook.FreshTimestamp(r.Header.Get("X-Paymax-Timestamp"), 5*time.Minute) {
			writeErr(w, http.StatusBadRequest, "invalid_request", "Stale or missing webhook timestamp.")
			return
		}
	}

	var ev struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			Reference   string `json:"reference"`
			Symbol      string `json:"symbol"`
			Amount      int64  `json:"amount"`
			FiatValue   int64  `json:"fiatValue"`
			ProviderRef string `json:"providerRef"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &ev) != nil || ev.ID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed event.")
		return
	}

	// Replay prevention: an event id is processed at most once (reuses the
	// repository idempotency store, keyed under "wh:").
	key := "wh:" + provider + ":" + ev.ID
	if _, seen := s.S.Idempotent(key); seen {
		writeJSON(w, http.StatusOK, map[string]string{"status": "duplicate"})
		return
	}

	// Route the event.
	switch {
	case ev.Type == "deposit.confirmed" && ev.Data.Symbol != "" && ev.Data.Amount > 0:
		// Credit the holding + write a confirmed deposit to history.
		s.S.CreditDeposit(ev.Data.Symbol, ev.Data.Amount, ev.Data.FiatValue, ev.Data.ProviderRef)
	case ev.Type == "withdrawal.failed" && ev.Data.Reference != "":
		// Re-credit the held crypto and mark the withdrawal failed.
		s.S.ReverseWithdrawal(ev.Data.Reference)
	default:
		// order.* / withdrawal.* advance the matching transaction's status.
		if status := txEventStatus[ev.Type]; status != "" && ev.Data.Reference != "" {
			s.S.UpdateTransactionStatus(ev.Data.Reference, status)
		}
	}
	s.S.SaveIdempotent(key, map[string]string{"type": ev.Type, "provider": provider, "status": "processed"})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "type": ev.Type})
}

func (s *Server) postWithdraw(w http.ResponseWriter, r *http.Request) {
	if !s.requireEligible(w) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if cached, ok := s.S.Idempotent(key); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	var d withdrawalDraft
	if err := readJSON(r, &d); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	q, ok := s.CU.WithdrawalQuote(d.AssetID, d.NetworkID, d.Amount)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}
	addr, _ := s.S.AddressByID(d.AddressID)

	// Persist: debit the holding + write a pending-review withdrawal + ledger.
	res, ee := s.S.RecordWithdrawal(q.Symbol, q.NetworkName, addr.Address, q.Amount.Amount, q.NetworkFee.Amount, q.FiatValue.Amount)
	if ee != nil {
		writeErr(w, http.StatusUnprocessableEntity, ee.Type, ee.Message)
		return
	}
	res.IdempotencyKey = key
	s.S.SaveIdempotent(key, res)
	writeJSON(w, http.StatusOK, res)
}
