// Package quidax is the Quidax implementation of the cryptoprov capability
// interfaces (market, account, wallet, swap, withdrawal, webhook).
//
// Money-safety rules this adapter enforces:
//   - Amounts cross the wire as decimal strings, never floats.
//   - Retries: reads (GET) retry on 429/444, 5xx and transport errors. Writes (POST)
//     retry ONLY on 429/444, where the provider refused before executing. A 5xx or a
//     dropped connection on a write is returned as ambiguous (the swap or withdrawal
//     may have executed) and is never retried here; the service layer resolves it
//     by re-reading the provider.
//   - Only 4xx responses are definitive (cryptoprov.IsDefinitive).
//   - The secret key is sent only in the Authorization header and never appears in
//     an error.
//
// UNVERIFIED against the live sandbox (see docs/crypto/DISCOVERY.md): the webhook
// event names (swap_transaction.completed vs trade.completed), the signature header
// format and timestamp unit, and whether Quidax honours the withdrawal `reference`
// as an idempotency key. Webhooks must never release value on their payload alone.
package quidax

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

const (
	providerName = "quidax"

	// DefaultBaseURL is the Quidax open API root.
	DefaultBaseURL = "https://openapi.quidax.io/exchange-open-api/api/v1"

	// maxRetries is the number of retries after the first attempt.
	maxRetries = 3

	// defaultRateBudget stays under Quidax's 300 requests/minute limit.
	defaultRateBudget = 240

	maxResponseBytes = 1 << 20
	signatureHeader  = "quidax-signature"
)

// Config configures a Client.
type Config struct {
	BaseURL       string
	SecretKey     string
	WebhookSecret string
	HTTPClient    *http.Client
	// Sleep waits for d or until ctx ends. Injectable for tests.
	Sleep func(ctx context.Context, d time.Duration) error
	// Now is the clock used for webhook replay checks and ticker timestamps.
	Now func() time.Time
	// RateBudgetPerMinute: 0 uses the default, a negative value disables the budget.
	RateBudgetPerMinute int
}

// Client is the Quidax provider.
type Client struct {
	base          string
	secret        string
	webhookSecret string
	hc            *http.Client
	sleep         func(ctx context.Context, d time.Duration) error
	now           func() time.Time
	budget        *budget
}

// New validates the configuration and builds a Client.
func New(cfg Config) (*Client, error) {
	if cfg.SecretKey == "" {
		return nil, errors.New("quidax: secret key is required")
	}
	base := cfg.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("quidax: invalid base URL")
	}
	switch u.Scheme {
	case "https":
	case "http":
		h := u.Hostname()
		if h != "localhost" && h != "127.0.0.1" && h != "::1" {
			return nil, errors.New("quidax: base URL must be https")
		}
	default:
		return nil, errors.New("quidax: base URL must be https")
	}
	c := &Client{
		base:          strings.TrimRight(base, "/"),
		secret:        cfg.SecretKey,
		webhookSecret: cfg.WebhookSecret,
		hc:            cfg.HTTPClient,
		sleep:         cfg.Sleep,
		now:           cfg.Now,
	}
	if c.hc == nil {
		c.hc = &http.Client{Timeout: 30 * time.Second}
	}
	if c.sleep == nil {
		c.sleep = defaultSleep
	}
	if c.now == nil {
		c.now = time.Now
	}
	switch {
	case cfg.RateBudgetPerMinute < 0:
	case cfg.RateBudgetPerMinute == 0:
		c.budget = newBudget(defaultRateBudget, c.now, c.sleep)
	default:
		c.budget = newBudget(cfg.RateBudgetPerMinute, c.now, c.sleep)
	}
	return c, nil
}

func defaultSleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Name implements cryptoprov.Provider.
func (c *Client) Name() string { return providerName }

// AssetClass implements cryptoprov.Provider.
func (c *Client) AssetClass() cryptoprov.AssetClass { return cryptoprov.AssetClassCrypto }

// ---- transport -------------------------------------------------------------

type envelope struct {
	Status  string          `json:"status"`
	Message string          `json:"message"`
	Code    string          `json:"code"`
	Data    json.RawMessage `json:"data"`
}

