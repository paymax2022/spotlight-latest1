package crypto

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ─── Real crypto provider (Quidax) ──────────────────────────────────────────────
//
// quidaxProvider is the real HTTP adapter that implements BOTH the PriceProvider
// (NGN ticker feed) and the WithdrawalProvider (on-chain withdrawal broadcast) seams,
// replacing the deterministic mocks when configured. It is provider-specific to
// Quidax (https://quidax.com) but selected generically via config.
//
// SAFETY — the withdrawal path is FAIL-CLOSED:
//   - a 2xx response with a withdrawal id → Accepted, returns the provider ref/tx hash;
//   - ANY other outcome (non-2xx, malformed body, transport/timeout error) → returns a
//     Go error. Per the WithdrawalProvider contract, the service keeps the withdrawal in
//     a non-terminal (approved/pending) state on error and does NOT return the parked
//     units — so an ambiguous provider failure can never both send funds AND refund the
//     holder (no double-spend), and the adapter never fabricates a success.
//
// Custody model: a single platform Quidax account holds custody; per-user balances live
// in the finance ledger. Withdrawals are sent from the platform account ("me") to the
// user's whitelisted destination address. Quidax exposes no idempotency-key header, so
// the withdrawal's stable idem key is carried in transaction_note for provider-side
// tracing; the service already guards idempotency on the approved→broadcast transition.
type quidaxProvider struct {
	http    *http.Client
	baseURL string
	apiKey  string
	label   string // "quidax-test" | "quidax-live"
}

func newQuidaxProvider(baseURL, apiKey string, live bool) *quidaxProvider {
	label := "quidax-test"
	if live {
		label = "quidax-live"
	}
	return &quidaxProvider{
		http:    &http.Client{Timeout: 15 * time.Second},
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		apiKey:  strings.TrimSpace(apiKey),
		label:   label,
	}
}

func (q *quidaxProvider) Name() string { return q.label }

func (q *quidaxProvider) do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("quidax: marshal: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, q.baseURL+path, rdr)
	if err != nil {
		return 0, nil, fmt.Errorf("quidax: request: %w", err)
	}
	if q.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+q.apiKey)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := q.http.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("quidax: transport: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, raw, nil
}

// ── PriceProvider ───────────────────────────────────────────────────────────────

// PriceKobo fetches the last NGN price for `symbol` from Quidax's ticker for the
// `<symbol>ngn` market and returns it in kobo (naira × 100) per one whole unit.
// Read-only. ok=false on any error/unknown market so the caller degrades cleanly
// (Quote → ErrNotFound) rather than trading on a bad price.
func (q *quidaxProvider) PriceKobo(ctx context.Context, symbol string) (int64, bool) {
	if strings.TrimSpace(symbol) == "" {
		return 0, false
	}
	market := strings.ToLower(strings.TrimSpace(symbol)) + "ngn"
	code, raw, err := q.do(ctx, http.MethodGet, "/markets/tickers/"+market, nil)
	if err != nil || code < 200 || code >= 300 {
		return 0, false
	}
	var out struct {
		Data struct {
			Ticker struct {
				Last string `json:"last"`
			} `json:"ticker"`
		} `json:"data"`
	}
	if jerr := json.Unmarshal(raw, &out); jerr != nil {
		return 0, false
	}
	naira, perr := strconv.ParseFloat(strings.TrimSpace(out.Data.Ticker.Last), 64)
	if perr != nil || naira <= 0 {
		return 0, false
	}
	kobo := int64(naira*100 + 0.5) // round to nearest kobo
	if kobo <= 0 {
		return 0, false
	}
	return kobo, true
}

// ── WithdrawalProvider ──────────────────────────────────────────────────────────

