package crypto

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"math/big"
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

// MockPriceProvider returns fixed/seeded deterministic prices. Known symbols use
// hard-coded reference prices; any other symbol is seeded deterministically from
// its name so tests and local runs are reproducible without a network call.
type MockPriceProvider struct {
	prices map[string]int64 // symbol -> NGN kobo per whole unit
}

// NewMockPriceProvider builds the default deterministic provider.
func NewMockPriceProvider() *MockPriceProvider {
	return &MockPriceProvider{
		prices: map[string]int64{
			// NGN kobo per 1 whole unit (illustrative, deterministic seeds).
			"BTC":  9000000000000, // ₦90,000,000.00
			"ETH":  450000000000,  // ₦4,500,000.00
			"USDT": 160000,        // ₦1,600.00
			"SOL":  25000000,      // ₦250,000.00
		},
	}
}

func (m *MockPriceProvider) Name() string { return "mock" }

func (m *MockPriceProvider) PriceKobo(_ context.Context, symbol string) (int64, bool) {
	if symbol == "" {
		return 0, false
	}
	if p, ok := m.prices[symbol]; ok {
		return p, true
	}
	// Deterministic seed for unknown symbols: stable across runs, no network.
	h := fnv.New32a()
	_, _ = h.Write([]byte(symbol))
	// Map the hash into a ₦100 – ₦1,000,000 band (kobo), step 100 kobo.
	band := int64(h.Sum32()%9_999_900) + 10_000 // 10,000..10,009,899 kobo
	return band * 100, true
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

// deriveDepositAddress deterministically generates a persisted deposit address for
// a (user, asset, network) triple. This is the deposit-side of the same provider
// seam: a real custody adapter would allocate a real address here. Deterministic so
// the same user/asset always yields the same address before persistence.
func deriveDepositAddress(userID, symbol, network string) (string, string) {
	var address string
	var memo string

	sum := sha256.Sum256([]byte(userID + "|" + symbol + "|" + network))
	h := hex.EncodeToString(sum[:])
	switch network {
	case "bitcoin", "btc":
		address = "bc1q" + h[:30]
	case "tron", "trc20":
		address = "T" + h[:33]
		memo = fmt.Sprintf("%06d", int(sum[0])<<8|int(sum[1])%900000+100000)
	default:
		address = "0x" + h[:40]
	}
	return address, memo
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
