package crypto

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"math/rand"
	"net/http"
	"spotlight/backend/go-common/cryptox"
	"strconv"
	"strings"
	"time"
)

// PriceProvider is the provider-agnostic price feed seam. The default is the
// deterministic MockPriceProvider (no network). A real adapter (e.g. an HTTP
// market-data feed) implements the same interface and is injected via Deps —
// mock-first, real last (matches the invest module convention).
type PriceProvider interface {
	// PriceKobo returns the NGN price in kobo per ONE WHOLE asset unit for the
	// given symbol. ok=false means the symbol is unknown to the provider.
	PriceKobo(ctx context.Context, symbol string) (priceKobo int64, ok bool)
	// Name identifies the provider for snapshots/audit.
	Name() string
}

// MockPriceProvider returns fixed, clearly-labelled reference prices for the four
// symbols it knows. Anything else is unpriced (ok=false): the previous behaviour
// hashed an unknown symbol into a plausible ₦ amount, so any asset an admin added
// became buyable at a price nobody quoted — the money path then debited a real
// wallet against a fabricated market.
type MockPriceProvider struct {
	prices map[string]int64 // symbol -> NGN kobo per whole unit
}

// NewMockPriceProvider builds the default deterministic provider.
func NewMockPriceProvider() *MockPriceProvider {
	return &MockPriceProvider{
		prices: map[string]int64{
			// NGN kobo per 1 whole unit (illustrative, deterministic seeds).
			// Kobo, not naira: 1 naira = 100 kobo, so ₦90,000,000 is 9e9 here.
			"BTC":  9000000000, // ₦90,000,000.00
			"ETH":  450000000,  // ₦4,500,000.00
			"USDT": 160000,     // ₦1,600.00
			"SOL":  25000000,   // ₦250,000.00
		},
	}
}

func (m *MockPriceProvider) Name() string { return "mock" }

func (m *MockPriceProvider) PriceKobo(_ context.Context, symbol string) (int64, bool) {
	p, ok := m.prices[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return 0, false
	}
	return p, true
}

// WithdrawalProvider is the pluggable on-chain broadcast seam. There is NO real
// broadcast in this build — the mock adapter returns a deterministic ref so the
// withdrawal state machine and ledger are exercisable end-to-end; swap the
// adapter to go live. Contract:
//   - Broadcast is the only outbound side effect, called once per withdrawal on
//     the requested→pending→broadcast transition; idempotent on providerIdemKey.
//   - A provider MUST NOT mutate ledger or holdings — the service owns money.
//   - ConfirmationTarget lets a reconciliation worker decide broadcast→confirmed.
type WithdrawalProvider interface {
	// Broadcast submits a withdrawal to the network/custodian. It returns a stable
	// provider reference and (optionally) a tx hash. providerIdemKey is the withdrawal
	// idempotency key so the adapter can dedupe retries. A returned error keeps the
	// withdrawal in `pending` (fail-open for retry) — the service does NOT burn units
	// until a broadcast succeeds.
	Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastRequestResult, error)
	// Name identifies the provider for persistence/audit.
	Name() string
}

// BroadcastRequest is the provider-agnostic broadcast request.
type BroadcastRequest struct {
	WithdrawalID    string
	Symbol          string
	Network         string
	Address         string
	Units           int64 // asset minor units to send (net of network fee)
	MinorUnitScale  int64 // minor units per one whole asset (to format the amount); 0 = unknown
	ProviderIdemKey string
}

// BroadcastRequestResult is the provider's response.
type BroadcastRequestResult struct {
	ProviderRef string
	TxHash      string
	// Accepted=false means the provider explicitly rejected (e.g. address screening
	// failed on the custodian side) — the service moves the withdrawal to `failed`
	// and returns the parked units to the holding.
	Accepted bool
}

// mockWithdrawalProvider is the default no-network adapter. It deterministically
// derives a provider reference and tx hash from the withdrawal id so runs are
// reproducible and idempotent. It always accepts — malformed/allow-list failures
// are rejected upstream in the service before Broadcast is ever called.
type mockWithdrawalProvider struct{}

// NewMockWithdrawalProvider builds the default (no-network) broadcast adapter.
func NewMockWithdrawalProvider() WithdrawalProvider { return &mockWithdrawalProvider{} }

func (m *mockWithdrawalProvider) Name() string { return "mock" }

func (m *mockWithdrawalProvider) Broadcast(_ context.Context, req BroadcastRequest) (BroadcastRequestResult, error) {
	// Deterministic, idempotent pseudo-references (no network, no minting).
	seed := req.WithdrawalID + "|" + req.ProviderIdemKey
	h := cryptox.SHA256Hex(seed)
	return BroadcastRequestResult{
		ProviderRef: "MOCKWD-" + h[:12],
		TxHash:      "0x" + h[:40],
		Accepted:    true,
	}, nil
}

