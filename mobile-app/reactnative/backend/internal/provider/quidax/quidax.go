// Package quidax is a real (HTTP) implementation of the provider-adapter seam
// (package adapter), backed by the Quidax crypto exchange REST API. It lets the
// BACKEND drive the crypto module through Quidax without the business logic ever
// importing a vendor SDK — a single *Client satisfies all three adapter contracts
// (MarketData, Liquidity, Custody), exactly like internal/httpadapter.
//
// Credentials come only from config.ProviderCreds (BaseURL/APIKey), never from
// os.Getenv or a literal. The config agent selects and wires this adapter.
//
// # Endpoints used (relative to creds.BaseURL, e.g. https://app.quidax.io/api/v1)
//
// Every request carries "Authorization: Bearer <APIKey>" and every response is
// the Quidax envelope {status, message, data}; only `data` is decoded here.
//
//	MarketData
//	  Assets()          GET /markets                       (id, base_unit, quote_unit)
//	                    GET /markets/tickers               (map market -> {ticker{last,buy,sell,open,vol}})
//	                    → one domain.Asset per fiat-quoted market (price = ticker.last)
//	  Asset(key)        scans Assets() for a matching symbol/id (Quidax has no by-symbol asset route)
//	  Chart(sym,rng)    GET /markets/{sym+ngn}/k?period=&limit=  (OHLC rows) → close price per point
//
//	Liquidity
//	  Quote(...)        GET /markets/tickers/{key+currency} → best-effort fiat buy/sell quote.
//	                    Quidax has no first-class "fiat buy/sell quote" on this base URL
//	                    (its Ramp purchase-quotes live on a different host+auth), so the
//	                    quote is derived from the live ticker: buy uses ticker.buy, sell
//	                    uses ticker.sell; crypto/fiat legs are computed with integer math.
//	  SwapQuote(...)    POST /users/me/temporary_swap_quotation {from_currency,to_currency,from_amount}
//	                    → maps Quidax quoted from/to amounts to domain.SwapQuote (no side effects).
//
//	Custody
//	  DepositAddress()  GET  /users/me/wallets/{symbol}/address   (address, destination_tag=memo)
//	  WithdrawalQuote() GET  /users/me/fee_rule?currency=&network=&amount=  (network fee)
//	  ScreenAddress()   GET  /screening/address?address=          (fails safe → flagged)
//
// Contract: the (T, bool) methods return (zero, false) on any transport, 5xx,
// non-2xx, envelope-error or decode failure so the caller degrades gracefully.
// ScreenAddress fails SAFE — any error yields a "flagged" result so an
// unreachable provider never silently clears a withdrawal address.
//
// Money is always integer minor units. Quidax returns decimal strings/numbers;
// they are converted with big.Int (never float — see decimalToMinor) so no
// rounding drift enters the money path. Percentage/display-only rates that are
// not money (Change24hPct, SwapQuote.Rate) are parsed as float64.
package quidax

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"paymax/crypto-backend/internal/adapter"
	"paymax/crypto-backend/internal/circuitbreaker"
	"paymax/crypto-backend/internal/config"
	"paymax/crypto-backend/internal/domain"
)

// Compile-time assertions: a single *Client implements every adapter contract.
var (
	_ adapter.MarketData = (*Client)(nil)
	_ adapter.Liquidity  = (*Client)(nil)
	_ adapter.Custody    = (*Client)(nil)
)

const (
	// defaultCryptoDecimals is the base-unit scale used for every crypto asset.
	// Quidax's public market/wallet/fee endpoints do not expose per-coin decimals,
	// so we normalise to 8 (Bitcoin-style). All base-unit conversions in this
	// adapter use the same scale in both directions, so the value stays internally
	// consistent even for coins whose native precision differs (e.g. USDT=6).
	defaultCryptoDecimals = 8
	// fiatMinorScale is the minor-unit scale for the fiat quote currencies Quidax
	// trades against (NGN kobo, etc.) — 2 decimal places.
	fiatMinorScale = 2
	// defaultFiatQuote is the fiat market suffix used when a bare asset symbol has
	// to be resolved to a Quidax market (e.g. "BTC" -> "btcngn").
	defaultFiatQuote = "ngn"
)