// do performs one logical request with the retry rules in the package comment and
// returns the decoded `data` object.
func (c *Client) do(ctx context.Context, method, path, query string, body any) (json.RawMessage, error) {
	var payload []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("quidax: encode request: %w", err)
		}
		payload = b
	}
	full := c.base + path
	if query != "" {
		full += "?" + query
	}
	isRead := method == http.MethodGet

	for attempt := 0; ; attempt++ {
		if c.budget != nil {
			if err := c.budget.take(ctx); err != nil {
				return nil, err
			}
		}
		var rdr io.Reader
		if payload != nil {
			rdr = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, full, rdr)
		if err != nil {
			return nil, fmt.Errorf("quidax: build request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.secret)
		req.Header.Set("Accept", "application/json")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := c.hc.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if isRead && attempt < maxRetries {
				if serr := c.sleep(ctx, backoff(attempt)); serr != nil {
					return nil, serr
				}
				continue
			}
			// A write that dropped mid-flight may have executed: ambiguous, no retry.
			return nil, fmt.Errorf("quidax: %s %s: transport error: %w", method, path, err)
		}
		raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		_ = resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if rerr != nil {
				return nil, fmt.Errorf("quidax: %s %s: unreadable response: %w", method, path, rerr)
			}
			var env envelope
			if err := json.Unmarshal(raw, &env); err != nil {
				return nil, fmt.Errorf("quidax: %s %s: malformed response", method, path)
			}
			// Quidax answers some refusals with HTTP 200 and status "error". The action
			// did not execute, so surface it as a definitive client-side refusal.
			if strings.EqualFold(env.Status, "error") {
				ae := apiError(http.StatusUnprocessableEntity, raw)
				return nil, ae
			}
			return env.Data, nil
		}

		apiErr := apiError(resp.StatusCode, raw)
		rateLimited := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == 444
		retryable := rateLimited || (isRead && resp.StatusCode >= 500)
		if retryable && attempt < maxRetries {
			if serr := c.sleep(ctx, backoff(attempt)); serr != nil {
				return nil, serr
			}
			continue
		}
		return nil, apiErr
	}
}

func backoff(attempt int) time.Duration {
	d := 250 * time.Millisecond << uint(attempt)
	if d > 8*time.Second {
		d = 8 * time.Second
	}
	return d
}

func apiError(status int, raw []byte) *cryptoprov.APIError {
	var env struct {
		Message string `json:"message"`
		Code    string `json:"code"`
		Data    struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"data"`
	}
	_ = json.Unmarshal(raw, &env)
	msg := env.Message
	if msg == "" {
		msg = env.Data.Message
	}
	if env.Code == "" {
		env.Code = env.Data.Code
	}
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return &cryptoprov.APIError{Provider: providerName, Status: status, Code: env.Code, Message: msg}
}

// ---- helpers ---------------------------------------------------------------

func parseDecimal(s string) (decimal.Decimal, error) {
	return decimal.NewFromString(strings.TrimSpace(s))
}

// optionalDecimal reads a decimal that may be absent (absent is zero).
func optionalDecimal(s string) (decimal.Decimal, error) {
	if strings.TrimSpace(s) == "" {
		return decimal.Zero, nil
	}
	return parseDecimal(s)
}

func lower(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
func upper(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }

func pathID(s string) string { return url.PathEscape(s) }

// ---- market ----------------------------------------------------------------

// Ticker implements cryptoprov.MarketProvider.
func (c *Client) Ticker(ctx context.Context, market string) (cryptoprov.Ticker, error) {
	m := lower(market)
	if m == "" {
		return cryptoprov.Ticker{}, errors.New("quidax: market is required")
	}
	data, err := c.do(ctx, http.MethodGet, "/markets/tickers/"+pathID(m), "", nil)
	if err != nil {
		return cryptoprov.Ticker{}, err
	}
	// Observed shape: data.<market>.ticker.last, where last is a JSON number. json.Number
	// keeps the exact digits so the price is never routed through a float.
	var d map[string]struct {
		Ticker struct {
			Last json.Number `json:"last"`
		} `json:"ticker"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return cryptoprov.Ticker{}, errors.New("quidax: malformed ticker")
	}
	entry, ok := d[m]
	if !ok {
		return cryptoprov.Ticker{}, errors.New("quidax: ticker missing for market")
	}
	last, err := parseDecimal(entry.Ticker.Last.String())
	if err != nil || !last.IsPositive() {
		return cryptoprov.Ticker{}, errors.New("quidax: ticker price missing or not positive")
	}
	return cryptoprov.Ticker{Market: m, Last: last, At: c.now()}, nil
}

