// Command fakes is a standalone, deterministic HTTP fake-provider service for the
// four unbacked Paymax/Spotlight Academy rails (BNPL, payout, disbursement,
// billing). It is selected by RAILS_MODE=fake in the backend and is wired into the
// devcontainer compose so the FULL code path (create → async signed webhook →
// state flip + ledger leg) runs locally with NO real provider.
//
// Design goals (ENVIRONMENT-AND-GOLIVE.md §3):
//   - Same shapes/webhooks as a real provider sandbox, so only the adapter swaps
//     between fake | sandbox | live — the backend code path is identical.
//   - Deterministic provider refs derived from the Idempotency-Key (replayable).
//   - Idempotent on the Idempotency-Key header: same key ⇒ same ref, ONE webhook.
//   - Async approve/settle webhook POSTed back to a configured callback URL after a
//     short delay, signed with HMAC-SHA256 over the raw body (header
//     X-Fake-Signature: sha256=<hex>), using a shared secret.
//
// SECURITY: secrets are read from env and NEVER logged. Signatures are computed,
// never the key itself. This is a DEV/CI tool — it moves no real money.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── Config (env, with safe dev defaults) ──────────────────────────────────────

type config struct {
	addr string // listen address (default :9100)
	// Shared HMAC secret used to sign every outbound webhook. The backend's
	// per-rail BNPL_WEBHOOK_SECRET / PAYOUT_WEBHOOK_SECRET / ... must match the
	// secret for the rail it verifies. We keep one shared default for the local
	// fake; per-rail overrides are honoured if set.
	secretDefault string
	secretBNPL    string
	secretPayout  string
	secretDisb    string
	secretBilling string
	// Callback base: where to POST async webhooks. The backend mounts
	// /internal/webhooks/academy/{bnpl,payout,disburse,billing}. Default points at
	// the compose service name "backend".
	callbackBase string
	// delay before the async webhook fires (approve/settle).
	delay time.Duration
	// Paystack rail: the shared webhook receiver the backend mounts at
	// /api/webhooks/paystack/go. paystackWebhookURL is where charge.success is
	// POSTed when a charge is completed via the /_paystack/complete control
	// endpoint (empty = complete only flips verify state, no webhook — the
	// caller then relies on the backend's status-poll self-heal).
	// paystackSecret is the HMAC-SHA512 key the webhook is signed with; it must
	// equal the backend's PAYSTACK_SECRET_KEY (Paystack signs with the secret
	// key itself — there is no separate webhook secret).
	paystackWebhookURL string
	paystackSecret     string
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func loadConfig() config {
	delayMS := 750
	if v := os.Getenv("FAKE_WEBHOOK_DELAY_MS"); v != "" {
		if _, err := fmt.Sscanf(v, "%d", &delayMS); err != nil {
			delayMS = 750
		}
	}
	shared := getenv("FAKE_WEBHOOK_SECRET", "dev-fake-secret")
	return config{
		addr:          getenv("FAKE_ADDR", ":9100"),
		secretDefault: shared,
		secretBNPL:    getenv("BNPL_WEBHOOK_SECRET", shared),
		secretPayout:  getenv("PAYOUT_WEBHOOK_SECRET", shared),
		secretDisb:    getenv("DISBURSE_WEBHOOK_SECRET", shared),
		secretBilling: getenv("BILLING_WEBHOOK_SECRET", shared),
		callbackBase:  getenv("FAKE_CALLBACK_BASE_URL", "http://backend:8080/internal/webhooks/academy"),
		delay:         time.Duration(delayMS) * time.Millisecond,
		// Default empty webhook URL = self-heal-only mode. The secret defaults
		// to a deterministic local value so a backend started with the same
		// PAYSTACK_SECRET_KEY verifies the signature; override via env to match
		// whatever the backend under test is configured with.
		paystackWebhookURL: getenv("PAYSTACK_FAKE_WEBHOOK_URL", ""),
		paystackSecret:     getenv("PAYSTACK_SECRET_KEY", "sk_test_fake_local_secret"),
	}
}

// ── Idempotency store (in-memory; dev only) ───────────────────────────────────
// Keyed by (rail, idemKey) → the ref we already minted, so a replay returns the
// SAME ref and fires NO second webhook.

type idemStore struct {
	mu   sync.Mutex
	seen map[string]string // key → ref
}

func newIdemStore() *idemStore { return &idemStore{seen: map[string]string{}} }

// reserve returns (ref, firstTime). On first sight it records the freshly minted
// ref and returns firstTime=true; on replay it returns the stored ref, false.
func (s *idemStore) reserve(rail, idemKey, ref string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := rail + ":" + idemKey
	if existing, ok := s.seen[k]; ok {
		return existing, false
	}
	s.seen[k] = ref
	return ref, true
}

// ── Provider ref derivation (deterministic) ───────────────────────────────────

func deriveRef(prefix, idemKey string) string {
	sum := sha256.Sum256([]byte(prefix + ":" + idemKey))
	return prefix + "_" + hex.EncodeToString(sum[:8])
}

// ── Wire shapes ───────────────────────────────────────────────────────────────

// createRequest is the common create body the backend adapters POST. Only the
// fields a fake needs are decoded; extras are ignored.
type createRequest struct {
	UserID         string `json:"user_id,omitempty"`
	AccountRef     string `json:"account_ref,omitempty"`
	InstitutionRef string `json:"institution_ref,omitempty"`
	Reference      string `json:"reference"`
	AmountMinor    int64  `json:"amount_minor"`
}

// createResponse mirrors a typical provider sandbox create ack.
type createResponse struct {
	Ref       string `json:"ref"`
	Status    string `json:"status"` // "pending" — settles via the async webhook
	Reference string `json:"reference"`
	Amount    int64  `json:"amount_minor"`
}

// webhookEvent is the async callback body (signed). It carries the SAME provider
// ref + reference + idem key so the backend can dedupe + reconcile.
type webhookEvent struct {
	Rail        string `json:"rail"`
	Event       string `json:"event"` // "approved" | "settled"
	Ref         string `json:"ref"`
	Reference   string `json:"reference"`
	IdemKey     string `json:"idempotency_key"`
	AmountMinor int64  `json:"amount_minor"`
	Status      string `json:"status"` // "success"
	OccurredAt  string `json:"occurred_at"`
}

// ── Server ────────────────────────────────────────────────────────────────────

type server struct {
	cfg     config
	idem    *idemStore
	httpc   *http.Client
	charges *chargeStore
}

func main() {
	cfg := loadConfig()
	s := &server{
		cfg:     cfg,
		idem:    newIdemStore(),
		httpc:   &http.Client{Timeout: 10 * time.Second},
		charges: newChargeStore(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	// rail, ref prefix, callback sub-path, webhook secret, event name
	mux.HandleFunc("/bnpl/plans", s.makeCreate("bnpl", "bnpl", "/bnpl", cfg.secretBNPL, "approved"))
	mux.HandleFunc("/payout/transfers", s.makeCreate("payout", "payout", "/payout", cfg.secretPayout, "settled"))
	mux.HandleFunc("/disburse", s.makeCreate("disburse", "disb", "/disburse", cfg.secretDisb, "settled"))
	mux.HandleFunc("/billing/charges", s.makeCreate("billing", "bill", "/billing", cfg.secretBilling, "settled"))

	// Paystack rail — mirrors the api.paystack.co surface the backend's
	// provider/paystack.Client calls, so PAYSTACK_BASE_URL=http://<fake> runs
	// the FULL initialize → verify → (refund) path locally with no real key.
	// A charge starts "pending"; the dev-only control endpoint
	// POST /_paystack/complete flips it to success and (when
	// PAYSTACK_FAKE_WEBHOOK_URL is set) fires a properly HMAC-SHA512-signed
	// charge.success at the backend's shared webhook receiver.
	mux.HandleFunc("/transaction/initialize", s.paystackInitialize)
	mux.HandleFunc("/transaction/verify/", s.paystackVerify)
	mux.HandleFunc("/refund", s.paystackRefund)
	mux.HandleFunc("/_paystack/complete", s.paystackComplete)

	log.Printf("fakes: listening on %s (callback base %s, webhook delay %s)", cfg.addr, cfg.callbackBase, cfg.delay)
	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("fakes: server error: %v", err)
	}
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "fakes"})
}