// fiatQuoteUnits is the set of Quidax quote currencies we treat as fiat when
// building the tradable-asset catalogue (each priced with fiatMinorScale).
var fiatQuoteUnits = map[string]bool{
	"ngn": true, "ghs": true, "kes": true, "zar": true,
	"xof": true, "xaf": true, "usd": true,
}

// Client is a Quidax-backed provider adapter. Safe for concurrent use.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
	cb      *circuitbreaker.Breaker
}

// New builds a Client from provider credentials (BaseURL + APIKey). The HTTP
// client uses a 10s timeout and every call passes through a circuit breaker with
// default config (trip after 5 consecutive transport/5xx failures, open 30s, one
// half-open trial) so a persistently unhealthy Quidax fails fast instead of
// stacking 10s timeouts.
func New(creds config.ProviderCreds) *Client {
	return &Client{
		baseURL: strings.TrimRight(creds.BaseURL, "/"),
		apiKey:  creds.APIKey,
		hc:      &http.Client{Timeout: 10 * time.Second},
		cb:      circuitbreaker.New(circuitbreaker.Config{}),
	}
}

// CircuitState exposes the breaker state ("closed"/"open"/"half-open").
func (c *Client) CircuitState() string { return c.cb.State() }

// ── HTTP core ────────────────────────────────────────────────────────────────

