// Package api wires the HTTP surface: a Go 1.22 ServeMux with one route per
// endpoint the mobile crypto client calls, plus CORS, panic-recovery and JSON
// helpers. Auth is read but not enforced in this mock (demo user).
package api

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"paymax/crypto-backend/internal/admin"
	"paymax/crypto-backend/internal/adapter"
	"paymax/crypto-backend/internal/auth"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/httpadapter"
	"paymax/crypto-backend/internal/metrics"
	"paymax/crypto-backend/internal/ratelimit"
	"paymax/crypto-backend/internal/stocks"
	"paymax/crypto-backend/internal/store"
	"paymax/crypto-backend/internal/tracing"
)

// Server holds the repository + provider adapters (the only dependencies handlers
// need). It depends on the store.Repository interface, so the storage engine
// (in-memory today, Postgres tomorrow) is swappable without touching handlers.
type Server struct {
	S      store.Repository
	MD     adapter.MarketData
	LQ     adapter.Liquidity
	CU     adapter.Custody
	Stocks *stocks.Service
	Admin  *admin.Service
}

// NewServer builds a Server. Provider adapters are mock by default; set
// PROVIDER=http (+ PROVIDER_BASE_URL / PROVIDER_API_KEY) to route market-data,
// liquidity and custody through a real provider behind the same interfaces.
func NewServer(repo store.Repository) *Server {
	s := &Server{
		S:      repo,
		MD:     adapter.MockMarketData{S: repo},
		LQ:     adapter.MockLiquidity{S: repo},
		CU:     adapter.MockCustody{S: repo},
		Stocks: stocks.NewService(),
	}
	s.Admin = admin.NewService(repo, s.Stocks)
	if os.Getenv("PROVIDER") == "http" {
		c := httpadapter.New(os.Getenv("PROVIDER_BASE_URL"), os.Getenv("PROVIDER_API_KEY"))
		s.MD, s.LQ, s.CU = c, c, c // *Client satisfies all three interfaces
		log.Printf("provider: http (%s)", os.Getenv("PROVIDER_BASE_URL"))
	}
	return s
}

// Handler returns the fully-wired HTTP handler (routes + middleware).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	reg := metrics.New()

	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.readyz)
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) { reg.WriteProm(w) })

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

	// ── Stocks ───────────────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/v1/stocks", s.listStocks)
	mux.HandleFunc("GET /api/v1/stocks/orders", s.getStockOrders)
	mux.HandleFunc("POST /api/v1/stocks/orders", s.postStockOrder)
	mux.HandleFunc("GET /api/v1/stocks/orders/{id}", s.getStockOrder)
	mux.HandleFunc("POST /api/v1/stocks/orders/{id}/cancel", s.cancelStockOrder)
	mux.HandleFunc("GET /api/v1/stocks/offers", s.getStockOffers)
	mux.HandleFunc("GET /api/v1/stocks/offers/{id}", s.getStockOffer)
	mux.HandleFunc("POST /api/v1/stocks/offers/{id}/apply", s.applyStockOffer)
	// Single-asset reads are namespaced under /ticker/{symbol} so the {symbol}
	// wildcard cannot cross the literal `orders`/`offers` collections above (Go's
	// ServeMux rejects e.g. `{symbol}/chart` vs `orders/{id}` as ambiguous — both
	// match /stocks/orders/chart). Handlers still read PathValue("symbol").
	mux.HandleFunc("GET /api/v1/stocks/ticker/{symbol}", s.getStock)
	mux.HandleFunc("GET /api/v1/stocks/ticker/{symbol}/chart", s.getStockChart)
	mux.HandleFunc("GET /api/v1/stocks/ticker/{symbol}/news", s.getStockNews)
	mux.HandleFunc("GET /api/v1/stocks/ticker/{symbol}/dividends", s.getStockDividends)
	mux.HandleFunc("GET /api/v1/stocks/ticker/{symbol}/corporate-actions", s.getStockCorporateActions)

	// ── Admin console (RBAC via X-Admin-Role; mutations audited + maker-checker) ─
	mux.HandleFunc("GET /api/v1/admin/dashboard", s.adminDashboard)
	mux.HandleFunc("GET /api/v1/admin/users", s.adminUsers)
	mux.HandleFunc("GET /api/v1/admin/users/{id}", s.adminUser)
	mux.HandleFunc("GET /api/v1/admin/kyc", s.adminKycQueue)
	mux.HandleFunc("POST /api/v1/admin/kyc/{id}/review", s.adminReviewKyc)
	mux.HandleFunc("GET /api/v1/admin/assets", s.adminAssets)
	mux.HandleFunc("PATCH /api/v1/admin/assets/{id}", s.adminUpdateAsset)
	mux.HandleFunc("GET /api/v1/admin/orders", s.adminOrders)
	mux.HandleFunc("GET /api/v1/admin/withdrawals", s.adminWithdrawalQueue)
	mux.HandleFunc("POST /api/v1/admin/withdrawals/{ref}/review", s.adminReviewWithdrawal)
	mux.HandleFunc("GET /api/v1/admin/reconciliation", s.adminReconciliation)
	mux.HandleFunc("GET /api/v1/admin/providers", s.adminProviders)
	mux.HandleFunc("GET /api/v1/admin/risk-limits", s.adminRiskLimits)
	mux.HandleFunc("PATCH /api/v1/admin/risk-limits/{id}", s.adminUpdateRiskLimit)
	mux.HandleFunc("GET /api/v1/admin/fees", s.adminFees)
	mux.HandleFunc("PATCH /api/v1/admin/fees/{id}", s.adminUpdateFee)
	mux.HandleFunc("GET /api/v1/admin/feature-flags", s.adminFlags)
	mux.HandleFunc("PATCH /api/v1/admin/feature-flags/{key}", s.adminSetFlag)
	mux.HandleFunc("GET /api/v1/admin/approvals", s.adminApprovals)
	mux.HandleFunc("POST /api/v1/admin/approvals/{id}/approve", s.adminApprove)
	mux.HandleFunc("POST /api/v1/admin/approvals/{id}/reject", s.adminRejectApproval)
	mux.HandleFunc("GET /api/v1/admin/audit", s.adminAudit)
	mux.HandleFunc("GET /api/v1/admin/admins", s.adminAdmins)

	// Provider webhooks (signature-authenticated, not user-JWT)
	mux.HandleFunc("POST /api/v1/crypto/webhooks/{provider}", s.postWebhook)

	// Admin: ledger ↔ holdings reconciliation
	mux.HandleFunc("GET /api/v1/crypto/admin/reconciliation", s.getReconciliation)

	// recover → metrics → request-id → rate-limit → CORS (preflight) → auth → log.
	// SUPABASE_JWT_SECRET enforces JWT auth; unset = dev mode (single demo user).
	// RS256 (Supabase JWKS) when SUPABASE_JWKS_URL is set, else HS256 shared secret.
	var authMW func(http.Handler) http.Handler
	if jwksURL := os.Getenv("SUPABASE_JWKS_URL"); jwksURL != "" {
		authMW = auth.MiddlewareVerifier(auth.NewJWKSVerifier(jwksURL).Verify)
	} else {
		// Dev fallback (pass-through as demo-user when no secret is set) is OFF by
		// default and fail-closed; enable explicitly with ALLOW_DEV_AUTH=true.
		allowDevAuth := os.Getenv("ALLOW_DEV_AUTH") == "true"
		authMW = auth.Middleware(os.Getenv("SUPABASE_JWT_SECRET"), allowDevAuth)
	}
	rps := envFloat("RATE_LIMIT_RPS", 50)
	rl := rateLimitMW(ratelimit.New(rps, rps*2))
	cors := corsMW(corsAllowedOrigins())
	return recoverMW(metricsMW(reg)(requestIDMW(tracing.Middleware(rl(cors(authMW(logMW(mux))))))))
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			return f
		}
	}
	return def
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "invest-crypto"})
}

