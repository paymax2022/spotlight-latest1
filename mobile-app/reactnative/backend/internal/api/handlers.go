package api

import (
	"net/http"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/store"
)

// ── Eligibility ───────────────────────────────────────────────────────────────

func (s *Server) getEligibility(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, domain.Eligibility{
		State:         "eligible",
		KycTier:       2,
		CryptoEnabled: true,
		Message:       "You're verified and cleared to trade crypto.",
	})
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

// ── Buy / sell — server re-prices the client quote (never trusts client price) ─

func deriveBasisAmount(q domain.Quote) (string, int64) {
	if q.Basis == "fiat" {
		return "fiat", q.Fiat.Amount
	}
	return "crypto", q.Crypto.Amount
}

func (s *Server) postBuy(w http.ResponseWriter, r *http.Request) { s.trade(w, r, "buy") }
func (s *Server) postSell(w http.ResponseWriter, r *http.Request) { s.trade(w, r, "sell") }

func (s *Server) trade(w http.ResponseWriter, r *http.Request, side string) {
	key := r.Header.Get("Idempotency-Key")
	if cached, ok := s.S.Idempotent(key); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	var q domain.Quote
	if err := readJSON(r, &q); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	cur := q.TotalFiat.Currency
	if cur == "" {
		cur = "NGN"
	}
	basis, amount := deriveBasisAmount(q)

	// Server-authoritative pre-trade: re-price with our own engine.
	server, ok := s.LQ.Quote(q.AssetID, side, basis, amount, cur, true)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}

	var order domain.Order
	var ee *store.ExecError
	if side == "buy" {
		order, ee = s.S.ExecuteBuy(server)
	} else {
		order, ee = s.S.ExecuteSell(server)
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
	key := r.Header.Get("Idempotency-Key")
	if cached, ok := s.S.Idempotent(key); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	var q domain.SwapQuote
	if err := readJSON(r, &q); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return
	}
	server, ok := s.LQ.SwapQuote(q.FromAssetID, q.ToAssetID, q.From.Amount)
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "asset_unavailable", "Asset not found.")
		return
	}
	res, e := s.S.ExecuteSwap(server)
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

func (s *Server) getPortfolio(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.S.Portfolio())
}

func (s *Server) getPositions(w http.ResponseWriter, _ *http.Request) {
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

func (s *Server) postWithdraw(w http.ResponseWriter, r *http.Request) {
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
	res := domain.WithdrawalResult{
		ID: engine.NewID("wd"), Reference: engine.NewRef("PMX-WD"), Symbol: q.Symbol,
		Status: "WithdrawalPendingReview", Amount: q.Amount, NetworkFee: q.NetworkFee,
		Address: addr.Address, NetworkName: q.NetworkName,
		ProviderReference: engine.NewRef("CU") + "-WD", IdempotencyKey: key,
		EstimatedReviewMin: 30, CreatedAt: engine.Now(),
	}
	s.S.SaveIdempotent(key, res)
	writeJSON(w, http.StatusOK, res)
}