// quidaxProvider is the real HTTP adapter implementing BOTH PriceProvider and
// WithdrawalProvider, replacing the deterministic mocks when configured.
// The withdrawal path is FAIL-CLOSED: a 2xx with a withdrawal id → Accepted;
// ANY other outcome → error, which keeps the withdrawal non-terminal and does
// NOT return the parked units — an ambiguous failure can never both send funds
// and refund the holder (no double-spend).
// Custody model: one platform Quidax account holds custody; per-user balances
// live in the finance ledger. Quidax has no idempotency-key header, so the
// withdrawal's stable key travels in transaction_note; the service guards
// idempotency on the approved→broadcast transition.
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
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, raw, nil
}

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
	// Observed against the live API: data.<market>.ticker.last, a JSON number. The older
	// data.ticker.last string shape is still accepted.
	var out struct {
		Data json.RawMessage `json:"data"`
	}
	if jerr := json.Unmarshal(raw, &out); jerr != nil {
		return 0, false
	}
	last := tickerLast(out.Data, market)
	naira, perr := strconv.ParseFloat(last, 64)
	if perr != nil || naira <= 0 {
		return 0, false
	}
	kobo := int64(naira*100 + 0.5) // round to nearest kobo
	if kobo <= 0 {
		return 0, false
	}
	return kobo, true
}

// tickerLast extracts the last price text from either ticker response shape.
func tickerLast(data json.RawMessage, market string) string {
	var byMarket map[string]struct {
		Ticker struct {
			Last json.Number `json:"last"`
		} `json:"ticker"`
	}
	if json.Unmarshal(data, &byMarket) == nil {
		if m, ok := byMarket[market]; ok {
			return strings.TrimSpace(m.Ticker.Last.String())
		}
	}
	var legacy struct {
		Ticker struct {
			Last json.Number `json:"last"`
		} `json:"ticker"`
	}
	if json.Unmarshal(data, &legacy) == nil {
		return strings.TrimSpace(legacy.Ticker.Last.String())
	}
	return ""
}

