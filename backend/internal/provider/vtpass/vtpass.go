// Package vtpass implements provider.BillsProvider (ports.go) against the
// VTpass utility-bills API (airtime, data, electricity, cable TV, education
// pins). It is a bit-for-bit port of the Next.js adapter this replaces —
// frontend-web/src/server/utility/adapters/vtpass.ts — not a rewrite: every
// non-obvious rule below (naira conversion, request-id scheme, per-category
// payload shape, sandbox meter simulation) exists because the TS source had it,
// and diverging from it would silently change behaviour for a live money path.
// Divergences that WERE deliberate are called out explicitly where they occur.
//
// ════════════════════════════════════════════════════════════════════════════
// THE Params CONTRACT (the seam with the domain layer, backend/internal/utilitybills)
// ════════════════════════════════════════════════════════════════════════════
//
// provider.BillRequest (ports.go) carries only Ref, Type, AmountKobo and a flat
// Params map[string]string — there is no dedicated field for a biller/service
// code, a customer reference (meter/phone/smartcard number), a provider product
// code, or category-specific extras. This adapter reads those out of Params
// using the SAME key names the TS request object used, so a caller translating
// from the domain model can do it almost mechanically:
//
//	Params["billerCode"]           the internal biller code (TS: request.billerCode)
//	Params["providerBillerCode"]   the VTpass serviceID, preferred over billerCode
//	                                when both are set (TS: request.providerBillerCode)
//	Params["customerReference"]    meter number / phone / smartcard number being paid
//	Params["providerProductCode"]  VTpass variation_code (data bundle / cable package)
//	Params["phone"]                explicit phone override
//	Params["customerPhone"]        \_ alternate metadata keys the TS source also
//	Params["customer_phone"]       /  accepted for the phone override
//	Params["type"]                 \
//	Params["payment_type"]          } electricity meter type ("prepaid"/"postpaid")
//	Params["paymentType"]          /
//	Params["subscription_type"]    \ cable_tv subscription type ("change"/"renew"/…)
//	Params["subscriptionType"]     /
//	Params["quantity"]             education pin count / cable_tv quantity (default "1")
//	Params["idempotencyKey"]       explicit request-id seed; falls back to BillRequest.Ref
//
// req.Type selects the category ("airtime" | "education" | "electricity" | any
// other value, which is treated as the TS source's generic/default branch —
// "cable_tv" additionally gets subscription_type + quantity within that branch).
//
// ════════════════════════════════════════════════════════════════════════════
// provider.Bill carries the token directly (ports.go Token/Message/Raw fields)
// ════════════════════════════════════════════════════════════════════════════
//
// For a prepaid electricity purchase the token IS the deliverable — it's what
// the member types into their meter. ports.go's Bill struct carries it
// (Token/Message/Raw, added alongside this adapter specifically so it doesn't
// get silently dropped), so PurchaseBill/GetBill populate it directly — no
// separate "Detailed" result type is needed.
package vtpass

import (
	"bytes"
	"context"
	crand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"spotlight/backend/internal/provider"
)

// Environment selects which VTpass host this client talks to, and — in
// EnvironmentSandbox — switches purchase/requery to the LOCAL meter-number
// simulation table instead of calling VTpass's actual sandbox endpoint (see
// sandbox.go's TS equivalent comment: VTpass's real sandbox is flaky/slow, so
// the TS adapter simulates the documented EKEDC test-meter outcomes locally).
type Environment string

const (
	EnvironmentLive    Environment = "live"
	EnvironmentSandbox Environment = "sandbox"
)

const (
	baseURLLive    = "https://vtpass.com/api"
	baseURLSandbox = "https://sandbox.vtpass.com/api"
)

// Bill status values, matching provider.Bill's documented enum
// ("PENDING | SUCCESS | FAILED" — ports.go, uppercase; the TS source's own
// vocabulary is lowercase 'successful'/'pending'/'failed').
const (
	StatusPending = "PENDING"
	StatusSuccess = "SUCCESS"
	StatusFailed  = "FAILED"
)