// pinger is implemented by storage backends that can be health-probed (Postgres).
type pinger interface{ Ping(context.Context) error }

// readyz reports readiness — including a dependency check (DB) when available.
func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	if p, ok := s.S.(pinger); ok {
		if err := p.Ping(r.Context()); err != nil {
			writeErr(w, http.StatusServiceUnavailable, "internal", "dependency not ready")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// ── Middleware ────────────────────────────────────────────────────────────────

// corsAllowedOrigins reads the CORS allowlist from CORS_ALLOW_ORIGINS (comma-
// separated). Unset → a safe localhost dev default (NOT a wildcard). Set to "*"
// only if you explicitly, knowingly want to allow any origin.
func corsAllowedOrigins() []string {
	if v := strings.TrimSpace(os.Getenv("CORS_ALLOW_ORIGINS")); v != "" {
		parts := strings.Split(v, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	return []string{"http://localhost:3000", "http://localhost:8081", "http://localhost:19006"}
}

// corsMW echoes the request Origin only when it is in the allowlist (or when the
// allowlist is the explicit wildcard "*"), replacing the previous unconditional
// "Access-Control-Allow-Origin: *". Answers preflight.
func corsMW(allowed []string) func(http.Handler) http.Handler {
	wildcard := len(allowed) == 1 && allowed[0] == "*"
	allowSet := make(map[string]bool, len(allowed))
	for _, o := range allowed {
		allowSet[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			h := w.Header()
			h.Add("Vary", "Origin")
			if wildcard {
				h.Set("Access-Control-Allow-Origin", "*")
			} else if origin != "" && allowSet[origin] {
				h.Set("Access-Control-Allow-Origin", origin)
			}
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Admin-Role")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type reqIDKey struct{}

func reqID(ctx context.Context) string {
	v, _ := ctx.Value(reqIDKey{}).(string)
	return v
}

// requestIDMW assigns/propagates an X-Request-ID for correlation in logs.
func requestIDMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = engine.NewID("req")
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), reqIDKey{}, id)))
	})
}

// statusRecorder captures the response status for metrics.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// metricsMW records in-flight, status counts, and latency for every request.
func metricsMW(reg *metrics.Registry) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reg.IncInFlight()
			defer reg.DecInFlight()
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			reg.Observe(rec.status, time.Since(start))
		})
	}
}

// rateLimitMW sheds excess load per client IP (health/readiness/metrics exempt).
func rateLimitMW(l *ratelimit.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			if !l.Allow(clientIP(r)) {
				writeErr(w, http.StatusTooManyRequests, "rate_limited", "Too many requests — slow down.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// clientIP prefers the left-most X-Forwarded-For hop, else the socket address.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[%s] %s %s", reqID(r.Context()), r.Method, r.URL.Path)
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