// makeCreate builds a POST handler for one rail: it mints a deterministic ref,
// is idempotent on the Idempotency-Key header, returns a pending ack, and (only
// on first sight of the key) schedules a single signed async webhook.
func (s *server) makeCreate(rail, refPrefix, callbackPath, secret, event string) http.HandlerFunc {
	callbackURL := s.cfg.callbackBase + callbackPath
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		idemKey := r.Header.Get("Idempotency-Key")
		if idemKey == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing Idempotency-Key"})
			return
		}
		var req createRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}

		ref, firstTime := s.idem.reserve(rail, idemKey, deriveRef(refPrefix, idemKey))

		// Always ack with the (stable) ref and pending status, just like a sandbox.
		writeJSON(w, http.StatusOK, createResponse{
			Ref:       ref,
			Status:    "pending",
			Reference: req.Reference,
			Amount:    req.AmountMinor,
		})

		// Fire the async settle/approve webhook exactly once per idem key.
		if firstTime {
			evt := webhookEvent{
				Rail:        rail,
				Event:       event,
				Ref:         ref,
				Reference:   req.Reference,
				IdemKey:     idemKey,
				AmountMinor: req.AmountMinor,
				Status:      "success",
				OccurredAt:  time.Now().UTC().Format(time.RFC3339),
			}
			go s.fireWebhook(callbackURL, secret, evt)
		}
	}
}