// Sentinel errors for missing credentials, mirroring the TS adapter's
// readCredentials()/authHeaders() throws.
var (
	ErrMissingAPIKey    = errors.New("vtpass: VTPASS_API_KEY is required")
	ErrMissingPublicKey = errors.New("vtpass: VTPASS_PUBLIC_KEY is required for GET requests")
	ErrMissingSecretKey = errors.New("vtpass: VTPASS_SECRET_KEY is required for POST requests")
)

// Client implements provider.BillsProvider. Keys and environment come from
// config/env via New() — this file never reads os.Getenv directly, matching
// this repo's provider-adapter convention (see paystack.Client, mycover.Client).
type Client struct {
	apiKey      string
	publicKey   string
	secretKey   string
	environment Environment
	baseURL     string
	httpClient  *http.Client
}

// New constructs a VTpass adapter.
//
//   - environment selects sandbox vs live. Anything other than
//     EnvironmentSandbox is treated as live — this matches the TS source's own
//     default: `process.env.VTPASS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'live'`,
//     i.e. live is the default, not sandbox.
//   - baseURL may be empty, in which case it defaults by environment
//     (https://sandbox.vtpass.com/api or https://vtpass.com/api). Pass a
//     non-empty value to override (TS: VTPASS_BASE_URL) or to point at a test
//     server (httptest.Server.URL) in unit tests.
func New(apiKey, publicKey, secretKey string, environment Environment, baseURL string) *Client {
	if environment != EnvironmentSandbox {
		environment = EnvironmentLive
	}
	if baseURL == "" {
		if environment == EnvironmentSandbox {
			baseURL = baseURLSandbox
		} else {
			baseURL = baseURLLive
		}
	}
	return &Client{
		apiKey:      apiKey,
		publicKey:   publicKey,
		secretKey:   secretKey,
		environment: environment,
		baseURL:     strings.TrimRight(baseURL, "/"),
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}
}

// Name implements provider.BillsProvider.
func (c *Client) Name() string { return "vtpass" }

// BaseURL exposes the configured host, mirroring mycover.Client.BaseURL() —
// used by admin provider-health reporting. Never reveals a key.
func (c *Client) BaseURL() string { return c.baseURL }

// Environment reports which environment this client was constructed for.
func (c *Client) Environment() Environment { return c.environment }

// Configured reports whether an API key is present. Mirrors
// mycover.Client.Configured(); never reveals the key itself.
func (c *Client) Configured() bool { return c.apiKey != "" }

// ════════════════════════════════════════════════════════════════════════════
// Money boundary — kobo (Paymax) → whole naira (VTpass)
// ════════════════════════════════════════════════════════════════════════════

// asNaira converts integer kobo to the whole-naira amount VTpass's API expects
// — the ONE place in this codebase's money path where kobo is not the wire
// unit. The TS source computes this as `Math.max(1, Math.round(kobo / 100))`
// using a float64 (JS number) intermediate.
//
// This port replicates the exact same rounding behaviour — round-half-up, since
// kobo is always non-negative in this context, which is what JS Math.round does
// for non-negative inputs — using ONLY integer arithmetic, per this repo's iron
// rule that money math never uses floats:
//
//	naira = (kobo + 50) / 100   (integer division)
//
// is bit-identical to round(kobo/100) with ties rounding up for every
// non-negative kobo. The result is then floored at 1 so a purchase amount can
// never round down to a free (0-naira) VTpass request.
func asNaira(kobo int64) int64 {
	if kobo < 0 {
		kobo = 0
	}
	naira := (kobo + 50) / 100
	if naira < 1 {
		return 1
	}
	return naira
}

// ════════════════════════════════════════════════════════════════════════════
// Request-id scheme
// ════════════════════════════════════════════════════════════════════════════

var (
	lagosLoc     *time.Location
	lagosLocOnce sync.Once
)

