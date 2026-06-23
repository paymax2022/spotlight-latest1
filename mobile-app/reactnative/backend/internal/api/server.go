// Package api wires the HTTP surface: a Go 1.22 ServeMux with one route per
// endpoint the mobile crypto client calls, plus CORS, panic-recovery and JSON
// helpers. Auth is read but not enforced in this mock (demo user).
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"paymax/crypto-backend/internal/adapter"
	"paymax/crypto-backend/internal/auth"
	"paymax/crypto-backend/internal/store"
)

// Server holds the repository + provider adapters (the only dependencies handlers
// need). It depends on the store.Repository interface, so the storage engine
// (in-memory today, Postgres tomorrow) is swappable without touching handlers.
type Server struct {
	S  store.Repository
	MD adapter.MarketData
	LQ adapter.Liquidity
	CU adapter.Custody
}

// NewServer builds a Server with the mock provider adapters wired to the repo.
func NewServer(repo store.Repository) *Server {
	return &Server{
		S:  repo,
		MD: adapter.MockMarketData{S: repo},
		LQ: adapter.MockLiquidity{S: repo},
		CU: adapter.MockCustody{S: repo},
	}
}

// Handler returns the fully-wired HTTP handler (routes + middleware).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.health)

	// Eligibility
	mux.HandleFunc("GET /api/v1/invest/eligibility", s.getEligibility)

	// Assets / market data
	mux.HandleFunc("GET /api/v1/crypto/assets", s.getAssets)
	mux.HandleFunc("GET /api/v1/crypto/assets/{symbol}", s.getAsset)
	mux.HandleFunc("GET /api/v1/crypto/assets/{symbol}/chart", s.getChart)

	// Quote + trade
	mux.HandleFunc("POST /api/v1/crypto/quote", s.postQuote)
	mux.HandleFunc("POST /api/v1/crypto/buy", s.postBuy)
	mux.HandleFunc("POST /api/v1/crypto/sell", s.postSell)
	mux.HandleFunc("POST /api/v1/crypto/swap", s.postSwap)

	// Deposit
	mux.HandleFunc("GET /api/v1/crypto/deposit-address", s.getDepositAddress)

	// Portfolio
	mux.HandleFunc("GET /api/v1/portfolio", s.getPortfolio)
	mux.HandleFunc("GET /api/v1/portfolio/positions", s.getPositions)

	// Transactions
	mux.HandleFunc("GET /api/v1/crypto/transactions", s.getTransactions)
	mux.HandleFunc("GET /api/v1/crypto/transactions/{id}", s.getTransaction)

	// Watchlist
	mux.HandleFunc("GET /api/v1/watchlists", s.getWatchlist)
	mux.HandleFunc("POST /api/v1/watchlists/default/assets", s.postWatch)
	mux.HandleFunc("DELETE /api/v1/watchlists/default/assets/{assetId}", s.deleteWatch)

	// Alerts
	mux.HandleFunc("GET /api/v1/alerts", s.getAlerts)
	mux.HandleFunc("POST /api/v1/alerts", s.postAlert)
	mux.HandleFunc("DELETE /api/v1/alerts/{id}", s.deleteAlert)

	// Address book
	mux.HandleFunc("GET /api/v1/crypto/addresses", s.getAddresses)
	mux.HandleFunc("POST /api/v1/crypto/addresses", s.postAddress)
	mux.HandleFunc("POST /api/v1/crypto/addresses/screen", s.postScreen)
	mux.HandleFunc("DELETE /api/v1/crypto/addresses/{id}", s.deleteAddress)

	// Withdrawal
	mux.HandleFunc("GET /api/v1/crypto/withdrawals/eligibility", s.getWithdrawalEligibility)
	mux.HandleFunc("POST /api/v1/crypto/withdrawals/quote", s.postWithdrawalQuote)
	mux.HandleFunc("POST /api/v1/crypto/withdraw", s.postWithdraw)

	// Order: recover → CORS (answers preflight before auth) → auth → log → routes.
	// SUPABASE_JWT_SECRET enforces JWT auth; unset = dev mode (single demo user).
	authMW := auth.Middleware(os.Getenv("SUPABASE_JWT_SECRET"))
	return recoverMW(corsMW(authMW(logMW(mux))))
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "invest-crypto"})
}

// ── Middleware ────────────────────────────────────────────────────────────────

// corsMW allows the Expo web client to call the API and answers preflight.
func corsMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func recoverMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				writeErr(w, http.StatusInternalServerError, "internal", "Unexpected server error.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeErr(w http.ResponseWriter, status int, typ, msg string) {
	writeJSON(w, status, map[string]string{"type": typ, "code": typ, "message": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}