// ---- account / wallet ------------------------------------------------------

// CreateAccount implements cryptoprov.AccountProvider.
func (c *Client) CreateAccount(ctx context.Context, u cryptoprov.UserRef) (cryptoprov.AccountRef, error) {
	if u.Email == "" {
		return cryptoprov.AccountRef{}, errors.New("quidax: email is required")
	}
	data, err := c.do(ctx, http.MethodPost, "/users", "", map[string]any{
		"email": u.Email, "first_name": u.FirstName, "last_name": u.LastName,
	})
	if err != nil {
		return cryptoprov.AccountRef{}, err
	}
	var d struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &d); err != nil || d.ID == "" {
		return cryptoprov.AccountRef{}, errors.New("quidax: account created without an id")
	}
	return cryptoprov.AccountRef{ID: d.ID}, nil
}

// Wallets implements cryptoprov.WalletProvider.
func (c *Client) Wallets(ctx context.Context, accountID string) ([]cryptoprov.Wallet, error) {
	if accountID == "" {
		return nil, errors.New("quidax: account id is required")
	}
	data, err := c.do(ctx, http.MethodGet, "/users/"+pathID(accountID)+"/wallets", "", nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Currency string `json:"currency"`
		Balance  string `json:"balance"`
		Locked   string `json:"locked"`
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, errors.New("quidax: malformed wallets")
	}
	out := make([]cryptoprov.Wallet, 0, len(rows))
	for _, r := range rows {
		bal, err := optionalDecimal(r.Balance)
		if err != nil {
			return nil, errors.New("quidax: malformed wallet balance")
		}
		lk, err := optionalDecimal(r.Locked)
		if err != nil {
			return nil, errors.New("quidax: malformed wallet locked amount")
		}
		out = append(out, cryptoprov.Wallet{Currency: upper(r.Currency), Balance: bal, Locked: lk})
	}
	return out, nil
}

// CreateDepositAddress implements cryptoprov.WalletProvider.
func (c *Client) CreateDepositAddress(ctx context.Context, accountID, currency, network string) (cryptoprov.DepositAddress, error) {
	if accountID == "" || currency == "" {
		return cryptoprov.DepositAddress{}, errors.New("quidax: account id and currency are required")
	}
	q := ""
	if network != "" {
		q = url.Values{"network": {network}}.Encode()
	}
	data, err := c.do(ctx, http.MethodPost, "/users/"+pathID(accountID)+"/wallets/"+pathID(lower(currency))+"/addresses", q, nil)
	if err != nil {
		return cryptoprov.DepositAddress{}, err
	}
	var d struct {
		Address string `json:"address"`
		Tag     string `json:"destination_tag"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return cryptoprov.DepositAddress{}, errors.New("quidax: deposit address unreadable")
	}
	if d.Address == "" { // generated asynchronously: a wallet.address.generated webhook follows
		return cryptoprov.DepositAddress{}, cryptoprov.ErrAddressPending
	}
	return cryptoprov.DepositAddress{Currency: upper(currency), Network: network, Address: d.Address, Tag: d.Tag}, nil
}

// DepositAddress implements cryptoprov.WalletProvider: the account's current address.
func (c *Client) DepositAddress(ctx context.Context, accountID, currency, network string) (cryptoprov.DepositAddress, error) {
	if accountID == "" || currency == "" {
		return cryptoprov.DepositAddress{}, errors.New("quidax: account id and currency are required")
	}
	q := ""
	if network != "" {
		q = url.Values{"network": {network}}.Encode()
	}
	data, err := c.do(ctx, http.MethodGet, "/users/"+pathID(accountID)+"/wallets/"+pathID(lower(currency))+"/address", q, nil)
	if err != nil {
		return cryptoprov.DepositAddress{}, err
	}
	var d struct {
		Address *string `json:"address"`
		Tag     *string `json:"destination_tag"`
		Network string  `json:"network"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return cryptoprov.DepositAddress{}, errors.New("quidax: deposit address unreadable")
	}
	if d.Address == nil || *d.Address == "" {
		return cryptoprov.DepositAddress{}, cryptoprov.ErrAddressPending
	}
	out := cryptoprov.DepositAddress{Currency: upper(currency), Network: network, Address: *d.Address}
	if out.Network == "" {
		out.Network = d.Network
	}
	if d.Tag != nil {
		out.Tag = *d.Tag
	}
	return out, nil
}