// lagosLocation loads Africa/Lagos via the tzdata database (never a hand-rolled
// UTC+1 offset), cached after the first call. Lagos has no DST, so a fixed
// zone as a LAST-RESORT fallback (only if the runtime has no tzdata available
// at all — e.g. a minimal container image missing the zoneinfo package) is
// behaviourally identical to the real location; it exists purely so a missing
// tzdata package fails soft instead of panicking on every request-id call.
func lagosLocation() *time.Location {
	lagosLocOnce.Do(func() {
		loc, err := time.LoadLocation("Africa/Lagos")
		if err != nil {
			loc = time.FixedZone("Africa/Lagos", 60*60)
		}
		lagosLoc = loc
	})
	return lagosLoc
}

// lagosRequestPrefix formats date in Africa/Lagos as YYYYMMDDHHmm, matching the
// TS source's Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', ... }).
func lagosRequestPrefix(date time.Time) string {
	return date.In(lagosLocation()).Format("200601021504")
}

// alnumOnly strips everything but ASCII letters and digits, matching the TS
// source's `idempotencyKey.replace(/[^a-zA-Z0-9]/g, ”)`.
func alnumOnly(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

const randomBase36Alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

// randomBase36 generates a random base36 string of length n, used only as the
// TS source's `Math.random().toString(36).slice(2)` fallback for when the
// idempotency key has no alphanumeric characters at all — reproducing a JS
// PRNG's exact output is neither possible nor meaningful, so this uses
// crypto/rand (stronger, and appropriate on a money-path package) rather than
// math/rand to fill the equivalent role.
func randomBase36(n int) string {
	buf := make([]byte, n)
	if _, err := crand.Read(buf); err != nil {
		// crypto/rand failing at all is effectively unheard-of on a real host;
		// this only guards against never returning an empty request-id suffix.
		now := time.Now().UnixNano()
		for i := range buf {
			buf[i] = byte(now >> (uint(i) % 56))
		}
	}
	out := make([]byte, n)
	for i, v := range buf {
		out[i] = randomBase36Alphabet[int(v)%len(randomBase36Alphabet)]
	}
	return string(out)
}

// vtpassRequestID builds VTpass's required request_id: an Africa/Lagos
// YYYYMMDDHHmm prefix plus the idempotency key stripped of non-alphanumeric
// characters and truncated to its LAST 20 characters (or a random base36
// string if that strip leaves nothing), matching the TS source's
// vtpassRequestId(idempotencyKey, date) exactly.
func vtpassRequestID(idempotencyKey string, date time.Time) string {
	suffix := alnumOnly(idempotencyKey)
	if len(suffix) > 20 {
		suffix = suffix[len(suffix)-20:]
	}
	if suffix == "" {
		suffix = randomBase36(13)
	}
	return lagosRequestPrefix(date) + suffix
}

// ════════════════════════════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════════════════════════════

// authHeaders builds VTpass's auth headers: api-key always; public-key for GET;
// secret-key for POST. Matches the TS source's authHeaders(method, credentials).
func (c *Client) authHeaders(method string) (http.Header, error) {
	if c.apiKey == "" {
		return nil, ErrMissingAPIKey
	}
	h := http.Header{}
	h.Set("Content-Type", "application/json")
	h.Set("api-key", c.apiKey)
	if method == http.MethodGet {
		if c.publicKey == "" {
			return nil, ErrMissingPublicKey
		}
		h.Set("public-key", c.publicKey)
	} else {
		if c.secretKey == "" {
			return nil, ErrMissingSecretKey
		}
		h.Set("secret-key", c.secretKey)
	}
	return h, nil
}

// ════════════════════════════════════════════════════════════════════════════
// Wire types
// ════════════════════════════════════════════════════════════════════════════

// vtpassResponse mirrors the TS source's VtpassResponse interface. code is
// decoded as json.RawMessage because VTpass sends it as either a quoted string
// ("000") or a bare number depending on endpoint — see codeString.
type vtpassResponse struct {
	Code                json.RawMessage `json:"code"`
	ResponseDescription string          `json:"response_description"`
	RequestID           string          `json:"requestId"`
	PurchasedCode       string          `json:"purchased_code"`
	Token               string          `json:"token"`
	Content             *vtpassContent  `json:"content"`
}

type vtpassContent struct {
	CustomerName     string              `json:"Customer_Name"`
	CustomerNumber   string              `json:"Customer_Number"`
	CustomerType     string              `json:"Customer_Type"`
	Address          string              `json:"Address"`
	MeterNumber      string              `json:"Meter_Number"`
	MeterType        string              `json:"Meter_Type"`
	Status           string              `json:"Status"`
	DueDate          string              `json:"Due_Date"`
	WrongBillersCode bool                `json:"WrongBillersCode"`
	Transactions     *vtpassTransactions `json:"transactions"`
}

type vtpassTransactions struct {
	Status        string `json:"status"`
	TransactionID string `json:"transactionId"`
	ProductName   string `json:"product_name"`
	UniqueElement string `json:"unique_element"`
}

// codeString renders vtpassResponse.Code (a quoted string or a bare number on
// the wire) as a plain string, without ever going through float64.
func codeString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err == nil {
		return n.String()
	}
	return strings.Trim(string(raw), `"`)
}