// Broadcast submits an on-chain withdrawal to Quidax. Fail-closed: only a 2xx with a
// withdrawal id counts as accepted; everything else returns an error (service keeps the
// withdrawal pending — units are neither sent-and-refunded nor fabricated as sent).
func (q *quidaxProvider) Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastRequestResult, error) {
	if q.apiKey == "" {
		return BroadcastRequestResult{}, fmt.Errorf("quidax: not configured (missing api key)")
	}
	if req.MinorUnitScale <= 0 {
		return BroadcastRequestResult{}, fmt.Errorf("quidax: missing minor_unit_scale for %s (cannot format amount)", req.Symbol)
	}
	if strings.TrimSpace(req.Address) == "" || req.Units <= 0 {
		return BroadcastRequestResult{}, fmt.Errorf("quidax: invalid withdrawal request (address/units)")
	}
	amount := formatWholeUnits(req.Units, req.MinorUnitScale)
	payload := map[string]any{
		"currency":         strings.ToLower(req.Symbol),
		"amount":           amount,
		"fund_uid":         req.Address,
		"transaction_note": req.ProviderIdemKey,
		"narration":        "spotlight crypto withdrawal " + req.WithdrawalID,
	}
	code, raw, err := q.do(ctx, http.MethodPost, "/users/me/withdraws", payload)
	if err != nil {
		return BroadcastRequestResult{}, err // transport/timeout → pending (fail-closed)
	}
	if code < 200 || code >= 300 {
		// Do NOT return units on a non-2xx: it may be transient (429/5xx) or ambiguous.
		// Surface an error so the service parks the withdrawal for retry/reconciliation.
		return BroadcastRequestResult{}, fmt.Errorf("quidax: withdraw http %d: %s", code, snippet(raw))
	}
	var out struct {
		Data struct {
			ID     string `json:"id"`
			TxID   string `json:"txid"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if jerr := json.Unmarshal(raw, &out); jerr != nil || strings.TrimSpace(out.Data.ID) == "" {
		return BroadcastRequestResult{}, fmt.Errorf("quidax: withdraw response missing id: %s", snippet(raw))
	}
	return BroadcastRequestResult{
		ProviderRef: out.Data.ID,
		TxHash:      out.Data.TxID,
		Accepted:    true,
	}, nil
}

// formatWholeUnits renders `units` minor units as a decimal whole-asset string with
// exactly the provider-expected precision, using big.Int/big.Rat (no float rounding
// on money amounts). scale = minor units per one whole asset (e.g. 1e8 for BTC).
func formatWholeUnits(units, scale int64) string {
	if scale <= 0 {
		return "0"
	}
	r := new(big.Rat).SetFrac(big.NewInt(units), big.NewInt(scale))
	// Precision = number of base-10 digits in scale (e.g. 1e8 → 8 dp), capped at 18.
	dp := len(strconv.FormatInt(scale, 10)) - 1
	if dp < 0 {
		dp = 0
	}
	if dp > 18 {
		dp = 18
	}
	s := r.FloatString(dp)
	if strings.Contains(s, ".") { // trim trailing zeros but keep at least one digit
		s = strings.TrimRight(s, "0")
		s = strings.TrimRight(s, ".")
	}
	return s
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 180 {
		return s[:180]
	}
	return s
}

// ─── Config-driven provider selection ───────────────────────────────────────────

// ProviderConfig is the wiring input for ProvidersFromConfig (populated from the app
// Config in finance_routes). Provider selects mock|quidax; Live picks the credential set.
type ProviderConfig struct {
	Provider    string // "mock" (default) | "quidax"
	Live        bool   // true in production → LiveKey/LiveBaseURL; false → Test*
	TestKey     string
	TestBaseURL string
	LiveKey     string
	LiveBaseURL string
}

// ProvidersFromConfig returns the price + withdrawal providers plus a human-readable
// mode string for the boot log. It falls back to the deterministic mocks (safe default)
// whenever the provider is not "quidax" or the selected credentials are absent — so a
// missing credential can never silently disable price/withdrawal; it degrades to the
// mock and logs the reason.
func ProvidersFromConfig(pc ProviderConfig) (PriceProvider, WithdrawalProvider, string) {
	if !strings.EqualFold(strings.TrimSpace(pc.Provider), "quidax") {
		return NewMockPriceProvider(), NewMockWithdrawalProvider(), "mock (CRYPTO_PROVIDER not 'quidax')"
	}
	key, baseURL, env := pc.TestKey, pc.TestBaseURL, "test"
	if pc.Live {
		key, baseURL, env = pc.LiveKey, pc.LiveBaseURL, "live"
	}
	if strings.TrimSpace(key) == "" || strings.TrimSpace(baseURL) == "" {
		log.Printf("[crypto] provider=quidax %s selected but credentials/base URL missing — falling back to mock", env)
		return NewMockPriceProvider(), NewMockWithdrawalProvider(), "mock (quidax " + env + " creds missing)"
	}
	p := newQuidaxProvider(baseURL, key, pc.Live)
	return p, p, "quidax-" + env
}