// fireWebhook waits the configured delay, then POSTs the signed event to the
// backend callback. Best-effort with a couple of retries — this is a dev tool.
func (s *server) fireWebhook(url, secret string, evt webhookEvent) {
	time.Sleep(s.cfg.delay)
	body, err := json.Marshal(evt)
	if err != nil {
		log.Printf("fakes: marshal webhook (rail=%s ref=%s): %v", evt.Rail, evt.Ref, err)
		return
	}
	sig := sign(secret, body)

	for attempt := 1; attempt <= 3; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Fake-Signature", "sha256="+sig)
		resp, err := s.httpc.Do(req)
		cancel()
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			resp.Body.Close()
			log.Printf("fakes: webhook delivered rail=%s event=%s ref=%s -> %d", evt.Rail, evt.Event, evt.Ref, resp.StatusCode)
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
		log.Printf("fakes: webhook attempt %d failed rail=%s ref=%s url=%s", attempt, evt.Rail, evt.Ref, url)
		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}
}

// sign computes the lowercase-hex HMAC-SHA256 of body using secret. The secret is
// never logged.
func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// signSHA512 computes the lowercase-hex HMAC-SHA512 of body — the algorithm
// Paystack uses for X-Paystack-Signature (signed with the merchant secret key).
func signSHA512(secret string, body []byte) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// ── Paystack rail ─────────────────────────────────────────────────────────────
// In-memory charge/refund store mirroring the slice of api.paystack.co that
// backend/internal/provider/paystack.Client calls. Amounts stay integer minor
// units (kobo) end to end — the fake never floats money either.
//
// Lifecycle: POST /transaction/initialize records a PENDING charge and echoes a
// reference/authorization_url/access_code. Nothing pays it implicitly — the
// test driver calls POST /_paystack/complete to mark it success (and, when
// PAYSTACK_FAKE_WEBHOOK_URL is configured, deliver a signed charge.success).
// GET /transaction/verify/{reference} reports the stored state, so an
// un-completed charge verifies as NOT successful — the backend's fail-closed
// path is genuinely exercised.

type charge struct {
	Reference string `json:"reference"`
	Amount    int64  `json:"amount"`
	Email     string `json:"email"`
	Status    string `json:"status"` // "pending" | "success"
	PaidAt    string `json:"paid_at,omitempty"`
}

type refund struct {
	ID                   int64  `json:"id"`
	Amount               int64  `json:"amount"`
	Status               string `json:"status"` // "processed"
	TransactionReference string `json:"transaction_reference"`
	MerchantNote         string `json:"merchant_note,omitempty"`
}

type chargeStore struct {
	mu       sync.Mutex
	charges  map[string]*charge
	refunds  map[string][]*refund // transaction reference → refunds
	nextRfID int64
}

func newChargeStore() *chargeStore {
	return &chargeStore{charges: map[string]*charge{}, refunds: map[string][]*refund{}, nextRfID: 1}
}

