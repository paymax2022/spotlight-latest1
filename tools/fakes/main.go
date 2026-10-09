// Command fakes is a standalone, deterministic HTTP fake-provider service for the
// four unbacked Paymax/Spotlight Academy rails (BNPL, payout, disbursement,
// billing) plus the Maplerad FX rail. The academy rails are selected by
// RAILS_MODE=fake in the backend and are wired into the devcontainer compose so
// the FULL code path (create → async signed webhook → state flip + ledger leg)
// runs locally with NO real provider. The Maplerad rail is selected by pointing
// MAPLERAD_BASE_URL at {fake}/maplerad; it speaks the provider's REAL FX
// contract as probed against the sandbox (rate board → firm single-use quote →
// exchange) so the live adapters run their production code path end to end.
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
	"math"
	"net/http"
	"os"
	"strconv"
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
	// POSTed when a charge is completed via the /_paystack/complete or
	// /paystack/simulate control endpoints (empty = complete only flips verify
	// state — the caller then relies on the backend's status-poll self-heal).
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
		// Receiver env: PAYSTACK_FAKE_WEBHOOK_URL (documented), with
		// PAYSTACK_CALLBACK_URL accepted as an alias. Secret: PAYSTACK_SECRET_KEY
		// (what receivers verify with), PAYSTACK_WEBHOOK_SECRET as alias, then a
		// deterministic local default.
		paystackWebhookURL: getenv("PAYSTACK_FAKE_WEBHOOK_URL", getenv("PAYSTACK_CALLBACK_URL", "")),
		paystackSecret:     getenv("PAYSTACK_SECRET_KEY", getenv("PAYSTACK_WEBHOOK_SECRET", "sk_test_fake_local_secret")),
	}
}

// ── Maplerad quote store (in-memory; dev only) ────────────────────────────────
// Maplerad's exchange endpoint takes ONLY a quote reference — no client
// reference or idempotency key — and the reference is SINGLE USE. The fake
// reproduces exactly that: a second exchange of the same reference answers
// "could not find quote" (HTTP 200, status:false), so an idempotency
// regression in our code surfaces here instead of double-converting.

type mplQuote struct {
	SourceCur, TargetCur   string
	SourceMinor, TargMinor int64
	Rate                   float64
	Spent                  bool
}

type mplStore struct {
	mu     sync.Mutex
	quotes map[string]*mplQuote
}

func newMplStore() *mplStore { return &mplStore{quotes: map[string]*mplQuote{}} }

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
	cfg   config
	idem  *idemStore
	mpl   *mplStore
	httpc *http.Client
}

