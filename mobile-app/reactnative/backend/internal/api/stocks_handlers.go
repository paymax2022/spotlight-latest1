package api

import (
	"net/http"

	"paymax/crypto-backend/internal/stocks"
)

// ── Stocks: market data ───────────────────────────────────────────────────────

func (s *Server) listStocks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Stocks.Assets())
}

func (s *Server) getStock(w http.ResponseWriter, r *http.Request) {
	a, ok := s.Stocks.Asset(r.PathValue("symbol"))
	if !ok {
		writeErr(w, http.StatusNotFound, "asset_unavailable", "Stock not found.")
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) getStockChart(w http.ResponseWriter, r *http.Request) {
	rng := r.URL.Query().Get("range")
	if rng == "" {
		rng = "1D"
	}
	pts, ok := s.Stocks.Chart(r.PathValue("symbol"), rng)
	if !ok {
		writeErr(w, http.StatusNotFound, "asset_unavailable", "Stock not found.")
		return
	}
	writeJSON(w, http.StatusOK, pts)
}

func (s *Server) getStockNews(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Stocks.News(r.PathValue("symbol")))
}

func (s *Server) getStockDividends(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Stocks.Dividends(r.PathValue("symbol")))
}

func (s *Server) getStockCorporateActions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Stocks.CorporateActions(r.PathValue("symbol")))
}

// ── Stocks: orders ─────────────────────────────────────────────────────────────

func (s *Server) postStockOrder(w http.ResponseWriter, r *http.Request) {
	if !s.requireFlag(w, "invest_stocks") {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	var draft stocks.OrderDraft
	if err := readJSON(r, &draft); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed order.")
		return
	}
	order, se := s.Stocks.PlaceOrder(draft, key)
	if se != nil {
		writeErr(w, http.StatusUnprocessableEntity, se.Type, se.Message)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) getStockOrders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Stocks.Orders(r.URL.Query().Get("side")))
}

func (s *Server) getStockOrder(w http.ResponseWriter, r *http.Request) {
	o, ok := s.Stocks.Order(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "invalid_request", "Order not found.")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (s *Server) cancelStockOrder(w http.ResponseWriter, r *http.Request) {
	o, ok := s.Stocks.CancelOrder(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusUnprocessableEntity, "conflict", "Order cannot be cancelled.")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

// ── Stocks: public offers ──────────────────────────────────────────────────────

func (s *Server) getStockOffers(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Stocks.PublicOffers())
}

func (s *Server) getStockOffer(w http.ResponseWriter, r *http.Request) {
	o, ok := s.Stocks.PublicOffer(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "invalid_request", "Offer not found.")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (s *Server) applyStockOffer(w http.ResponseWriter, r *http.Request) {
	if !s.requireFlag(w, "public_offers") {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	var body struct {
		Units int64 `json:"units"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed application.")
		return
	}
	order, se := s.Stocks.ApplyToOffer(r.PathValue("id"), body.Units, key)
	if se != nil {
		writeErr(w, http.StatusUnprocessableEntity, se.Type, se.Message)
		return
	}
	writeJSON(w, http.StatusOK, order)
}
