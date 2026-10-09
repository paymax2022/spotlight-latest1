package main

// Paystack rail — a minimal, deterministic slice of api.paystack.co so the
// wallet top-up funding path (the ONLY card funding rail: POST
// /api/v1/wallet/topup → /transaction/initialize → pay → charge.success
// webhook → GET /api/v1/wallet/topup/:ref verify-on-read) runs e2e locally
// with no real provider. Selected by pointing PAYSTACK_BASE_URL at this
// service; the same env override feeds the Go paystack.Client.
//
// Endpoints (Paystack-compatible shapes):
//
//	POST /transaction/initialize     records a PENDING transaction; replies
//	                                 {status:true,data:{authorization_url,
//	                                 access_code,reference}}
//	GET  /transaction/verify/{ref}   reports the recorded status — the same
//	                                 authority the real verify endpoint is
//	POST /refund                     records a processed refund for a ref
//	GET  /refund?reference=          paged refund list (client's list shape)
//	POST /paystack/simulate          dev-only "customer pays at checkout" step:
//	                                 {reference, outcome:"success"|"failed",
//	                                 deliver_webhook?:bool(default true)}
//	                                 success fires ONE signed charge.success
//	POST /_paystack/complete         dev-only alias settle control:
//	                                 {reference, status?:"success", webhook?:true}
//	GET  /paystack/checkout/{ref}    bare confirmation page for manual QA
//
// Settles fire a signed charge.success at PAYSTACK_FAKE_WEBHOOK_URL (alias:
// PAYSTACK_CALLBACK_URL); empty = flips verify state only.
//
// Wire contract honoured on purpose:
//   - verify replies {status:true,data:{status,amount,reference}} — 'success'
//     is the only state a consumer may treat as collected.
//   - the webhook body echoes the metadata posted at initialize (that is how
//     the wallet handler finds type='wallet_topup' + the intent id) and is
//     signed HMAC-SHA512 of the raw body in x-paystack-signature using
//     PAYSTACK_SECRET_KEY — the same secret the receivers verify with.
//   - replaying simulate/pay for an already-successful ref does NOT refire
//     the webhook (dedupe on ref, like the other rails' idempotency).
//
// SECURITY: this is a DEV/CI tool. It moves no real money and never logs the
// secret — signatures are computed, never the key.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// paystackTx is one recorded transaction.
type paystackTx struct {
	Reference string         `json:"reference"`
	Amount    int64          `json:"amount"` // kobo
	Email     string         `json:"email"`
	Metadata  map[string]any `json:"metadata"`
	Status    string         `json:"status"` // pending | success | failed
	PaidAt    string         `json:"paid_at,omitempty"`
}

type paystackStore struct {
	mu        sync.Mutex
	txs       map[string]*paystackTx
	webhooked map[string]bool           // ref → charge.success already fired
	refunds   map[string][]*paystackRfd // transaction reference → refunds
	nextRfID  int64
}

func newPaystackStore() *paystackStore {
	return &paystackStore{txs: map[string]*paystackTx{}, webhooked: map[string]bool{}, refunds: map[string][]*paystackRfd{}, nextRfID: 1}
}

// paystackRfd is one recorded refund.
type paystackRfd struct {
	ID                   int64  `json:"id"`
	Amount               int64  `json:"amount"`
	Status               string `json:"status"` // "processed"
	TransactionReference string `json:"transaction_reference"`
	MerchantNote         string `json:"merchant_note,omitempty"`
}