// ════════════════════════════════════════════════════════════════════════════
// Response normalization
// ════════════════════════════════════════════════════════════════════════════

// normalizeProviderStatus maps a VTpass response onto provider.Bill's Status
// enum, replicating the TS source's normalizeProviderStatus (which returns
// lowercase 'successful'/'pending'/'failed' — this returns the equivalent
// uppercase Go constants).
func normalizeProviderStatus(payload vtpassResponse) string {
	code := strings.ToLower(codeString(payload.Code))
	description := strings.ToLower(payload.ResponseDescription)
	var transactionStatus string
	if payload.Content != nil && payload.Content.Transactions != nil {
		transactionStatus = strings.ToLower(payload.Content.Transactions.Status)
	}

	if code == "000" && (transactionStatus == "delivered" || transactionStatus == "successful" || transactionStatus == "success") {
		return StatusSuccess
	}
	if code == "000" && transactionStatus == "" && strings.Contains(description, "successful") {
		return StatusSuccess
	}
	if strings.Contains(transactionStatus, "pending") ||
		strings.Contains(transactionStatus, "processing") ||
		strings.Contains(description, "pending") ||
		strings.Contains(description, "processing") ||
		strings.Contains(description, "timeout") {
		return StatusPending
	}
	return StatusFailed
}

// tokenFrom extracts the vended token/purchased-code, matching the TS source's
// tokenFrom: `payload.token || payload.purchased_code`.
func tokenFrom(payload vtpassResponse) string {
	if payload.Token != "" {
		return payload.Token
	}
	return payload.PurchasedCode
}

// normalizePurchase mirrors the TS source's normalizePurchase(payload,
// fallbackRequestId), extended to also fill in the Ref/Type/AmountKobo that
// ports.go's Bill carries but the TS UtilityPurchaseResult does not (that
// context is only available to the caller in TS; here it comes from req).
func normalizePurchase(payload vtpassResponse, req provider.BillRequest, fallbackRequestID string, raw []byte) *provider.Bill {
	status := normalizeProviderStatus(payload)

	providerRef := fallbackRequestID
	if payload.RequestID != "" {
		providerRef = payload.RequestID
	} else if payload.Content != nil && payload.Content.Transactions != nil && payload.Content.Transactions.TransactionID != "" {
		providerRef = payload.Content.Transactions.TransactionID
	}

	message := payload.ResponseDescription
	if message == "" && payload.Content != nil && payload.Content.Transactions != nil {
		message = payload.Content.Transactions.Status
	}
	if message == "" && status == StatusFailed {
		message = "VTPass transaction failed."
	}

	return &provider.Bill{
		Ref:         req.Ref,
		ProviderRef: providerRef,
		Type:        req.Type,
		Status:      status,
		AmountKobo:  req.AmountKobo,
		Token:       tokenFrom(payload),
		Message:     message,
		Raw:         raw,
	}
}