// paystackInitialize handles POST /transaction/initialize. Idempotent on
// reference: a second initialize with an existing reference returns the same
// charge (Paystack behaves the same way for a duplicate reference).
func (s *server) paystackInitialize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	var req struct {
		Email       string `json:"email"`
		Amount      int64  `json:"amount"`
		Reference   string `json:"reference"`
		CallbackURL string `json:"callback_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Reference == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "bad request: reference is required"})
		return
	}

	s.charges.mu.Lock()
	if _, ok := s.charges.charges[req.Reference]; !ok {
		s.charges.charges[req.Reference] = &charge{
			Reference: req.Reference,
			Amount:    req.Amount,
			Email:     req.Email,
			Status:    "pending",
		}
	}
	s.charges.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":  true,
		"message": "Authorization URL created",
		"data": map[string]any{
			"authorization_url": fmt.Sprintf("http://%s/paystack/checkout/%s", r.Host, req.Reference),
			"access_code":       "fake_" + req.Reference,
			"reference":         req.Reference,
		},
	})
}

// paystackVerify handles GET /transaction/verify/{reference}. Unknown
// references answer status:false exactly like Paystack, so the backend's
// fail-closed "charge_not_successful / verify failed" path is real.
func (s *server) paystackVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	reference := strings.TrimPrefix(r.URL.Path, "/transaction/verify/")

	s.charges.mu.Lock()
	c, ok := s.charges.charges[reference]
	s.charges.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"status": false, "message": "Transaction not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  true,
		"message": "Verification successful",
		"data": map[string]any{
			"status":    c.Status,
			"reference": c.Reference,
			"amount":    c.Amount,
			"currency":  "NGN",
			"channel":   "card",
			"paid_at":   c.PaidAt,
		},
	})
}

// paystackRefund handles POST /refund (create) and GET /refund?reference=
// (lookup, matching the client's paged list shape).
func (s *server) paystackRefund(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			Transaction  string `json:"transaction"`
			Amount       int64  `json:"amount"`
			MerchantNote string `json:"merchant_note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Transaction == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "bad request: transaction is required"})
			return
		}
		s.charges.mu.Lock()
		s.charges.nextRfID++
		rf := &refund{
			ID:                   s.charges.nextRfID,
			Amount:               req.Amount,
			Status:               "processed",
			TransactionReference: req.Transaction,
			MerchantNote:         req.MerchantNote,
		}
		s.charges.refunds[req.Transaction] = append(s.charges.refunds[req.Transaction], rf)
		s.charges.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  true,
			"message": "Refund has been queued",
			"data": map[string]any{
				"id":            rf.ID,
				"transaction":   map[string]any{"reference": rf.TransactionReference},
				"status":        rf.Status,
				"amount":        rf.Amount,
				"merchant_note": rf.MerchantNote,
			},
		})
	case http.MethodGet:
		reference := r.URL.Query().Get("reference")
		s.charges.mu.Lock()
		list := s.charges.refunds[reference]
		data := make([]*refund, len(list))
		copy(data, list)
		s.charges.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"status": true,
			"meta":   map[string]any{"pageCount": 1},
			"data":   data,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
	}
}

// paystackComplete is the DEV-ONLY control endpoint — the stand-in for a real
// card authorisation, which no fake can produce by itself. Body:
//
//	{"reference": "...", "status": "success", "webhook": true}
//
// status defaults to "success"; webhook defaults to true. With
// PAYSTACK_FAKE_WEBHOOK_URL unset the call only flips verify state (exercises
// the backend's status-poll self-heal); with it set, a signed charge.success
// is POSTed there (exercises the real webhook pipeline end to end).
func (s *server) paystackComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	var req struct {
		Reference string `json:"reference"`
		Status    string `json:"status"`
		Webhook   *bool  `json:"webhook"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Reference == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "bad request: reference is required"})
		return
	}
	status := req.Status
	if status == "" {
		status = "success"
	}

	s.charges.mu.Lock()
	c, ok := s.charges.charges[req.Reference]
	if ok {
		c.Status = status
		if status == "success" {
			c.PaidAt = time.Now().UTC().Format(time.RFC3339)
		}
	}
	s.charges.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"status": false, "message": "charge not found"})
		return
	}

	fireWebhook := req.Webhook == nil || *req.Webhook
	if fireWebhook && status == "success" && s.cfg.paystackWebhookURL != "" {
		go s.firePaystackWebhook(c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": c})
}

// firePaystackWebhook delivers a charge.success event shaped like Paystack's,
// signed with the shared secret (HMAC-SHA512, X-Paystack-Signature header).
func (s *server) firePaystackWebhook(c *charge) {
	body, err := json.Marshal(map[string]any{
		"event": "charge.success",
		"data": map[string]any{
			"reference": c.Reference,
			"amount":    c.Amount,
			"status":    "success",
			"channel":   "card",
			"currency":  "NGN",
			"paid_at":   c.PaidAt,
		},
	})
	if err != nil {
		log.Printf("fakes: marshal paystack webhook (ref=%s): %v", c.Reference, err)
		return
	}
	for attempt := 1; attempt <= 3; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.paystackWebhookURL, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Paystack-Signature", signSHA512(s.cfg.paystackSecret, body))
		resp, err := s.httpc.Do(req)
		cancel()
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			resp.Body.Close()
			log.Printf("fakes: paystack charge.success delivered ref=%s -> %d", c.Reference, resp.StatusCode)
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
		log.Printf("fakes: paystack webhook attempt %d failed ref=%s url=%s", attempt, c.Reference, s.cfg.paystackWebhookURL)
		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