// Paystack initialize response/request slices.
type psInitializeRequest struct {
	Email       string         `json:"email"`
	Amount      int64          `json:"amount"`
	Reference   string         `json:"reference"`
	CallbackURL string         `json:"callback_url,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// simulateRequest is the dev-only settle/fail trigger.
type psSimulateRequest struct {
	Reference      string `json:"reference"`
	Outcome        string `json:"outcome"`                   // "success" | "failed"
	DeliverWebhook *bool  `json:"deliver_webhook,omitempty"` // default true
}

// registerPaystack mounts the rail on mux. secret signs outbound webhooks;
// callbackURL is the FULL receiver URL (e.g. http://localhost:3000/api/webhooks/paystack);
// empty disables webhook delivery (verify-on-read still settles the intent).
func (s *server) registerPaystack(mux *http.ServeMux, secret, callbackURL string) {
	ps := &paystackRail{srv: s, store: newPaystackStore(), secret: secret, callbackURL: callbackURL}
	mux.HandleFunc("/transaction/initialize", ps.handleInitialize)
	mux.HandleFunc("/transaction/verify/", ps.handleVerify)
	mux.HandleFunc("/refund", ps.handleRefund)
	mux.HandleFunc("/paystack/simulate", ps.handleSimulate)
	mux.HandleFunc("/_paystack/complete", ps.handleComplete)
	// A pleasant authorization_url target so a human clicking the checkout link
	// from a topup response lands somewhere that explains the fake.
	mux.HandleFunc("/paystack/checkout/", ps.handleCheckoutPage)
	if callbackURL == "" {
		log.Printf("fakes: paystack rail up (webhook delivery DISABLED — set PAYSTACK_FAKE_WEBHOOK_URL to enable)")
	} else {
		log.Printf("fakes: paystack rail up (webhook callback %s)", callbackURL)
	}
}

type paystackRail struct {
	srv         *server
	store       *paystackStore
	secret      string
	callbackURL string
}

func (p *paystackRail) handleInitialize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	var req psInitializeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "bad json"})
		return
	}
	if strings.TrimSpace(req.Reference) == "" || req.Amount <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "reference and a positive amount are required"})
		return
	}
	p.store.mu.Lock()
	// Paystack tolerates a re-initialize of a pending reference; keep the first
	// record so the amount/metadata the payment was opened against never drifts.
	if _, ok := p.store.txs[req.Reference]; !ok {
		p.store.txs[req.Reference] = &paystackTx{
			Reference: req.Reference,
			Amount:    req.Amount,
			Email:     req.Email,
			Metadata:  req.Metadata,
			Status:    "pending",
		}
	}
	p.store.mu.Unlock()
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

func (p *paystackRail) handleVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	ref := strings.TrimPrefix(r.URL.Path, "/transaction/verify/")
	p.store.mu.Lock()
	tx, ok := p.store.txs[ref]
	p.store.mu.Unlock()
	if !ok {
		// Real Paystack: status:false for an unknown reference.
		writeJSON(w, http.StatusOK, map[string]any{"status": false, "message": "Transaction not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  true,
		"message": "Verification successful",
		"data": map[string]any{
			"status":    tx.Status,
			"reference": tx.Reference,
			"amount":    tx.Amount,
			"currency":  "NGN",
			"channel":   "card",
			"paid_at":   tx.PaidAt,
			"metadata":  tx.Metadata,
		},
	})
}

// handleRefund implements POST /refund (create) and GET /refund?reference=
// (lookup, matching the client's paged list shape).
func (p *paystackRail) handleRefund(w http.ResponseWriter, r *http.Request) {
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
		p.store.mu.Lock()
		p.store.nextRfID++
		rf := &paystackRfd{
			ID:                   p.store.nextRfID,
			Amount:               req.Amount,
			Status:               "processed",
			TransactionReference: req.Transaction,
			MerchantNote:         req.MerchantNote,
		}
		p.store.refunds[req.Transaction] = append(p.store.refunds[req.Transaction], rf)
		p.store.mu.Unlock()
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
		p.store.mu.Lock()
		list := p.store.refunds[reference]
		data := make([]*paystackRfd, len(list))
		copy(data, list)
		p.store.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"status": true,
			"meta":   map[string]any{"pageCount": 1},
			"data":   data,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
	}
}

// settle marks a transaction's final state and, for a first-time success with
// a configured callback and delivery requested, fires the signed
// charge.success webhook the real Paystack would send. Returns the tx and
// whether a webhook was armed; ok=false when the reference is unknown.
func (p *paystackRail) settle(reference, status string, deliver bool) (tx *paystackTx, armed bool, ok bool) {
	p.store.mu.Lock()
	defer p.store.mu.Unlock()
	tx, ok = p.store.txs[reference]
	if !ok {
		return nil, false, false
	}
	tx.Status = status
	if status == "success" {
		tx.PaidAt = time.Now().UTC().Format(time.RFC3339)
		// Exactly one webhook per ref — Paystack retries only on receiver
		// failure; redelivery of a settled event is the receiver's dedupe job.
		if deliver && !p.store.webhooked[reference] && p.callbackURL != "" {
			p.store.webhooked[reference] = true
			armed = true
		}
	}
	return tx, armed, true
}

// handleSimulate is the checkout-step stand-in: marks the transaction paid or
// failed and, for a first-time success with a configured callback, fires the
// signed charge.success webhook the real Paystack would send.
func (p *paystackRail) handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": false, "message": "method not allowed"})
		return
	}
	var req psSimulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "bad json"})
		return
	}
	if req.Outcome != "success" && req.Outcome != "failed" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": false, "message": "outcome must be success|failed"})
		return
	}
	deliver := req.DeliverWebhook == nil || *req.DeliverWebhook
	tx, armed, ok := p.settle(req.Reference, req.Outcome, deliver)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"status": false, "message": "unknown reference"})
		return
	}
	if armed {
		go p.fireChargeSuccess(tx)
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": tx, "webhook_delivered": armed})
}

// handleComplete is the alias settle control used by the restaurant-checkout
// e2e: {"reference": "...", "status": "success", "webhook": true} — status
// defaults to "success", webhook defaults to true.
func (p *paystackRail) handleComplete(w http.ResponseWriter, r *http.Request) {
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
	deliver := req.Webhook == nil || *req.Webhook
	tx, armed, ok := p.settle(req.Reference, status, deliver)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"status": false, "message": "charge not found"})
		return
	}
	if armed {
		go p.fireChargeSuccess(tx)
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": true, "data": tx})
}

// fireChargeSuccess POSTs a Paystack-shaped charge.success event to the
// configured callback, signed exactly like the real thing: lowercase-hex
// HMAC-SHA512 of the raw body under PAYSTACK_SECRET_KEY in x-paystack-signature.
func (p *paystackRail) fireChargeSuccess(tx *paystackTx) {
	time.Sleep(p.srv.cfg.delay)
	event := map[string]any{
		"event": "charge.success",
		"data": map[string]any{
			"reference": tx.Reference,
			"amount":    tx.Amount,
			"currency":  "NGN",
			"channel":   "card",
			"status":    "success",
			"paid_at":   tx.PaidAt,
			"customer":  map[string]any{"email": tx.Email},
			"metadata":  tx.Metadata,
		},
	}
	body, err := json.Marshal(event)
	if err != nil {
		log.Printf("fakes: paystack webhook marshal (ref=%s): %v", tx.Reference, err)
		return
	}
	sig := signSHA512(p.secret, body)

	for attempt := 1; attempt <= 3; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, p.callbackURL, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-paystack-signature", sig)
		resp, err := p.srv.httpc.Do(req)
		cancel()
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			resp.Body.Close()
			log.Printf("fakes: paystack charge.success delivered ref=%s -> %d", tx.Reference, resp.StatusCode)
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
		log.Printf("fakes: paystack webhook attempt %d failed ref=%s url=%s", attempt, tx.Reference, p.callbackURL)
		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}
}

// handleCheckoutPage is a bare confirmation page for manual QA clicks; the e2e
// never needs it — it drives /paystack/simulate directly.
func (p *paystackRail) handleCheckoutPage(w http.ResponseWriter, r *http.Request) {
	ref := strings.TrimPrefix(r.URL.Path, "/paystack/checkout/")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, "<html><body><h1>Fake Paystack checkout</h1><p>ref=%s</p><p>POST /paystack/simulate {\"reference\":%q,\"outcome\":\"success\"} to pay.</p></body></html>", ref, ref)
}