// GetDeposit implements cryptoprov.DepositProvider.
func (c *Client) GetDeposit(ctx context.Context, accountID, id string) (cryptoprov.Deposit, error) {
	if accountID == "" || id == "" {
		return cryptoprov.Deposit{}, errors.New("quidax: account id and deposit id are required")
	}
	data, err := c.do(ctx, http.MethodGet, "/users/"+pathID(accountID)+"/deposits/"+pathID(id), "", nil)
	if err != nil {
		return cryptoprov.Deposit{}, err
	}
	var d struct {
		ID       any    `json:"id"`
		Currency string `json:"currency"`
		Amount   string `json:"amount"`
		Fee      string `json:"fee"`
		TxID     string `json:"txid"`
		Status   string `json:"status"`
		Tx       struct {
			Confirmations         int `json:"confirmations"`
			RequiredConfirmations int `json:"required_confirmations"`
		} `json:"payment_transaction"`
		Addr struct {
			Address string `json:"address"`
			Network string `json:"network"`
		} `json:"payment_address"`
		User struct {
			ID any `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return cryptoprov.Deposit{}, errors.New("quidax: deposit unreadable")
	}
	depID := idString(d.ID)
	amt, aerr := parseDecimal(d.Amount)
	fee, ferr := optionalDecimal(d.Fee)
	switch {
	case depID == "" || d.Currency == "":
		return cryptoprov.Deposit{}, errors.New("quidax: deposit is missing its id or currency")
	case aerr != nil || !amt.IsPositive() || ferr != nil:
		return cryptoprov.Deposit{}, errors.New("quidax: deposit amount is malformed or not positive")
	}
	st := cryptoprov.DepositPending
	switch s := lower(d.Status); {
	case s == "accepted":
		st = cryptoprov.DepositAccepted
	case s == "rejected" || strings.HasPrefix(s, "failed"):
		st = cryptoprov.DepositRejected
	}
	acct := idString(d.User.ID)
	if acct == "" {
		acct = accountID
	}
	return cryptoprov.Deposit{
		ID: depID, AccountID: acct, Currency: upper(d.Currency), Network: d.Addr.Network, Address: d.Addr.Address,
		Amount: amt, Fee: fee, TxID: d.TxID, Status: st,
		Confirmations: d.Tx.Confirmations, RequiredConfirmations: d.Tx.RequiredConfirmations,
	}, nil
}

// idString reads a provider id that may be a JSON string or number.
func idString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return decimal.NewFromFloat(t).String()
	}
	return ""
}

// ---- swaps -----------------------------------------------------------------

// QuoteSwap implements cryptoprov.SwapProvider.
func (c *Client) QuoteSwap(ctx context.Context, req cryptoprov.SwapQuoteRequest) (cryptoprov.SwapQuote, error) {
	from, to := lower(req.From), lower(req.To)
	hasFrom, hasTo := req.FromAmount.IsPositive(), req.ToAmount.IsPositive()
	switch {
	case req.AccountID == "":
		return cryptoprov.SwapQuote{}, errors.New("quidax: account id is required")
	case from == "" || to == "" || from == to:
		return cryptoprov.SwapQuote{}, errors.New("quidax: swap needs two different assets")
	case hasFrom == hasTo:
		return cryptoprov.SwapQuote{}, errors.New("quidax: set exactly one positive swap amount")
	}
	body := map[string]any{"from_currency": from, "to_currency": to}
	if hasFrom {
		body["from_amount"] = req.FromAmount.String()
	} else {
		body["to_amount"] = req.ToAmount.String()
	}
	data, err := c.do(ctx, http.MethodPost, "/users/"+pathID(req.AccountID)+"/swap_quotation", "", body)
	if err != nil {
		return cryptoprov.SwapQuote{}, err
	}
	var d struct {
		ID        string `json:"id"`
		From      string `json:"from_currency"`
		To        string `json:"to_currency"`
		FromAmt   string `json:"from_amount"`
		ToAmt     string `json:"to_amount"`
		Price     string `json:"quoted_price"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.Unmarshal(data, &d); err != nil || d.ID == "" {
		return cryptoprov.SwapQuote{}, errors.New("quidax: quote missing id")
	}
	fromAmt, e1 := parseDecimal(d.FromAmt)
	toAmt, e2 := parseDecimal(d.ToAmt)
	price, e3 := parseDecimal(d.Price)
	if e1 != nil || e2 != nil || e3 != nil || !fromAmt.IsPositive() || !toAmt.IsPositive() || !price.IsPositive() {
		return cryptoprov.SwapQuote{}, errors.New("quidax: quote amounts missing or not positive")
	}
	exp, err := time.Parse(time.RFC3339, d.ExpiresAt)
	if err != nil {
		return cryptoprov.SwapQuote{}, errors.New("quidax: quote expiry missing")
	}
	qFrom, qTo := upper(d.From), upper(d.To)
	if qFrom == "" {
		qFrom = upper(from)
	}
	if qTo == "" {
		qTo = upper(to)
	}
	return cryptoprov.SwapQuote{QuoteID: d.ID, From: qFrom, To: qTo, FromAmt: fromAmt, ToAmt: toAmt, Price: price, ExpiresAt: exp.UTC()}, nil
}

type swapDTO struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Received string `json:"received_amount"`
	ToAmt    string `json:"to_amount"`
}

func (c *Client) readSwap(data json.RawMessage, quoteID string) (cryptoprov.Swap, error) {
	var d swapDTO
	if err := json.Unmarshal(data, &d); err != nil || d.ID == "" {
		// The call may have executed: unreadable success is ambiguous, not a failure.
		return cryptoprov.Swap{}, errors.New("quidax: swap response unreadable or missing id")
	}
	amt := d.Received
	if amt == "" {
		amt = d.ToAmt
	}
	to, err := optionalDecimal(amt)
	if err != nil {
		return cryptoprov.Swap{}, errors.New("quidax: swap amount unreadable")
	}
	return cryptoprov.Swap{ID: d.ID, QuoteID: quoteID, Status: mapSwapStatus(d.Status), ToAmt: to}, nil
}

func mapSwapStatus(s string) cryptoprov.SwapStatus {
	switch lower(s) {
	case "completed", "done", "success":
		return cryptoprov.SwapCompleted
	case "failed", "rejected", "cancelled", "canceled":
		return cryptoprov.SwapFailed
	default:
		return cryptoprov.SwapPending
	}
}

// ConfirmSwap implements cryptoprov.SwapProvider.
func (c *Client) ConfirmSwap(ctx context.Context, accountID, quoteID string) (cryptoprov.Swap, error) {
	if accountID == "" || quoteID == "" {
		return cryptoprov.Swap{}, errors.New("quidax: account id and quote id are required")
	}
	data, err := c.do(ctx, http.MethodPost, "/users/"+pathID(accountID)+"/swap_quotation/"+pathID(quoteID)+"/confirm", "", nil)
	if err != nil {
		return cryptoprov.Swap{}, err
	}
	return c.readSwap(data, quoteID)
}

// GetSwap implements cryptoprov.SwapProvider.
func (c *Client) GetSwap(ctx context.Context, accountID, swapID string) (cryptoprov.Swap, error) {
	if accountID == "" || swapID == "" {
		return cryptoprov.Swap{}, errors.New("quidax: account id and swap id are required")
	}
	data, err := c.do(ctx, http.MethodGet, "/users/"+pathID(accountID)+"/swap_transactions/"+pathID(swapID), "", nil)
	if err != nil {
		return cryptoprov.Swap{}, err
	}
	return c.readSwap(data, "")
}

// ---- withdrawals -----------------------------------------------------------

// Withdraw implements cryptoprov.WithdrawalProvider.
func (c *Client) Withdraw(ctx context.Context, req cryptoprov.WithdrawRequest) (cryptoprov.Withdrawal, error) {
	switch {
	case req.AccountID == "":
		return cryptoprov.Withdrawal{}, errors.New("quidax: account id is required")
	case req.Reference == "":
		return cryptoprov.Withdrawal{}, errors.New("quidax: a deterministic withdrawal reference is required")
	case req.Address == "" || req.Currency == "":
		return cryptoprov.Withdrawal{}, errors.New("quidax: currency and address are required")
	case !req.Amount.IsPositive():
		return cryptoprov.Withdrawal{}, errors.New("quidax: withdrawal amount must be positive")
	}
	body := map[string]any{
		"currency":         lower(req.Currency),
		"amount":           req.Amount.String(),
		"fund_uid":         req.Address,
		"reference":        req.Reference,
		"transaction_note": req.Reference,
	}
	if req.Tag != "" {
		body["fund_uid2"] = req.Tag
	}
	if req.Network != "" {
		body["network"] = req.Network
	}
	data, err := c.do(ctx, http.MethodPost, "/users/"+pathID(req.AccountID)+"/withdraws", "", body)
	if err != nil {
		return cryptoprov.Withdrawal{}, err
	}
	return readWithdrawal(data)
}

// GetWithdrawal implements cryptoprov.WithdrawalProvider.
func (c *Client) GetWithdrawal(ctx context.Context, accountID, id string) (cryptoprov.Withdrawal, error) {
	if accountID == "" || id == "" {
		return cryptoprov.Withdrawal{}, errors.New("quidax: account id and withdrawal id are required")
	}
	data, err := c.do(ctx, http.MethodGet, "/users/"+pathID(accountID)+"/withdraws/"+pathID(id), "", nil)
	if err != nil {
		return cryptoprov.Withdrawal{}, err
	}
	return readWithdrawal(data)
}

func readWithdrawal(data json.RawMessage) (cryptoprov.Withdrawal, error) {
	var d struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		TxID   string `json:"txid"`
	}
	if err := json.Unmarshal(data, &d); err != nil || d.ID == "" {
		return cryptoprov.Withdrawal{}, errors.New("quidax: withdrawal response unreadable or missing id")
	}
	st := cryptoprov.WithdrawalProcessing
	switch lower(d.Status) {
	case "done":
		st = cryptoprov.WithdrawalDone
	case "rejected":
		st = cryptoprov.WithdrawalRejected
	}
	return cryptoprov.Withdrawal{ID: d.ID, Status: st, TxID: d.TxID}, nil
}