func main() {
	cfg := loadConfig()
	s := &server{
		cfg:   cfg,
		idem:  newIdemStore(),
		mpl:   newMplStore(),
		httpc: &http.Client{Timeout: 10 * time.Second},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	// rail, ref prefix, callback sub-path, webhook secret, event name
	mux.HandleFunc("/bnpl/plans", s.makeCreate("bnpl", "bnpl", "/bnpl", cfg.secretBNPL, "approved"))
	mux.HandleFunc("/payout/transfers", s.makeCreate("payout", "payout", "/payout", cfg.secretPayout, "settled"))
	mux.HandleFunc("/disburse", s.makeCreate("disburse", "disb", "/disburse", cfg.secretDisb, "settled"))
	mux.HandleFunc("/billing/charges", s.makeCreate("billing", "bill", "/billing", cfg.secretBilling, "settled"))
	// Maplerad rail — selected by MAPLERAD_BASE_URL={fake}/maplerad.
	mux.HandleFunc("/maplerad/fx/rates", s.mplRates)
	mux.HandleFunc("/maplerad/fx/quote", s.mplQuoteBook)
	mux.HandleFunc("/maplerad/fx", s.mplExchange)
	mux.HandleFunc("/maplerad/transfers", s.mplTransfer)
	mux.HandleFunc("/maplerad/issuing/virtual-accounts", s.mplVirtualAccount)
	mux.HandleFunc("/maplerad/customers", s.mplCustomer)
	mux.HandleFunc("/maplerad/counterparties", s.mplCounterparty)
	mux.HandleFunc("/maplerad/counterparties/resolve", s.mplCounterpartyResolve)
	mux.HandleFunc("/maplerad/bills", s.mplBill)

	// Paystack rail — mirrors the api.paystack.co surface the backend's
	// provider/paystack.Client and the frontend wallet service call, so
	// PAYSTACK_BASE_URL=http://<fake> runs the full initialize → verify →
	// (refund) path locally with no real key. Dev-only settle controls:
	// /_paystack/complete and /paystack/simulate. See paystack.go.
	s.registerPaystack(mux, cfg.paystackSecret, cfg.paystackWebhookURL)

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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ── Maplerad rail ─────────────────────────────────────────────────────────────
// Speaks the REAL NGN v1 contract the client at
// backend/internal/provider/maplerad was probed against:
//   - every payload is {"status":bool,"data":...,"message":...}; business errors
//     answer HTTP 200 with status:false (never rely on the HTTP code);
//   - GET /fx/rates is a rate BOARD (corridor list, reference always "");
//   - POST /fx/quote books a firm quote → {reference}; POST /fx exchanges it by
//     {"quote_reference": ...} and the reference is single-use;
//   - amounts on the wire are minor units; rate is major→major.
// Every handler requires a Bearer token — an unauthenticated call is a
// configuration bug, not a fake-able success.

type mplLeg struct {
	Currency string `json:"currency"`
	Amount   int64  `json:"amount"`
}

type mplEntry struct {
	Reference string  `json:"reference"`
	Source    mplLeg  `json:"source"`
	Target    mplLeg  `json:"target"`
	Rate      float64 `json:"rate"`
}

// mplCorridors is the fake's rate board. Each sample encodes both currencies at
// the same minor exponent (scale = 1), mirroring the sandbox entries.
var mplCorridors = []mplEntry{
	{Source: mplLeg{"USD", 100}, Target: mplLeg{"NGN", 165_000}, Rate: 1650},
	{Source: mplLeg{"NGN", 165_000}, Target: mplLeg{"USD", 100}, Rate: 1.0 / 1650},
	{Source: mplLeg{"USD", 100}, Target: mplLeg{"XAF", 60_500}, Rate: 605},
	{Source: mplLeg{"NGN", 165_000}, Target: mplLeg{"XAF", 60_500}, Rate: 605.0 / 1650},
	{Source: mplLeg{"KES", 10_000}, Target: mplLeg{"USD", 78}, Rate: 0.0078},
	{Source: mplLeg{"USD", 100}, Target: mplLeg{"GHS", 1_560}, Rate: 15.6},
}

func mplFail(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusOK, map[string]any{"status": false, "message": msg})
}

// mplAuth mirrors the provider's Bearer check loosely: present is enough — the
// fake never validates the key value (it is a dev tool, not an auth oracle).
func (s *server) mplAuth(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"status": false, "message": "unauthorized"})
		return false
	}
	return true
}

// mplRate returns the board rate + a target amount for a corridor, or false.
// All fake corridors share a minor exponent, so target = round(src*rate).
func mplRate(source, target string, srcMinor int64) (float64, int64, bool) {
	for _, e := range mplCorridors {
		if strings.EqualFold(e.Source.Currency, source) && strings.EqualFold(e.Target.Currency, target) {
			return e.Rate, int64(math.Round(float64(srcMinor) * e.Rate)), true
		}
	}
	return 0, 0, false
}

// GET /maplerad/fx/rates — the board. No reference field is ever populated:
// this endpoint issues no quote ids (same as the real API).
func (s *server) mplRates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": mplCorridors})
}