// envelope is the standard Quidax response wrapper. Only Data is decoded further.
type envelope struct {
	Status  string          `json:"status"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// getData issues a GET to {base}{path} and returns the envelope's data payload.
func (c *Client) getData(path string) (json.RawMessage, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	return c.do(req)
}

// postData marshals body as JSON, POSTs it to {base}{path} and returns the
// envelope's data payload.
func (c *Client) postData(path string, body interface{}) (json.RawMessage, error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+path, strings.NewReader(string(buf)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req)
}

// do sets Bearer auth, runs the request under the breaker, enforces a 2xx status
// + non-error envelope and returns the raw data payload. It always closes the body.
//
// Breaker accounting mirrors httpadapter: only transport errors and 5xx count as
// failures (provider-down). A 4xx means Quidax is healthy but the request was
// client-side, so it does NOT trip the breaker. When the breaker is open the call
// fails fast with circuitbreaker.ErrOpen without touching the network.
func (c *Client) do(req *http.Request) (json.RawMessage, error) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	var resp *http.Response
	cbErr := c.cb.Do(func() error {
		r, err := c.hc.Do(req)
		if err != nil {
			return err // transport failure → counts against the breaker
		}
		if r.StatusCode >= 500 {
			r.Body.Close()
			return fmt.Errorf("quidax: %s %s: status %d", req.Method, req.URL.Path, r.StatusCode)
		}
		resp = r // 2xx-4xx: provider is up, don't trip the breaker
		return nil
	})
	if cbErr != nil {
		return nil, cbErr
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("quidax: %s %s: status %d", req.Method, req.URL.Path, resp.StatusCode)
	}
	var env envelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, err
	}
	if env.Status == "error" {
		return nil, fmt.Errorf("quidax: %s %s: %s", req.Method, req.URL.Path, env.Message)
	}
	return env.Data, nil
}

// ── Money helpers (integer minor units only — never float) ───────────────────

// decimalToMinor converts a decimal string (e.g. "93694580.55" or Quidax's
// "0.0005241693633765") into an integer scaled by 10**scale, truncating any
// excess fractional digits. It uses big.Int on the raw digits so no float ever
// touches a money value. Returns false on a malformed input or int64 overflow.
func decimalToMinor(s string, scale int) (int64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	neg := false
	switch s[0] {
	case '-':
		neg, s = true, s[1:]
	case '+':
		s = s[1:]
	}
	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	if intPart == "" {
		intPart = "0"
	}
	if len(fracPart) < scale {
		fracPart += strings.Repeat("0", scale-len(fracPart))
	} else {
		fracPart = fracPart[:scale] // truncate extra precision
	}
	digits := intPart + fracPart
	n, ok := new(big.Int).SetString(digits, 10)
	if !ok {
		return 0, false
	}
	if neg {
		n.Neg(n)
	}
	if !n.IsInt64() {
		return 0, false
	}
	return n.Int64(), true
}

// minorToDecimalString renders an integer minor-unit amount back to a decimal
// string with `scale` fractional digits, for sending amounts to Quidax (which
// expects human-readable decimals). Pure big.Int, no float.
func minorToDecimalString(amount int64, scale int) string {
	neg := amount < 0
	n := big.NewInt(amount)
	if neg {
		n.Neg(n)
	}
	div := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil)
	q, r := new(big.Int), new(big.Int)
	q.DivMod(n, div, r)
	out := q.String()
	if scale > 0 {
		frac := r.String()
		if len(frac) < scale {
			frac = strings.Repeat("0", scale-len(frac)) + frac
		}
		out += "." + frac
	}
	if neg {
		out = "-" + out
	}
	return out
}

// mulDiv computes a*b/den with big.Int (truncating), for base-unit ↔ minor-unit
// price conversions. Returns 0 if den == 0.
func mulDiv(a, b, den int64) int64 {
	if den == 0 {
		return 0
	}
	res := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	res.Quo(res, big.NewInt(den))
	if !res.IsInt64() {
		return 0
	}
	return res.Int64()
}

// pow10 returns 10**n as int64 (n small; used for crypto decimals).
func pow10(n int) int64 {
	p := int64(1)
	for i := 0; i < n; i++ {
		p *= 10
	}
	return p
}

// ── MarketData ───────────────────────────────────────────────────────────────

type quidaxMarket struct {
	ID        string `json:"id"`
	BaseUnit  string `json:"base_unit"`
	QuoteUnit string `json:"quote_unit"`
}

type quidaxTicker struct {
	Buy  string `json:"buy"`
	Sell string `json:"sell"`
	Low  string `json:"low"`
	High string `json:"high"`
	Open string `json:"open"`
	Last string `json:"last"`
	Vol  string `json:"vol"`
}

// marketTicker is one entry in the /markets/tickers map response.
type marketTicker struct {
	At     int64        `json:"at"`
	Market string       `json:"market"`
	Ticker quidaxTicker `json:"ticker"`
}

// Assets builds the tradable catalogue: one domain.Asset per fiat-quoted Quidax
// market, priced from the live ticker. On any error it returns nil so the caller
// sees an empty catalogue rather than a panic.
func (c *Client) Assets() []domain.Asset {
	rawMarkets, err := c.getData("/markets")
	if err != nil {
		return nil
	}
	var markets []quidaxMarket
	if err := json.Unmarshal(rawMarkets, &markets); err != nil {
		return nil
	}
	rawTickers, err := c.getData("/markets/tickers")
	if err != nil {
		return nil
	}
	var tickers map[string]marketTicker
	if err := json.Unmarshal(rawTickers, &tickers); err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var out []domain.Asset
	for _, m := range markets {
		quote := strings.ToLower(m.QuoteUnit)
		if !fiatQuoteUnits[quote] {
			continue // only surface fiat-priced assets
		}
		base := strings.ToUpper(m.BaseUnit)
		if base == "" || seen[base] {
			continue
		}
		mt, ok := tickers[strings.ToLower(m.ID)]
		if !ok {
			continue
		}
		asset, ok := assetFromTicker(base, quote, mt.Ticker)
		if !ok {
			continue
		}
		seen[base] = true
		out = append(out, asset)
	}
	return out
}

// assetFromTicker maps a Quidax base symbol + fiat quote + ticker into a
// domain.Asset. Price is ticker.last in fiat minor units; the 24h change is a
// display-only percentage computed from open→last.
func assetFromTicker(base, quote string, t quidaxTicker) (domain.Asset, bool) {
	priceMinor, ok := decimalToMinor(t.Last, fiatMinorScale)
	if !ok {
		return domain.Asset{}, false
	}
	cur := strings.ToUpper(quote)
	a := domain.Asset{
		ID:                base,
		Type:              "crypto",
		Symbol:            base,
		Name:              base,
		Decimals:          defaultCryptoDecimals,
		RiskRating:        "unrated",
		Status:            "active",
		BuyEnabled:        true,
		SellEnabled:       true,
		DepositEnabled:    true,
		WithdrawalEnabled: true,
		Price:             domain.Money{Amount: priceMinor, Currency: cur},
		Change24hPct:      pctChange(t.Open, t.Last),
		// MarketCap / Volume24h are not exposed by these endpoints; left zero
		// (currency-tagged) rather than reported inaccurately.
		MarketCap: domain.Money{Currency: cur},
		Volume24h: domain.Money{Currency: cur},
	}
	return a, true
}

// pctChange returns (last-open)/open*100 as a display float. Percentages are not
// money, so float64 is acceptable here.
func pctChange(open, last string) float64 {
	o, err1 := strconv.ParseFloat(strings.TrimSpace(open), 64)
	l, err2 := strconv.ParseFloat(strings.TrimSpace(last), 64)
	if err1 != nil || err2 != nil || o == 0 {
		return 0
	}
	return (l - o) / o * 100
}

// Asset fetches a single asset by symbol/key. Quidax has no by-symbol asset
// route, so this scans the catalogue. Returns (zero, false) when not found.
func (c *Client) Asset(key string) (domain.Asset, bool) {
	want := strings.ToUpper(strings.TrimSpace(key))
	for _, a := range c.Assets() {
		if strings.ToUpper(a.ID) == want || strings.ToUpper(a.Symbol) == want {
			return a, true
		}
	}
	return domain.Asset{}, false
}

// Chart fetches OHLC ("k-line") history for symbol over rng and maps each row's
// close price into a domain.CandlePoint (fiat minor units). The market is
// resolved as symbol+defaultFiatQuote (e.g. "BTC" -> "btcngn").
func (c *Client) Chart(symbol, rng string) ([]domain.CandlePoint, bool) {
	period, limit := chartParams(rng)
	q := url.Values{}
	q.Set("period", strconv.Itoa(period))
	q.Set("limit", strconv.Itoa(limit))
	market := strings.ToLower(symbol) + defaultFiatQuote
	raw, err := c.getData("/markets/" + url.PathEscape(market) + "/k?" + q.Encode())
	if err != nil {
		return nil, false
	}
	// Each row is [timestamp, open, high, low, close, volume] as JSON numbers.
	var rows [][]json.Number
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, false
	}
	out := make([]domain.CandlePoint, 0, len(rows))
	for _, row := range rows {
		if len(row) < 5 {
			continue
		}
		ts, err := strconv.ParseInt(row[0].String(), 10, 64)
		if err != nil {
			continue
		}
		closeMinor, ok := decimalToMinor(row[4].String(), fiatMinorScale)
		if !ok {
			continue
		}
		out = append(out, domain.CandlePoint{
			T:     time.Unix(ts, 0).UTC().Format(time.RFC3339),
			Price: closeMinor,
		})
	}
	return out, true
}

// chartParams maps a client range token to Quidax k-line period(minutes)+limit.
func chartParams(rng string) (period, limit int) {
	switch strings.ToUpper(strings.TrimSpace(rng)) {
	case "1D", "24H":
		return 15, 96
	case "1W", "7D":
		return 60, 168
	case "1M":
		return 240, 180
	case "3M":
		return 1440, 90
	case "1Y":
		return 10080, 52
	default:
		return 60, 168
	}
}

// ── Liquidity ────────────────────────────────────────────────────────────────

// Quote builds a best-effort executable buy/sell quote from the live Quidax
// ticker (Quidax has no first-class fiat buy/sell quote on this base URL). The
// ticker's buy/sell price is used as the all-in rate; the crypto/fiat legs are
// computed with integer math from `basis` ("fiat" => amount is fiat minor units;
// otherwise amount is crypto base units).
func (c *Client) Quote(assetKey, side, basis string, amount int64, currency string, lock bool) (domain.Quote, bool) {
	cur := currency
	if cur == "" {
		cur = strings.ToUpper(defaultFiatQuote)
	}
	market := strings.ToLower(assetKey) + strings.ToLower(cur)
	raw, err := c.getData("/markets/tickers/" + url.PathEscape(market))
	if err != nil {
		return domain.Quote{}, false
	}
	var mt marketTicker
	if err := json.Unmarshal(raw, &mt); err != nil {
		return domain.Quote{}, false
	}
	priceStr := mt.Ticker.Sell // client sells to us at the sell price
	if strings.EqualFold(side, "buy") {
		priceStr = mt.Ticker.Buy
	}
	rateMinor, ok := decimalToMinor(priceStr, fiatMinorScale)
	if !ok || rateMinor <= 0 {
		return domain.Quote{}, false
	}

	dec := pow10(defaultCryptoDecimals)
	var fiatMinor, cryptoBase int64
	if strings.EqualFold(basis, "fiat") {
		fiatMinor = amount
		cryptoBase = mulDiv(fiatMinor, dec, rateMinor) // fiat * 10^dec / rate
	} else {
		cryptoBase = amount
		fiatMinor = mulDiv(cryptoBase, rateMinor, dec) // crypto * rate / 10^dec
	}

	sym := strings.ToUpper(assetKey)
	money := func(a int64) domain.Money { return domain.Money{Amount: a, Currency: strings.ToUpper(cur)} }
	return domain.Quote{
		ID:                "qdx-" + strconv.FormatInt(time.Now().UnixNano(), 10),
		AssetID:           sym,
		Symbol:            sym,
		Side:              side,
		Status:            "quoted",
		Basis:             basis,
		Fiat:              money(fiatMinor),
		Crypto:            domain.CryptoAmount{Amount: cryptoBase, Symbol: sym},
		Rate:              money(rateMinor),
		AllInRate:         money(rateMinor),
		Fees:              nil,
		TotalFiat:         money(fiatMinor),
		LiquidityProvider: "quidax",
		CustodyProvider:   "quidax",
		ExpiresAt:         time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
	}, true
}

// swapQuotationRequest is the POST /users/me/temporary_swap_quotation body.
type swapQuotationRequest struct {
	FromCurrency string `json:"from_currency"`
	ToCurrency   string `json:"to_currency"`
	FromAmount   string `json:"from_amount"`
}

// swapQuotationData is the decoded `data` from the swap quotation response.
type swapQuotationData struct {
	ID             string `json:"id"`
	FromCurrency   string `json:"from_currency"`
	ToCurrency     string `json:"to_currency"`
	QuotedPrice    string `json:"quoted_price"`
	QuotedCurrency string `json:"quoted_currency"`
	FromAmount     string `json:"from_amount"`
	ToAmount       string `json:"to_amount"`
	ExpiresAt      string `json:"expires_at"`
}

// SwapQuote requests a crypto-to-crypto quote via Quidax's temporary swap
// quotation (side-effect free — it does not create a locked quotation). fromAmount
// is crypto base units; it is rendered to a decimal string for Quidax and the
// returned amounts are parsed back to base units.
func (c *Client) SwapQuote(fromKey, toKey string, fromAmount int64) (domain.SwapQuote, bool) {
	body := swapQuotationRequest{
		FromCurrency: strings.ToLower(fromKey),
		ToCurrency:   strings.ToLower(toKey),
		FromAmount:   minorToDecimalString(fromAmount, defaultCryptoDecimals),
	}
	raw, err := c.postData("/users/me/temporary_swap_quotation", body)
	if err != nil {
		return domain.SwapQuote{}, false
	}
	var d swapQuotationData
	if err := json.Unmarshal(raw, &d); err != nil {
		return domain.SwapQuote{}, false
	}
	fromBase, ok1 := decimalToMinor(d.FromAmount, defaultCryptoDecimals)
	toBase, ok2 := decimalToMinor(d.ToAmount, defaultCryptoDecimals)
	if !ok1 || !ok2 {
		return domain.SwapQuote{}, false
	}
	fromSym := strings.ToUpper(fromKey)
	toSym := strings.ToUpper(toKey)
	return domain.SwapQuote{
		ID:                d.ID,
		FromAssetID:       fromSym,
		ToAssetID:         toSym,
		From:              domain.CryptoAmount{Amount: fromBase, Symbol: fromSym},
		To:                domain.CryptoAmount{Amount: toBase, Symbol: toSym},
		Rate:              swapRate(d.FromAmount, d.ToAmount), // display ratio (not money)
		LiquidityProvider: "quidax",
		ExpiresAt:         d.ExpiresAt,
	}, true
}

// swapRate returns to/from as a display float (a rate ratio, not a money value).
func swapRate(fromAmount, toAmount string) float64 {
	f, err1 := strconv.ParseFloat(strings.TrimSpace(fromAmount), 64)
	t, err2 := strconv.ParseFloat(strings.TrimSpace(toAmount), 64)
	if err1 != nil || err2 != nil || f == 0 {
		return 0
	}
	return t / f
}

// ── Custody ──────────────────────────────────────────────────────────────────

// paymentAddressData is the decoded `data` from the fetch-payment-address route.
type paymentAddressData struct {
	Address        string `json:"address"`
	Network        string `json:"network"`
	DestinationTag string `json:"destination_tag"`
	Currency       string `json:"currency"`
}

// DepositAddress fetches the custody deposit address for symbol. Quidax's default
// payment-address route is per-currency (not per-network); networkID is echoed
// back into the result for the caller/UI. destination_tag maps to Memo.
func (c *Client) DepositAddress(symbol, networkID string) (domain.DepositAddress, bool) {
	raw, err := c.getData("/users/me/wallets/" + url.PathEscape(strings.ToLower(symbol)) + "/address")
	if err != nil {
		return domain.DepositAddress{}, false
	}
	var d paymentAddressData
	if err := json.Unmarshal(raw, &d); err != nil {
		return domain.DepositAddress{}, false
	}
	if d.Address == "" {
		// Quidax generates addresses asynchronously; an empty address is "not
		// ready yet", which the caller should treat as unavailable.
		return domain.DepositAddress{}, false
	}
	netName := d.Network
	if netName == "" {
		netName = networkID
	}
	return domain.DepositAddress{
		Symbol:          strings.ToUpper(symbol),
		NetworkID:       networkID,
		NetworkName:     netName,
		Address:         d.Address,
		Memo:            d.DestinationTag,
		CustodyProvider: "quidax",
	}, true
}

// feeRuleData is the decoded `data` from the fee_rule route. `fee` is a JSON
// number; json.Number preserves its literal decimal string so decimalToMinor can
// convert it exactly without a float.
type feeRuleData struct {
	Fee  json.Number `json:"fee"`
	Type string      `json:"type"`
}

// WithdrawalQuote previews a withdrawal: it fetches Quidax's network fee for the
// asset/network/amount and derives the net receive amount. amount and the fee are
// crypto base units.
func (c *Client) WithdrawalQuote(assetKey, networkID string, amount int64) (domain.WithdrawalQuote, bool) {
	q := url.Values{}
	q.Set("currency", strings.ToLower(assetKey))
	q.Set("network", networkID)
	q.Set("amount", minorToDecimalString(amount, defaultCryptoDecimals))
	raw, err := c.getData("/users/me/fee_rule?" + q.Encode())
	if err != nil {
		return domain.WithdrawalQuote{}, false
	}
	var d feeRuleData
	if err := json.Unmarshal(raw, &d); err != nil {
		return domain.WithdrawalQuote{}, false
	}
	feeBase, ok := decimalToMinor(d.Fee.String(), defaultCryptoDecimals)
	if !ok {
		return domain.WithdrawalQuote{}, false
	}
	sym := strings.ToUpper(assetKey)
	receive := amount - feeBase
	if receive < 0 {
		receive = 0
	}
	return domain.WithdrawalQuote{
		Symbol:        sym,
		NetworkID:     networkID,
		NetworkName:   networkID,
		Amount:        domain.CryptoAmount{Amount: amount, Symbol: sym},
		NetworkFee:    domain.CryptoAmount{Amount: feeBase, Symbol: sym},
		ReceiveAmount: domain.CryptoAmount{Amount: receive, Symbol: sym},
		ExpiresAt:     time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
	}, true
}

// screeningData is the decoded `data` from an address-screening response. Quidax
// does not publish a native AML/sanctions address-screening endpoint; this shape
// targets a screening proxy that may be mounted at BaseURL. When none is present
// the call errors and ScreenAddress fails safe (see below).
type screeningData struct {
	Risk   string `json:"risk"`
	Reason string `json:"reason"`
}

// ScreenAddress runs an AML/sanctions screen against address. It FAILS SAFE: any
// transport error, 5xx, non-2xx, missing endpoint or unparseable/empty result
// yields a "flagged" outcome, so an unreachable or absent screening service never
// silently clears a withdrawal address.
//
// NOTE: Quidax has no first-class address-screening API. Unless a compatible
// screening endpoint is provisioned at creds.BaseURL, this method conservatively
// returns "flagged" (manual review), which is the correct fail-closed default for
// the money path — never a silent "clear".
func (c *Client) ScreenAddress(address string) domain.AddressScreening {
	q := url.Values{}
	q.Set("address", address)
	raw, err := c.getData("/screening/address?" + q.Encode())
	if err != nil {
		return domain.AddressScreening{Risk: "flagged", Reason: "screening unavailable"}
	}
	var d screeningData
	if err := json.Unmarshal(raw, &d); err != nil || d.Risk == "" {
		return domain.AddressScreening{Risk: "flagged", Reason: "screening unavailable"}
	}
	return domain.AddressScreening{Risk: d.Risk, Reason: d.Reason}
}