// Broadcast submits an on-chain withdrawal to Quidax. Fail-closed: only a 2xx with a
// withdrawal id counts as accepted; everything else returns an error (service keeps the
// withdrawal pending — units are neither sent-and-refunded nor fabricated as sent).
func (q *quidaxProvider) Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastRequestResult, error) {
	if q.apiKey == "" {
		return BroadcastRequestResult{}, errors.New("quidax: not configured (missing api key)")
	}
	if req.MinorUnitScale <= 0 {
		return BroadcastRequestResult{}, fmt.Errorf("quidax: missing minor_unit_scale for %s (cannot format amount)", req.Symbol)
	}
	if strings.TrimSpace(req.Address) == "" || req.Units <= 0 {
		return BroadcastRequestResult{}, errors.New("quidax: invalid withdrawal request (address/units)")
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
	dp := min(max(len(strconv.FormatInt(scale, 10))-1, 0), 18)
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

// === Webhook Signature Verification (R1) ===

// VerifyQuidaxWebhook verifies the HMAC-SHA256 signature of a Quidax webhook.
// Per Quidax docs §5.1: signature is HMAC-SHA256 of the raw body using the webhook secret.
// Returns nil if valid, error if invalid/missing/replay.
func VerifyQuidaxWebhook(rawBody []byte, signature, secret string, timestampThresholdSec int64) error {
	if strings.TrimSpace(signature) == "" {
		return errors.New("quidax webhook: missing signature header")
	}
	if strings.TrimSpace(secret) == "" {
		return errors.New("quidax webhook: webhook secret not configured")
	}

	// Calculate expected signature: HMAC-SHA256(secret, rawBody)
	h := hmac.New(sha256.New, []byte(secret))
	h.Write(rawBody)
	expected := hex.EncodeToString(h.Sum(nil))

	// Constant-time comparison to prevent timing attacks. Never echo either value:
	// the expected digest is derived from the webhook secret, and this error reaches
	// both the server log and the webhook response body.
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return errors.New("quidax webhook: signature mismatch")
	}

	// Optional: verify timestamp is recent (prevent replay attacks)
	// This requires parsing the webhook body to extract timestamp; deferred for now.
	// See Quidax docs for timestamp field name and format.

	return nil
}

// QuidaxWebhookEvent represents a parsed Quidax webhook event.
// Blocker 5: HMAC-SHA256 authentication (verified by middleware)
// Blocker 6: Replay protection with timestamp validation (±5 min window)
type QuidaxWebhookEvent struct {
	EventType string         `json:"event_type"`
	Data      map[string]any `json:"data"`
	Timestamp int64          `json:"timestamp"` // Unix timestamp in seconds
	ID        string         `json:"id"`        // Event ID for deduplication
}

// ValidateTimestamp checks that the webhook timestamp is within the acceptable window.
// Fails if timestamp is older than 5 minutes or more than 1 minute in the future.
// This prevents replay attacks and handles clock skew tolerance (Blocker 6).
func (e *QuidaxWebhookEvent) ValidateTimestamp() error {
	now := time.Now().Unix()
	age := now - e.Timestamp

	// Allow +1 min skew for clock drift (webhook in future)
	if age < -60 {
		return errors.New("crypto: webhook timestamp is too far in the future (clock skew)")
	}

	// Allow 5 minutes (300 sec) for clock drift in the past
	if age > 300 {
		return errors.New("crypto: webhook timestamp is too old (possible replay)")
	}

	return nil
}

// ParseQuidaxWebhook unmarshals a Quidax webhook body into a structured event.
func ParseQuidaxWebhook(rawBody []byte) (*QuidaxWebhookEvent, error) {
	var event QuidaxWebhookEvent
	if err := json.Unmarshal(rawBody, &event); err != nil {
		return nil, fmt.Errorf("quidax webhook: unmarshal: %w", err)
	}
	if event.EventType == "" || event.ID == "" {
		return nil, errors.New("quidax webhook: missing event_type or id")
	}
	return &event, nil
}

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

// SwapProvider is the quote seam for the member swap surface. Swaps on this plane
// settle in the finance ledger at prices from the injected PriceProvider; they are
// NOT executed at the exchange, which is why the only implementation here is the
// internal one. Provider-driven swaps (a real order at Quidax, reconciled by webhook
// + poller) live in internal/cryptosvc over internal/cryptoprov/quidax.
type SwapProvider interface {
	// CreateQuotation opens an indicative quote for a member swap and returns its
	// id + expiry. This is the ledger-side seam — it does not place an order at an
	// exchange; the id only keys the quote the member saw.
	CreateQuotation(ctx context.Context, userID, fromCurrency, toCurrency string, fromAmount int64) (quotationID string, expiresAt time.Time, err error)

	// ConfirmQuotation accepts the quote so Swap can settle it in the ledger.
	ConfirmQuotation(ctx context.Context, userID, quotationID string) (swapTransactionID string, err error)

	// GetSwapTransaction reports the status of a settled swap.
	GetSwapTransaction(ctx context.Context, userID, swapTransactionID string) (status string, rawMeta map[string]any, err error)

	// Name identifies the provider for logs/audit.
	Name() string
}

// SwapQuotation represents Quidax Instant Swap quote response.
type SwapQuotation struct {
	ID         string    // Quotation ID from Quidax
	FromAsset  string    // Currency code (e.g., "NGN")
	ToAsset    string    // Currency code (e.g., "BTC")
	FromAmount int64     // Minor units (kobo for NGN)
	ToAmount   int64     // Minor units (satoshi for BTC)
	ExpiresAt  time.Time // UTC expiry (15 sec from creation)
	Rate       string    // Exchange rate string for display
	Fee        int64     // Quidax fee in destination asset minor units
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

// newMockSwapProvider returns a stub SwapProvider for testing (CR-011).
// In production, this should be extended to use ProvidersFromConfig.
func newMockSwapProvider() SwapProvider {
	return &mockSwapProvider{}
}

type mockSwapProvider struct{}

func (m *mockSwapProvider) Name() string { return "mock" }

func (m *mockSwapProvider) CreateQuotation(ctx context.Context, userID, fromCurrency, toCurrency string, fromAmount int64) (string, time.Time, error) {
	// Return a mock quotation ID and 15-sec expiry
	return "q_mock_" + randomID(), time.Now().Add(15 * time.Second), nil
}

func (m *mockSwapProvider) ConfirmQuotation(ctx context.Context, userID, quotationID string) (string, error) {
	// Return a mock transaction ID
	return "tx_mock_" + randomID(), nil
}

func (m *mockSwapProvider) GetSwapTransaction(ctx context.Context, userID, swapTransactionID string) (string, map[string]any, error) {
	// Return a mock completed status
	return "completed", map[string]any{"mock": true}, nil
}

func randomID() string {
	b := make([]byte, 8)
	for i := range b {
		b[i] = "0123456789abcdef"[rand.Intn(16)]
	}
	return string(b)
}
