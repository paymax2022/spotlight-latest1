package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/academy/commerce"
	"spotlight/backend/internal/academy/edupay"
	"spotlight/backend/internal/academy/schools"
	"spotlight/backend/internal/academy/tutor"
	"spotlight/backend/internal/config"
)

// academy_rails_external.go — HTTP-calling adapters for the four UNBACKED academy
// rails (BNPL, payout, disbursement, billing) behind their EXISTING provider-
// agnostic gateway interfaces. The SAME adapter serves RAILS_MODE=fake and
// RAILS_MODE=sandbox (only base URL + API key + webhook secret differ); LIVE later
// swaps base URL + creds. No vendor type leaks into the domain packages
// (paymax-rails.md §1 "adapter, not SDK leak").
//
// Each adapter POSTs a create request to the configured base URL with the caller's
// Idempotency-Key header and parses the returned provider ref. The provider then
// settles ASYNC by signing a webhook back to /internal/webhooks/academy/* (see
// academy_webhooks.go), which performs the idempotent state flip + ledger leg.
//
// IDEMPOTENCY (NL-9): the Idempotency-Key header is forwarded verbatim; the
// fake/sandbox returns the SAME ref for the same key and fires ONE webhook.
// SECURITY: API keys/secrets are never logged.

// ── Generic HTTP rail client ──────────────────────────────────────────────────

// railHTTP is the shared HTTP client for one rail endpoint. It mirrors the maps
// HTTPProvider plumbing (Bearer auth, JSON, status-checked do()).
type railHTTP struct {
	baseURL string // gateway root, no trailing slash
	apiKey  string // Bearer token (server-side only)
	path    string // create sub-path, e.g. "/bnpl/plans"
	client  *http.Client
}

func newRailHTTP(baseURL, apiKey, path string) *railHTTP {
	return &railHTTP{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		path:    path,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

// createReq is the common create body POSTed to a rail. Only the relevant subject
// field is populated per rail (user / account / institution).
type railCreateReq struct {
	UserID         string `json:"user_id,omitempty"`
	AccountRef     string `json:"account_ref,omitempty"`
	InstitutionRef string `json:"institution_ref,omitempty"`
	Reference      string `json:"reference"`
	AmountMinor    int64  `json:"amount_minor"`
}

type railCreateResp struct {
	Ref string `json:"ref"`
}

// create POSTs the request with the idempotency key and returns the provider ref.
func (h *railHTTP) create(ctx context.Context, idemKey string, body railCreateReq) (string, error) {
	if idemKey == "" {
		return "", fmt.Errorf("academy rail: missing idempotency key")
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.baseURL+h.path, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Idempotency-Key", idemKey)
	if h.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+h.apiKey)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("academy rail: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return "", fmt.Errorf("academy rail: status %d: %s", resp.StatusCode, string(snippet))
	}
	var out railCreateResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Ref == "" {
		return "", fmt.Errorf("academy rail: empty ref in response")
	}
	return out.Ref, nil
}

// ── Per-interface adapters (signatures match the gateway interfaces EXACTLY) ───

// httpBNPLRail satisfies commerce.BNPLRail and edupay.BNPLRail.
type httpBNPLRail struct{ h *railHTTP }

// StartPlan satisfies commerce.BNPLRail / edupay.BNPLRail.
func (a httpBNPLRail) StartPlan(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{UserID: userID, Reference: reference, AmountMinor: amountMinor})
}

// httpDisburseRail satisfies edupay.DisburseRail.
type httpDisburseRail struct{ h *railHTTP }

// Disburse satisfies edupay.DisburseRail.
func (a httpDisburseRail) Disburse(ctx context.Context, schoolAccountRef, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{AccountRef: schoolAccountRef, Reference: reference, AmountMinor: amountMinor})
}

// httpBillingRail satisfies schools.BillingRail.
type httpBillingRail struct{ h *railHTTP }

// Charge satisfies schools.BillingRail.
func (a httpBillingRail) Charge(ctx context.Context, institutionRef, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{InstitutionRef: institutionRef, Reference: reference, AmountMinor: amountMinor})
}

// httpPayoutRail satisfies tutor.PayoutRail.
type httpPayoutRail struct{ h *railHTTP }

// Payout satisfies tutor.PayoutRail.
func (a httpPayoutRail) Payout(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{UserID: userID, Reference: reference, AmountMinor: amountMinor})
}

// ── Selector ───────────────────────────────────────────────────────────────────

// academyRails returns the HTTP-backed rail adapters selected by RAILS_MODE. For
// each rail an adapter is returned ONLY when the mode is active (not "off"/"") AND
// that rail's base URL is configured; otherwise the corresponding return is nil so
// the domain package falls back to its in-process dev stub.
//
// The same selector serves fake | sandbox | live — only the per-rail base URL +
// API key (+ webhook secret, used by the verifier) differ between modes.
func academyRails(cfg config.Config) (
	bnpl commerce.BNPLRail,
	disburse edupay.DisburseRail,
	billing schools.BillingRail,
	payout tutor.PayoutRail,
) {
	mode := strings.ToLower(strings.TrimSpace(cfg.RailsMode))
	if mode == "" || mode == "off" {
		return nil, nil, nil, nil
	}
	if cfg.BNPLBaseURL != "" {
		bnpl = httpBNPLRail{h: newRailHTTP(cfg.BNPLBaseURL, cfg.BNPLAPIKey, "/bnpl/plans")}
	}
	if cfg.DisburseBaseURL != "" {
		disburse = httpDisburseRail{h: newRailHTTP(cfg.DisburseBaseURL, cfg.DisburseAPIKey, "/disburse")}
	}
	if cfg.BillingBaseURL != "" {
		billing = httpBillingRail{h: newRailHTTP(cfg.BillingBaseURL, cfg.BillingAPIKey, "/billing/charges")}
	}
	if cfg.PayoutBaseURL != "" {
		payout = httpPayoutRail{h: newRailHTTP(cfg.PayoutBaseURL, cfg.PayoutAPIKey, "/payout/transfers")}
	}
	return bnpl, disburse, billing, payout
}

// Compile-time assertions: HTTP adapters satisfy the EXISTING gateway interfaces.
var (
	_ commerce.BNPLRail   = httpBNPLRail{}
	_ edupay.BNPLRail     = httpBNPLRail{}
	_ edupay.DisburseRail = httpDisburseRail{}
	_ schools.BillingRail = httpBillingRail{}
	_ tutor.PayoutRail    = httpPayoutRail{}
)