// ---- webhooks --------------------------------------------------------------

// VerifyWebhook implements cryptoprov.WebhookProvider. It fails closed when no
// webhook secret is configured.
func (c *Client) VerifyWebhook(headers map[string]string, body []byte) error {
	var sig string
	for k, v := range headers {
		if strings.EqualFold(k, signatureHeader) {
			sig = v
			break
		}
	}
	return cryptoprov.VerifyHMACSignature(c.webhookSecret, sig, body, c.now(), cryptoprov.DefaultReplayWindow)
}

// ParseWebhook implements cryptoprov.WebhookProvider. The key is stable per
// (event, entity), so provider redeliveries dedupe.
func (c *Client) ParseWebhook(body []byte) (cryptoprov.Event, error) {
	var env struct {
		Event string          `json:"event"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return cryptoprov.Event{}, errors.New("quidax: malformed webhook")
	}
	if env.Event == "" || len(env.Data) == 0 || string(env.Data) == "null" {
		return cryptoprov.Event{}, errors.New("quidax: webhook missing event or data")
	}
	var d struct {
		ID   any `json:"id"`
		User struct {
			ID any `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(env.Data, &d); err != nil {
		return cryptoprov.Event{}, errors.New("quidax: webhook data unreadable")
	}
	id := idString(d.ID)
	if id == "" {
		return cryptoprov.Event{}, errors.New("quidax: webhook data has no id")
	}
	return cryptoprov.Event{
		Key:     "quidax:" + env.Event + ":" + id,
		Type:    env.Event,
		Ref:     id,
		Account: idString(d.User.ID),
		Raw:     []byte(env.Data),
	}, nil
}

// ---- rate budget -----------------------------------------------------------

// budget is a sliding-window limiter that keeps the client under the provider's
// per-minute limit.
type budget struct {
	perMinute int
	now       func() time.Time
	sleep     func(ctx context.Context, d time.Duration) error
	mu        sync.Mutex
	stamps    []time.Time
}

func newBudget(perMinute int, now func() time.Time, sleep func(ctx context.Context, d time.Duration) error) *budget {
	return &budget{perMinute: perMinute, now: now, sleep: sleep}
}

// take records one request, first waiting if the last minute is already full.
func (b *budget) take(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for {
		now := b.now()
		cut := 0
		for cut < len(b.stamps) && !b.stamps[cut].After(now.Add(-time.Minute)) {
			cut++
		}
		b.stamps = b.stamps[cut:]
		if len(b.stamps) < b.perMinute {
			b.stamps = append(b.stamps, now)
			return nil
		}
		wait := b.stamps[0].Add(time.Minute).Sub(now)
		if wait <= 0 {
			wait = time.Millisecond
		}
		if err := b.sleep(ctx, wait); err != nil {
			return err
		}
	}
}