// ════════════════════════════════════════════════════════════════════════════
// Purchase payload — shape genuinely differs by category (TS: purchasePayload)
// ════════════════════════════════════════════════════════════════════════════

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// metadataString returns the first present, non-blank (trimmed) value among
// keys, matching the TS source's metadataString helper.
func metadataString(params map[string]string, keys ...string) string {
	for _, k := range keys {
		if v, ok := params[k]; ok {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

// serviceID resolves VTpass's serviceID: providerBillerCode wins over
// billerCode, matching the TS source's `request.providerBillerCode ||
// request.billerCode`.
func serviceID(req provider.BillRequest) string {
	return firstNonEmpty(req.Params["providerBillerCode"], req.Params["billerCode"])
}

// phoneFor resolves the phone VTpass is sent, matching the TS source's
// phoneFor. The TS source's category-gated ternary
// (`category === 'airtime' || category === 'data' ? customerReference :
// undefined`) is functionally dead code given its own unconditional final
// `|| request.customerReference` fallback — every category ends up at
// metadata-phone-or-customerReference regardless. Reproduced as that simplified
// but behaviourally identical form.
func phoneFor(req provider.BillRequest) string {
	if phone := metadataString(req.Params, "phone", "customerPhone", "customer_phone"); phone != "" {
		return phone
	}
	return req.Params["customerReference"]
}

// quantityFor resolves a quantity, defaulting to 1. The TS source computes
// `Number(request.metadata?.quantity || 1)`, which produces NaN on the wire for
// a non-numeric metadata.quantity string — a latent bug in the source, not a
// behaviour worth reproducing. This defaults to 1 on anything unparseable or
// non-positive instead, which is a strict improvement and only differs from the
// TS output on that malformed-input path.
func quantityFor(req provider.BillRequest) int64 {
	raw := strings.TrimSpace(req.Params["quantity"])
	if raw == "" {
		return 1
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 1
	}
	return n
}

// purchasePayload builds the /pay request body. Field shape genuinely differs
// by category — this intentionally does NOT flatten them into one generic
// shape, matching the TS source's purchasePayload.
func purchasePayload(req provider.BillRequest, requestID string) map[string]any {
	base := map[string]any{
		"request_id": requestID,
		"serviceID":  serviceID(req),
	}

	switch req.Type {
	case "airtime":
		base["amount"] = asNaira(req.AmountKobo)
		base["phone"] = phoneFor(req)
		return base

	case "education":
		base["variation_code"] = req.Params["providerProductCode"]
		base["amount"] = asNaira(req.AmountKobo)
		base["quantity"] = quantityFor(req)
		base["phone"] = phoneFor(req)
		return base

	case "electricity":
		meterType := metadataString(req.Params, "type", "payment_type", "paymentType")
		if meterType == "" {
			meterType = "prepaid"
		}
		base["billersCode"] = req.Params["customerReference"]
		base["variation_code"] = meterType
		base["amount"] = asNaira(req.AmountKobo)
		base["phone"] = phoneFor(req)
		return base

	default:
		// Generic branch (data, cable_tv, anything else the domain layer
		// dispatches here). cable_tv additionally needs subscription_type and
		// quantity, matching the TS source's `...(category === 'cable_tv' ? {...} : {})`.
		base["billersCode"] = req.Params["customerReference"]
		base["variation_code"] = req.Params["providerProductCode"]
		base["amount"] = asNaira(req.AmountKobo)
		base["phone"] = phoneFor(req)
		if req.Type == "cable_tv" {
			subscriptionType := metadataString(req.Params, "subscription_type", "subscriptionType")
			if subscriptionType == "" {
				subscriptionType = "change"
			}
			base["subscription_type"] = subscriptionType
			base["quantity"] = quantityFor(req)
		}
		return base
	}
}

// ════════════════════════════════════════════════════════════════════════════
// Sandbox meter simulation (TS: sandbox.ts / adapters/vtpass.ts L50-116)
// ════════════════════════════════════════════════════════════════════════════
//
// VTpass publishes fixed sandbox meter numbers that deterministically simulate
// outcomes (https://vtpass.com/documentation/eko-electricity-ekedc-payment-api/).
// When environment == EnvironmentSandbox this is honoured LOCALLY — no network
// round-trip to VTpass's real sandbox — so purchase works for testing without
// live credentials. This table is keyed on Params["customerReference"]
// UNCONDITIONALLY, for every category, exactly matching the TS source (which
// calls sandboxPurchase(request, requestId) before any category branch is
// consulted at all — it is not gated to electricity even though the meter
// numbers are EKEDC's).

const (
	sandboxMeterPrepaid    = "1111111111111"
	sandboxMeterPostpaid   = "1010101010101"
	sandboxMeterPending    = "201000000000"
	sandboxMeterTimeout    = "300000000000"
	sandboxMeterUnexpected = "500000000000"
	sandboxMeterNoResponse = "400000000000"

	sandboxPrepaidToken = "1178-6621-9027-6821-0244"
)

func (c *Client) sandboxPurchase(req provider.BillRequest, requestID string) *provider.Bill {
	meter := req.Params["customerReference"]
	base := provider.Bill{
		Ref:         req.Ref,
		ProviderRef: requestID,
		Type:        req.Type,
		AmountKobo:  req.AmountKobo,
	}

	switch meter {
	case sandboxMeterPrepaid:
		base.Status = StatusSuccess
		base.Token = sandboxPrepaidToken
		base.Message = "TRANSACTION SUCCESSFUL"
		base.Raw = json.RawMessage(`{"code":"000","sandbox":true,"meter_type":"PREPAID"}`)
	case sandboxMeterPostpaid:
		base.Status = StatusSuccess
		base.Message = "TRANSACTION SUCCESSFUL"
		base.Raw = json.RawMessage(`{"code":"000","sandbox":true,"meter_type":"POSTPAID"}`)
	case sandboxMeterPending, sandboxMeterTimeout:
		base.Status = StatusPending
		simulated := "pending"
		if meter == sandboxMeterTimeout {
			simulated = "timeout"
		}
		base.Message = "Transaction is processing."
		base.Raw = json.RawMessage(fmt.Sprintf(`{"sandbox":true,"simulated":%q}`, simulated))
	case sandboxMeterUnexpected, sandboxMeterNoResponse:
		base.Status = StatusFailed
		base.Message = "Provider returned an unexpected/no response."
		base.Raw = json.RawMessage(`{"sandbox":true,"simulated":"anomaly"}`)
	default:
		base.Status = StatusFailed
		base.Message = "Sandbox: meter not recognised (use 1111111111111 / 1010101010101)."
		base.Raw = json.RawMessage(`{"sandbox":true,"simulated":"failed"}`)
	}
	return &base
}

// ════════════════════════════════════════════════════════════════════════════
// provider.BillsProvider
// ════════════════════════════════════════════════════════════════════════════

// PurchaseBill implements provider.BillsProvider. It calls VTpass's POST /pay
// (or, in sandbox, simulates it locally per the meter table above) and returns
// the full result including the vended token (ports.go's Bill.Token). Matches
// the TS source's vtpassUtilityAdapter.purchase.
func (c *Client) PurchaseBill(ctx context.Context, req provider.BillRequest) (*provider.Bill, error) {
	idemKey := req.Params["idempotencyKey"]
	if idemKey == "" {
		idemKey = req.Ref
	}
	requestID := vtpassRequestID(idemKey, time.Now())

	if c.environment == EnvironmentSandbox {
		return c.sandboxPurchase(req, requestID), nil
	}

	payload, raw, err := c.post(ctx, "/pay", purchasePayload(req, requestID))
	if err != nil {
		return nil, err
	}
	return normalizePurchase(payload, req, requestID, raw), nil
}

// GetBill implements provider.BillsProvider for orphan reconciliation, calling
// VTpass's POST /requery (secret-key auth).
//
// Per ports.go's BillsProvider doc comment, ref MUST be the VTpass request_id
// previously returned as Bill.ProviderRef by a prior PurchaseBill call — NOT
// the caller's own BillRequest.Ref. This isn't a stylistic choice: the TS
// source this was ported from (queryTransactionStatus) only ever regenerates a
// request_id from an idempotency key when no provider reference is already
// known, because that regeneration is time-of-day dependent (see
// vtpassRequestID) and only reproduces the same id within the same
// Africa/Lagos calendar MINUTE as the original purchase — never true for
// orphan reconciliation, which by definition runs later. VTpass has no
// "look up by an arbitrary client reference" capability at all; the stored
// ProviderRef is the only identifier it will ever recognize.
func (c *Client) GetBill(ctx context.Context, ref string) (*provider.Bill, error) {
	if ref == "" {
		return nil, fmt.Errorf("vtpass: GetBill requires a non-empty provider reference")
	}
	if c.environment == EnvironmentSandbox {
		// The TS source's sandbox requery is a stub that always answers
		// successful — it never simulates pending/failed for a requery, only for
		// the initial purchase. Ported verbatim, including that asymmetry.
		return &provider.Bill{
			ProviderRef: ref,
			Status:      StatusSuccess,
			Message:     "TRANSACTION SUCCESSFUL",
			Raw:         json.RawMessage(`{"sandbox":true}`),
		}, nil
	}
	payload, raw, err := c.post(ctx, "/requery", map[string]any{"request_id": ref})
	if err != nil {
		return nil, err
	}
	return normalizePurchase(payload, provider.BillRequest{}, ref, raw), nil
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP
// ════════════════════════════════════════════════════════════════════════════

func (c *Client) post(ctx context.Context, path string, body map[string]any) (vtpassResponse, []byte, error) {
	return c.do(ctx, http.MethodPost, path, body)
}

// do executes one VTpass request. It mirrors the TS source's vtpassFetch:
//   - a body that fails to decode as JSON is treated as an empty object rather
//     than a transport error (TS: `.json().catch(() => ({}))`);
//   - a non-2xx status ALWAYS yields a synthetic envelope
//     {code: status, response_description: "VTPass HTTP <status>"}, regardless
//     of whether the body decoded — never a returned/thrown Go error, matching
//     the TS source never throwing on a non-ok HTTP response.
//
// A genuine transport failure (DNS, connection refused, context cancelled) is
// still returned as a Go error — the TS source's `await fetch(...)` itself
// would reject in that case too.
func (c *Client) do(ctx context.Context, method, path string, body map[string]any) (vtpassResponse, []byte, error) {
	headers, err := c.authHeaders(method)
	if err != nil {
		return vtpassResponse{}, nil, err
	}

	var reader io.Reader
	if method == http.MethodPost {
		b, merr := json.Marshal(body)
		if merr != nil {
			return vtpassResponse{}, nil, fmt.Errorf("vtpass: marshal request: %w", merr)
		}
		reader = bytes.NewReader(b)
	}

	url := c.baseURL + "/" + strings.TrimPrefix(path, "/")
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return vtpassResponse{}, nil, err
	}
	req.Header = headers

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return vtpassResponse{}, nil, fmt.Errorf("vtpass: http request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return vtpassResponse{}, nil, fmt.Errorf("vtpass: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		synthetic := vtpassResponse{
			Code:                json.RawMessage(strconv.Itoa(resp.StatusCode)),
			ResponseDescription: fmt.Sprintf("VTPass HTTP %d", resp.StatusCode),
		}
		return synthetic, raw, nil
	}

	var decoded vtpassResponse
	_ = json.Unmarshal(raw, &decoded) // best-effort; zero value on failure, like TS's `{}`
	return decoded, raw, nil
}