// POST /maplerad/fx/quote — books a firm quote and returns its single-use
// reference. Deterministic ref derived from the request so a retry of the SAME
// booking returns the same reference (mirrors provider quote dedup).
func (s *server) mplQuoteBook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		SourceCurrency string `json:"source_currency"`
		TargetCurrency string `json:"target_currency"`
		Amount         int64  `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
		mplFail(w, "invalid quote request")
		return
	}
	rate, tgt, ok := mplRate(req.SourceCurrency, req.TargetCurrency, req.Amount)
	if !ok {
		mplFail(w, fmt.Sprintf("%s exchanges are not enabled for this business", strings.ToUpper(req.SourceCurrency)))
		return
	}
	ref := deriveRef("mplq", strings.ToUpper(req.SourceCurrency)+":"+strings.ToUpper(req.TargetCurrency)+":"+strconv.FormatInt(req.Amount, 10))
	s.mpl.mu.Lock()
	if _, exists := s.mpl.quotes[ref]; !exists {
		s.mpl.quotes[ref] = &mplQuote{
			SourceCur: strings.ToUpper(req.SourceCurrency), TargetCur: strings.ToUpper(req.TargetCurrency),
			SourceMinor: req.Amount, TargMinor: tgt, Rate: rate,
		}
	}
	q := s.mpl.quotes[ref]
	s.mpl.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": mplEntry{
		Reference: ref,
		Source:    mplLeg{q.SourceCur, q.SourceMinor},
		Target:    mplLeg{q.TargetCur, q.TargMinor},
		Rate:      q.Rate,
	}})
}

// POST /maplerad/fx — exchanges a booked quote by reference. SINGLE USE: a
// second exchange (or an unknown/expired reference) answers "could not find
// quote" with status:false at HTTP 200 — the provider's real behaviour, and the
// backstop our idempotency layer relies on.
func (s *server) mplExchange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		QuoteReference string `json:"quote_reference"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.QuoteReference == "" {
		mplFail(w, "could not find quote")
		return
	}
	s.mpl.mu.Lock()
	q, ok := s.mpl.quotes[req.QuoteReference]
	if ok && q.Spent {
		ok = false
	}
	if ok {
		q.Spent = true
	}
	s.mpl.mu.Unlock()
	if !ok {
		mplFail(w, "could not find quote")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"source":     mplLeg{q.SourceCur, q.SourceMinor},
		"target":     mplLeg{q.TargetCur, q.TargMinor},
		"rate":       q.Rate,
		"created_at": time.Now().UTC().Format(time.RFC3339),
		"updated_at": time.Now().UTC().Format(time.RFC3339),
	}})
}

// POST /maplerad/transfers — payout initiate. Acknowledges pending with a
// deterministic transfer id derived from the client reference (idempotent on
// that reference, like the real API's dedup on `reference`).
func (s *server) mplTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		Counterparty string `json:"counterparty"`
		Amount       int64  `json:"amount"`
		Reference    string `json:"reference"`
		Currency     string `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 || req.Reference == "" {
		mplFail(w, "invalid transfer request")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"id":        deriveRef("mpltr", req.Reference),
		"status":    "pending",
		"reference": req.Reference,
	}})
}

// POST /maplerad/issuing/virtual-accounts — provisions a collections VA.
func (s *server) mplVirtualAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	sum := sha256.Sum256([]byte("mplva:" + req.Email))
	acct := int64(sum[0])<<24 | int64(sum[1])<<16 | int64(sum[2])<<8 | int64(sum[3])
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"account_number": fmt.Sprintf("99%08d", acct%100000000),
		"account_name":   "Paymax / Customer",
		"bank_name":      "Wema Bank",
		"bank_code":      "035",
	}})
}

// POST /maplerad/customers — identity create. Deterministic id derived from the
// email so a retry returns the same provider customer.
func (s *server) mplCustomer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Email     string `json:"email"`
		Country   string `json:"country"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"id":         deriveRef("mplcus", req.Email),
		"first_name": req.FirstName,
		"last_name":  req.LastName,
		"email":      req.Email,
		"status":     "active",
	}})
}

// GET /maplerad/counterparties/resolve?account_number&bank_code — account
// resolution. A 10-digit number resolves to a deterministic name.
func (s *server) mplCounterpartyResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	acct := r.URL.Query().Get("account_number")
	if len(acct) != 10 {
		mplFail(w, "could not resolve account")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"account_number": acct,
		"account_name":   "E2E Fake Beneficiary",
	}})
}

// POST /maplerad/counterparties — registers a payout target; returns its id.
func (s *server) mplCounterparty(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		AccountNumber string `json:"account_number"`
		BankCode      string `json:"bank_code"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"id": deriveRef("mplcp", req.BankCode+":"+req.AccountNumber),
	}})
}

// POST /maplerad/bills — bill purchase. Acknowledges PENDING (terminal status
// arrives by webhook, which the fake does not model for this rail).
func (s *server) mplBill(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	if !s.mplAuth(w, r) {
		return
	}
	var req struct {
		Reference string         `json:"reference"`
		Type      string         `json:"type"`
		Amount    int64          `json:"amount"`
		Params    map[string]any `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Reference == "" || req.Amount <= 0 {
		mplFail(w, "invalid bill request")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": map[string]any{
		"id":        deriveRef("mplbill", req.Reference),
		"reference": req.Reference,
		"type":      req.Type,
		"status":    "pending",
		"amount":    req.Amount,
	}})
}
