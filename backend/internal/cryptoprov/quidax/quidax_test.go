package quidax

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

const testSecret = "sk_test_super_secret_value"

type call struct {
	method, path, query, auth, contentType string
	body                                   map[string]any
}

// server records every request and answers from a script (the last entry repeats).
func server(t *testing.T, script ...func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, *[]call, *int32) {
	t.Helper()
	var calls []call
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := call{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, auth: r.Header.Get("Authorization"), contentType: r.Header.Get("Content-Type")}
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			_ = json.Unmarshal(b, &c.body)
		}
		calls = append(calls, c)
		i := int(atomic.AddInt32(&n, 1)) - 1
		if i >= len(script) {
			i = len(script) - 1
		}
		script[i](w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls, &n
}

func jsonReply(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

type slept struct{ d []time.Duration }

func newClient(t *testing.T, base string, sl *slept) *Client {
	t.Helper()
	c, err := New(Config{
		BaseURL:       base,
		SecretKey:     testSecret,
		WebhookSecret: "whsec_test",
		HTTPClient:    &http.Client{Timeout: 5 * time.Second},
		Sleep: func(_ context.Context, d time.Duration) error {
			if sl != nil {
				sl.d = append(sl.d, d)
			}
			return nil
		},
		RateBudgetPerMinute: -1, // disabled in these tests; covered separately
	})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func dec(s string) decimal.Decimal { return decimal.RequireFromString(s) }

// ---- construction ----------------------------------------------------------

func TestNewRequiresSecretAndHTTPS(t *testing.T) {
	if _, err := New(Config{BaseURL: "https://openapi.quidax.io/x"}); err == nil {
		t.Fatal("missing secret accepted")
	}
	if _, err := New(Config{SecretKey: "k", BaseURL: "http://insecure.example"}); err == nil {
		t.Fatal("plain-http base URL accepted for a non-local host")
	}
	if _, err := New(Config{SecretKey: "k"}); err != nil {
		t.Fatalf("default base URL should be valid: %v", err)
	}
	c, _ := New(Config{SecretKey: "k"})
	if c.Name() != "quidax" || c.AssetClass() != cryptoprov.AssetClassCrypto {
		t.Fatalf("identity = %s/%s", c.Name(), c.AssetClass())
	}
}

func TestClientImplementsEveryCapability(t *testing.T) {
	var p cryptoprov.Provider = &Client{}
	for name, f := range map[string]func() error{
		"market":     func() error { _, e := cryptoprov.As[cryptoprov.MarketProvider](p); return e },
		"swap":       func() error { _, e := cryptoprov.As[cryptoprov.SwapProvider](p); return e },
		"withdrawal": func() error { _, e := cryptoprov.As[cryptoprov.WithdrawalProvider](p); return e },
		"wallet":     func() error { _, e := cryptoprov.As[cryptoprov.WalletProvider](p); return e },
		"account":    func() error { _, e := cryptoprov.As[cryptoprov.AccountProvider](p); return e },
		"webhook":    func() error { _, e := cryptoprov.As[cryptoprov.WebhookProvider](p); return e },
	} {
		if err := f(); err != nil {
			t.Errorf("%s capability: %v", name, err)
		}
	}
}

// ---- market ----------------------------------------------------------------

func TestTickerPathAuthAndExactDecimal(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"status":"success","data":{"btcngn":{"ticker":{"last":90000000.123456789012345678},"at":1791736915000}}}`))
	c := newClient(t, srv.URL, nil)
	tk, err := c.Ticker(context.Background(), "BTCNGN")
	if err != nil {
		t.Fatal(err)
	}
	if !tk.Last.Equal(dec("90000000.123456789012345678")) {
		t.Fatalf("price lost precision: %s", tk.Last)
	}
	got := (*calls)[0]
	if got.method != "GET" || got.path != "/markets/tickers/btcngn" {
		t.Fatalf("request = %s %s", got.method, got.path)
	}
	if got.auth != "Bearer "+testSecret {
		t.Fatalf("auth header = %q", got.auth)
	}
}

func TestTickerRejectsNonPositiveOrMalformedPrice(t *testing.T) {
	for _, body := range []string{
		`{"data":{"ticker":{"last":"0"}}}`,
		`{"data":{"ticker":{"last":"-5"}}}`,
		`{"data":{"ticker":{"last":"abc"}}}`,
		`{"data":{"ticker":{}}}`,
		`not json`,
	} {
		srv, _, _ := server(t, jsonReply(200, body))
		if _, err := newClient(t, srv.URL, nil).Ticker(context.Background(), "btcngn"); err == nil {
			t.Errorf("accepted bad ticker body %q", body)
		}
	}
}

// ---- retry rules -----------------------------------------------------------

func TestGetRetriesRateLimitThenSucceeds(t *testing.T) {
	for _, code := range []int{429, 444} {
		sl := &slept{}
		srv, _, n := server(t, jsonReply(code, `{"message":"slow down"}`), jsonReply(code, `{}`), jsonReply(200, `{"data":{"btcngn":{"ticker":{"last":10}}}}`))
		if _, err := newClient(t, srv.URL, sl).Ticker(context.Background(), "btcngn"); err != nil {
			t.Fatalf("HTTP %d: %v", code, err)
		}
		if atomic.LoadInt32(n) != 3 || len(sl.d) != 2 {
			t.Fatalf("HTTP %d: requests=%d sleeps=%d, want 3 and 2", code, *n, len(sl.d))
		}
		if sl.d[1] <= sl.d[0] {
			t.Fatalf("backoff must grow: %v", sl.d)
		}
	}
}

func TestGetRateLimitGivesUpAndIsClassifiedRateLimited(t *testing.T) {
	srv, _, n := server(t, jsonReply(444, `{"message":"rate limited"}`))
	_, err := newClient(t, srv.URL, &slept{}).Ticker(context.Background(), "btcngn")
	if !cryptoprov.IsRateLimited(err) {
		t.Fatalf("err = %v, want rate limited", err)
	}
	if got := atomic.LoadInt32(n); got != int32(1+maxRetries) {
		t.Fatalf("requests = %d, want %d", got, 1+maxRetries)
	}
}

func TestGetRetriesServerErrorButPostDoesNot(t *testing.T) {
	// GET: idempotent, so a 5xx is retried.
	srv, _, n := server(t, jsonReply(502, `{}`), jsonReply(200, `{"data":{"btcngn":{"ticker":{"last":10}}}}`))
	if _, err := newClient(t, srv.URL, &slept{}).Ticker(context.Background(), "btcngn"); err != nil {
		t.Fatalf("GET after 502: %v", err)
	}
	if atomic.LoadInt32(n) != 2 {
		t.Fatalf("GET requests = %d, want 2", *n)
	}

	// POST that moves value: a 500 must NOT be retried — the swap may have executed.
	srv2, _, n2 := server(t, jsonReply(500, `{"message":"boom"}`), jsonReply(200, `{"data":{"id":"sw_1","status":"completed"}}`))
	_, err := newClient(t, srv2.URL, &slept{}).ConfirmSwap(context.Background(), "acct1", "qt_1")
	if err == nil {
		t.Fatal("500 on confirm returned success")
	}
	if atomic.LoadInt32(n2) != 1 {
		t.Fatalf("POST was retried after a 500: %d requests", *n2)
	}
	if !cryptoprov.IsAmbiguous(err) || cryptoprov.IsDefinitive(err) {
		t.Fatalf("a 500 on a value-moving POST must be ambiguous, got %v", err)
	}
}

func TestPostRetriesRateLimitBecauseItDidNotExecute(t *testing.T) {
	srv, _, n := server(t, jsonReply(429, `{}`), jsonReply(200, `{"data":{"id":"sw_9","status":"completed","to_amount":"5"}}`))
	sw, err := newClient(t, srv.URL, &slept{}).ConfirmSwap(context.Background(), "acct1", "qt_1")
	if err != nil || sw.ID != "sw_9" {
		t.Fatalf("swap = %+v, %v", sw, err)
	}
	if atomic.LoadInt32(n) != 2 {
		t.Fatalf("requests = %d, want 2", *n)
	}
}

func TestTransportFailureOnPostIsAmbiguousAndNotRetried(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		hj, _ := w.(http.Hijacker)
		conn, _, _ := hj.Hijack()
		_ = conn.Close() // the request was received, no response: the outcome is unknown
	}))
	defer srv.Close()
	_, err := newClient(t, srv.URL, &slept{}).Withdraw(context.Background(), cryptoprov.WithdrawRequest{
		AccountID: "a1", Currency: "USDT", Network: "trc20", Address: "TXyz", Amount: dec("5"), Reference: "wd:1",
	})
	if err == nil {
		t.Fatal("dropped connection returned success")
	}
	if !cryptoprov.IsAmbiguous(err) {
		t.Fatalf("err = %v, want ambiguous", err)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("withdraw was retried after a dropped connection: %d", hits)
	}
}

func TestClientErrorsAreDefinitiveAndDoNotLeakTheSecret(t *testing.T) {
	srv, _, n := server(t, jsonReply(422, `{"status":"error","message":"insufficient balance","code":"insufficient_funds"}`))
	_, err := newClient(t, srv.URL, nil).CreateAccount(context.Background(), cryptoprov.UserRef{UserID: "u1", Email: "a@b.co"})
	var api *cryptoprov.APIError
	if !errors.As(err, &api) || api.Status != 422 || api.Provider != "quidax" {
		t.Fatalf("err = %#v", err)
	}
	if !cryptoprov.IsDefinitive(err) {
		t.Fatal("a 422 must be definitive")
	}
	if !strings.Contains(api.Message, "insufficient balance") {
		t.Fatalf("message lost: %q", api.Message)
	}
	if strings.Contains(err.Error(), testSecret) {
		t.Fatal("error text leaked the secret")
	}
	if atomic.LoadInt32(n) != 1 {
		t.Fatalf("a 4xx was retried: %d", *n)
	}
}

func TestContextCancellationStopsRetries(t *testing.T) {
	srv, _, _ := server(t, jsonReply(429, `{}`))
	ctx, cancel := context.WithCancel(context.Background())
	c, _ := New(Config{BaseURL: srv.URL, SecretKey: testSecret, RateBudgetPerMinute: -1,
		Sleep: func(ctx context.Context, _ time.Duration) error { cancel(); return ctx.Err() }})
	if _, err := c.Ticker(ctx, "btcngn"); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

// ---- account / wallet ------------------------------------------------------

func TestCreateAccount(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"status":"success","data":{"id":"qd_user_42"}}`))
	ref, err := newClient(t, srv.URL, nil).CreateAccount(context.Background(), cryptoprov.UserRef{UserID: "u1", Email: "a@b.co", FirstName: "Ada", LastName: "Obi"})
	if err != nil || ref.ID != "qd_user_42" {
		t.Fatalf("ref = %+v, %v", ref, err)
	}
	c := (*calls)[0]
	if c.method != "POST" || c.path != "/users" || c.body["email"] != "a@b.co" || c.body["first_name"] != "Ada" {
		t.Fatalf("request = %+v", c)
	}
}

func TestWalletsKeepExactBalances(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"data":[{"currency":"usdt","balance":"12.345678","locked":"0.000001"},{"currency":"btc","balance":"0.000000000000000001","locked":"0"}]}`))
	ws, err := newClient(t, srv.URL, nil).Wallets(context.Background(), "acct1")
	if err != nil || len(ws) != 2 {
		t.Fatalf("wallets = %+v, %v", ws, err)
	}
	if ws[0].Currency != "USDT" || !ws[0].Balance.Equal(dec("12.345678")) || !ws[0].Locked.Equal(dec("0.000001")) {
		t.Fatalf("usdt = %+v", ws[0])
	}
	if !ws[1].Balance.Equal(dec("0.000000000000000001")) {
		t.Fatalf("1 wei lost: %s", ws[1].Balance)
	}
	if (*calls)[0].path != "/users/acct1/wallets" {
		t.Fatalf("path = %s", (*calls)[0].path)
	}
}

func TestCreateDepositAddress(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"data":{"address":"TXyzAddress","destination_tag":"12345","currency":"usdt"}}`))
	a, err := newClient(t, srv.URL, nil).CreateDepositAddress(context.Background(), "acct1", "USDT", "trc20")
	if err != nil || a.Address != "TXyzAddress" || a.Tag != "12345" || a.Network != "trc20" || a.Currency != "USDT" {
		t.Fatalf("address = %+v, %v", a, err)
	}
	c := (*calls)[0]
	if c.method != "POST" || c.path != "/users/acct1/wallets/usdt/addresses" || c.query != "network=trc20" {
		t.Fatalf("request = %s %s?%s", c.method, c.path, c.query)
	}
}

func TestCreateDepositAddressRejectsEmptyAddress(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":{}}`))
	if _, err := newClient(t, srv.URL, nil).CreateDepositAddress(context.Background(), "a", "usdt", "trc20"); err == nil {
		t.Fatal("empty address accepted")
	}
}

// ---- swaps -----------------------------------------------------------------

func TestQuoteSwapSendsExactlyOneSideAsDecimalString(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"data":{"id":"qt_77","from_currency":"usdt","to_currency":"ngn","from_amount":"10","to_amount":"15000.5","quoted_price":"1500.05","expires_at":"2026-10-12T10:00:15Z"}}`))
	c := newClient(t, srv.URL, nil)
	q, err := c.QuoteSwap(context.Background(), cryptoprov.SwapQuoteRequest{AccountID: "acct1", From: "USDT", To: "NGN", FromAmount: dec("10")})
	if err != nil {
		t.Fatal(err)
	}
	if q.QuoteID != "qt_77" || !q.ToAmt.Equal(dec("15000.5")) || !q.Price.Equal(dec("1500.05")) || !q.FromAmt.Equal(dec("10")) {
		t.Fatalf("quote = %+v", q)
	}
	if !q.ExpiresAt.Equal(time.Date(2026, 10, 12, 10, 0, 15, 0, time.UTC)) {
		t.Fatalf("expiry = %v", q.ExpiresAt)
	}
	body := (*calls)[0].body
	if (*calls)[0].path != "/users/acct1/swap_quotation" || body["from_currency"] != "usdt" || body["to_currency"] != "ngn" {
		t.Fatalf("request = %+v", (*calls)[0])
	}
	if body["from_amount"] != "10" {
		t.Fatalf("from_amount must be a decimal STRING, got %#v", body["from_amount"])
	}
	if _, has := body["to_amount"]; has {
		t.Fatal("both sides were sent")
	}
}

func TestQuoteSwapToAmountSide(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"data":{"id":"qt_78","from_amount":"6.6666","to_amount":"10","quoted_price":"1.5","expires_at":"2026-10-12T10:00:15Z"}}`))
	_, err := newClient(t, srv.URL, nil).QuoteSwap(context.Background(), cryptoprov.SwapQuoteRequest{AccountID: "a", From: "ngn", To: "usdt", ToAmount: dec("10")})
	if err != nil {
		t.Fatal(err)
	}
	body := (*calls)[0].body
	if body["to_amount"] != "10" {
		t.Fatalf("to_amount = %#v", body["to_amount"])
	}
	if _, has := body["from_amount"]; has {
		t.Fatal("both sides were sent")
	}
}

func TestQuoteSwapValidatesBeforeCalling(t *testing.T) {
	srv, _, n := server(t, jsonReply(200, `{}`))
	c := newClient(t, srv.URL, nil)
	for name, req := range map[string]cryptoprov.SwapQuoteRequest{
		"neither side": {AccountID: "a", From: "usdt", To: "ngn"},
		"both sides":   {AccountID: "a", From: "usdt", To: "ngn", FromAmount: dec("1"), ToAmount: dec("1")},
		"no account":   {From: "usdt", To: "ngn", FromAmount: dec("1")},
		"same asset":   {AccountID: "a", From: "usdt", To: "usdt", FromAmount: dec("1")},
	} {
		if _, err := c.QuoteSwap(context.Background(), req); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if atomic.LoadInt32(n) != 0 {
		t.Fatalf("invalid quotes reached the provider: %d requests", *n)
	}
}

func TestConfirmAndGetSwapMapStatuses(t *testing.T) {
	cases := map[string]cryptoprov.SwapStatus{
		"completed": cryptoprov.SwapCompleted, "done": cryptoprov.SwapCompleted, "success": cryptoprov.SwapCompleted,
		"failed": cryptoprov.SwapFailed, "rejected": cryptoprov.SwapFailed, "cancelled": cryptoprov.SwapFailed,
		"pending": cryptoprov.SwapPending, "processing": cryptoprov.SwapPending, "": cryptoprov.SwapPending, "something_new": cryptoprov.SwapPending,
	}
	for in, want := range cases {
		srv, calls, _ := server(t, jsonReply(200, fmt.Sprintf(`{"data":{"id":"sw_1","status":%q,"received_amount":"5.5"}}`, in)))
		c := newClient(t, srv.URL, nil)
		sw, err := c.ConfirmSwap(context.Background(), "acct1", "qt_1")
		if err != nil || sw.Status != want || sw.ID != "sw_1" {
			t.Fatalf("status %q -> %+v, %v (want %s)", in, sw, err, want)
		}
		if (*calls)[0].method != "POST" || (*calls)[0].path != "/users/acct1/swap_quotation/qt_1/confirm" {
			t.Fatalf("confirm request = %+v", (*calls)[0])
		}
		g, err := c.GetSwap(context.Background(), "acct1", "sw_1")
		if err != nil || g.Status != want {
			t.Fatalf("get %q -> %+v, %v", in, g, err)
		}
		if (*calls)[1].method != "GET" || (*calls)[1].path != "/users/acct1/swap_transactions/sw_1" {
			t.Fatalf("get request = %+v", (*calls)[1])
		}
	}
}

func TestSwapResponseWithoutIDIsAnError(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":{"status":"completed"}}`))
	if _, err := newClient(t, srv.URL, nil).ConfirmSwap(context.Background(), "a", "q"); err == nil {
		t.Fatal("a swap with no id was accepted as executed")
	}
}

// ---- withdrawals -----------------------------------------------------------

func TestWithdrawRequestShapeAndExactAmount(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"data":{"id":"wd_5","status":"PROCESSING","txid":""}}`))
	w, err := newClient(t, srv.URL, nil).Withdraw(context.Background(), cryptoprov.WithdrawRequest{
		AccountID: "acct1", Currency: "USDT", Network: "trc20", Address: "TXyz", Tag: "999",
		Amount: dec("0.000000000000000001"), Reference: "crypto:wd:42",
	})
	if err != nil || w.ID != "wd_5" || w.Status != cryptoprov.WithdrawalProcessing {
		t.Fatalf("withdrawal = %+v, %v", w, err)
	}
	c := (*calls)[0]
	if c.method != "POST" || c.path != "/users/acct1/withdraws" {
		t.Fatalf("request = %s %s", c.method, c.path)
	}
	want := map[string]any{
		"currency": "usdt", "amount": "0.000000000000000001", "fund_uid": "TXyz", "fund_uid2": "999",
		"network": "trc20", "reference": "crypto:wd:42", "transaction_note": "crypto:wd:42",
	}
	for k, v := range want {
		if c.body[k] != v {
			t.Errorf("body[%s] = %#v, want %#v", k, c.body[k], v)
		}
	}
}

func TestWithdrawRefusesWithoutReferenceOrValidAmount(t *testing.T) {
	srv, _, n := server(t, jsonReply(200, `{}`))
	c := newClient(t, srv.URL, nil)
	base := cryptoprov.WithdrawRequest{AccountID: "a", Currency: "usdt", Network: "trc20", Address: "TX", Amount: dec("1"), Reference: "r"}
	for name, mut := range map[string]func(*cryptoprov.WithdrawRequest){
		"no reference": func(r *cryptoprov.WithdrawRequest) { r.Reference = "" },
		"zero amount":  func(r *cryptoprov.WithdrawRequest) { r.Amount = dec("0") },
		"negative":     func(r *cryptoprov.WithdrawRequest) { r.Amount = dec("-1") },
		"no address":   func(r *cryptoprov.WithdrawRequest) { r.Address = "" },
		"no account":   func(r *cryptoprov.WithdrawRequest) { r.AccountID = "" },
	} {
		r := base
		mut(&r)
		if _, err := c.Withdraw(context.Background(), r); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if atomic.LoadInt32(n) != 0 {
		t.Fatalf("invalid withdrawals reached the provider: %d", *n)
	}
}

func TestWithdrawalStatusMapping(t *testing.T) {
	cases := map[string]cryptoprov.WithdrawalStatus{
		"DONE": cryptoprov.WithdrawalDone, "done": cryptoprov.WithdrawalDone,
		"REJECTED": cryptoprov.WithdrawalRejected, "rejected": cryptoprov.WithdrawalRejected,
		"PROCESSING": cryptoprov.WithdrawalProcessing, "": cryptoprov.WithdrawalProcessing, "unknown": cryptoprov.WithdrawalProcessing,
	}
	for in, want := range cases {
		srv, calls, _ := server(t, jsonReply(200, fmt.Sprintf(`{"data":{"id":"wd_1","status":%q,"txid":"0xabc"}}`, in)))
		w, err := newClient(t, srv.URL, nil).GetWithdrawal(context.Background(), "acct1", "wd_1")
		if err != nil || w.Status != want || w.TxID != "0xabc" {
			t.Fatalf("%q -> %+v, %v (want %s)", in, w, err, want)
		}
		if (*calls)[0].path != "/users/acct1/withdraws/wd_1" {
			t.Fatalf("path = %s", (*calls)[0].path)
		}
	}
}

func TestWithdrawWithoutIDIsNotAccepted(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":{"status":"PROCESSING"}}`))
	_, err := newClient(t, srv.URL, nil).Withdraw(context.Background(), cryptoprov.WithdrawRequest{
		AccountID: "a", Currency: "usdt", Network: "trc20", Address: "TX", Amount: dec("1"), Reference: "r",
	})
	if err == nil {
		t.Fatal("a 2xx with no withdrawal id was treated as accepted")
	}
	// The call may have executed: this must read as ambiguous, never as a clean failure.
	if cryptoprov.IsDefinitive(err) {
		t.Fatal("an unreadable success must not be definitive")
	}
}

// ---- webhooks --------------------------------------------------------------

func signed(secret string, ts int64, body string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(fmt.Sprintf("%d.", ts)))
	m.Write([]byte(body))
	return fmt.Sprintf("t=%d,s=%s", ts, hex.EncodeToString(m.Sum(nil)))
}

func TestVerifyWebhook(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	c, _ := New(Config{SecretKey: "k", WebhookSecret: "whsec_test", Now: func() time.Time { return now }})
	body := `{"event":"swap_transaction.completed","data":{"id":"sw_1"}}`
	ok := map[string]string{"quidax-signature": signed("whsec_test", now.Unix(), body)}
	if err := c.VerifyWebhook(ok, []byte(body)); err != nil {
		t.Fatalf("valid webhook rejected: %v", err)
	}
	// Header names are case-insensitive on the wire.
	if err := c.VerifyWebhook(map[string]string{"Quidax-Signature": ok["quidax-signature"]}, []byte(body)); err != nil {
		t.Fatalf("mixed-case header rejected: %v", err)
	}
	for name, h := range map[string]map[string]string{
		"missing header": {},
		"wrong secret":   {"quidax-signature": signed("other", now.Unix(), body)},
		"stale":          {"quidax-signature": signed("whsec_test", now.Add(-10*time.Minute).Unix(), body)},
		"tampered":       {"quidax-signature": signed("whsec_test", now.Unix(), body+" ")},
		"garbage":        {"quidax-signature": "nonsense"},
	} {
		if err := c.VerifyWebhook(h, []byte(body)); !errors.Is(err, cryptoprov.ErrBadSignature) {
			t.Errorf("%s: err = %v, want ErrBadSignature", name, err)
		}
	}
}

func TestVerifyWebhookFailsClosedWithoutSecret(t *testing.T) {
	c, _ := New(Config{SecretKey: "k"}) // no webhook secret configured
	body := `{"event":"x"}`
	if err := c.VerifyWebhook(map[string]string{"quidax-signature": signed("", time.Now().Unix(), body)}, []byte(body)); !errors.Is(err, cryptoprov.ErrBadSignature) {
		t.Fatalf("err = %v, want ErrBadSignature", err)
	}
}

func TestParseWebhookKeysAreStableAndPerEntity(t *testing.T) {
	c, _ := New(Config{SecretKey: "k"})
	a, err := c.ParseWebhook([]byte(`{"event":"swap_transaction.completed","data":{"id":"sw_1","status":"completed"}}`))
	if err != nil || a.Type != "swap_transaction.completed" || a.Ref != "sw_1" || a.Key != "quidax:swap_transaction.completed:sw_1" {
		t.Fatalf("event = %+v, %v", a, err)
	}
	again, _ := c.ParseWebhook([]byte(`{"event":"swap_transaction.completed","data":{"id":"sw_1","status":"completed"}}`))
	if again.Key != a.Key {
		t.Fatal("dedupe key is not stable across deliveries")
	}
	other, _ := c.ParseWebhook([]byte(`{"event":"swap_transaction.completed","data":{"id":"sw_2"}}`))
	if other.Key == a.Key {
		t.Fatal("different entities share a dedupe key")
	}
	if len(a.Raw) == 0 {
		t.Fatal("raw data object must be preserved for the re-query")
	}
	for _, ev := range []string{"deposit.successful", "withdraw.successful", "withdraw.rejected", "order.done", "order.cancelled", "wallet.updated"} {
		e, err := c.ParseWebhook([]byte(fmt.Sprintf(`{"event":%q,"data":{"id":"x1"}}`, ev)))
		if err != nil || e.Type != ev {
			t.Errorf("%s -> %+v, %v", ev, e, err)
		}
	}
}

func TestParseWebhookRejectsMalformed(t *testing.T) {
	c, _ := New(Config{SecretKey: "k"})
	for _, body := range []string{``, `not json`, `{"data":{"id":"x"}}`, `{"event":"","data":{"id":"x"}}`, `{"event":"deposit.successful"}`} {
		if _, err := c.ParseWebhook([]byte(body)); err == nil {
			t.Errorf("accepted %q", body)
		}
	}
}

// ---- rate budget -----------------------------------------------------------

func TestRateBudgetDelaysTheRequestThatExceedsIt(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	var waited []time.Duration
	b := newBudget(3, func() time.Time { return now }, func(_ context.Context, d time.Duration) error {
		waited = append(waited, d)
		now = now.Add(d)
		return nil
	})
	for i := 0; i < 3; i++ {
		if err := b.take(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(waited) != 0 {
		t.Fatalf("waited inside the budget: %v", waited)
	}
	if err := b.take(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(waited) != 1 || waited[0] <= 0 || waited[0] > time.Minute {
		t.Fatalf("over-budget request waited %v, want one wait within a minute", waited)
	}
}

func TestRateBudgetDisabledAndDefault(t *testing.T) {
	c, _ := New(Config{SecretKey: "k", RateBudgetPerMinute: -1})
	if c.budget != nil {
		t.Fatal("budget should be disabled")
	}
	d, _ := New(Config{SecretKey: "k"})
	if d.budget == nil || d.budget.perMinute >= 300 {
		t.Fatalf("default budget must be below Quidax's 300/min limit, got %+v", d.budget)
	}
}

// ---- facts observed against the real sandbox (2026-10-11) -------------------

func TestTickerAcceptsTheRealSandboxShape(t *testing.T) {
	// data.<market>.ticker.last is a JSON number with 16 decimals; some fields are strings.
	srv, _, _ := server(t, jsonReply(200, `{"status":"success","message":"Successful","data":{"usdtngn":{"ticker":{"high":"1367","last":1363.5000000000000000,"buy":1363.5},"at":1791736915000}}}`))
	tk, err := newClient(t, srv.URL, nil).Ticker(context.Background(), "USDTNGN")
	if err != nil || !tk.Last.Equal(dec("1363.5")) {
		t.Fatalf("ticker = %+v, %v", tk, err)
	}
}

func TestHTTP200WithErrorStatusIsADefinitiveRefusal(t *testing.T) {
	// Quidax answers some refusals with HTTP 200 and {"status":"error","data":{"code","message"}}.
	body := `{"status":"error","message":"This feature is currently disabled for you.","data":{"code":"140017","message":"This feature is currently disabled for you."}}`
	srv, _, n := server(t, jsonReply(200, body))
	_, err := newClient(t, srv.URL, &slept{}).Withdraw(context.Background(), cryptoprov.WithdrawRequest{
		AccountID: "a", Currency: "usdt", Network: "trc20", Address: "TX", Amount: dec("1"), Reference: "r",
	})
	var api *cryptoprov.APIError
	if !errors.As(err, &api) || api.Code != "140017" || !strings.Contains(api.Message, "disabled") {
		t.Fatalf("err = %#v", err)
	}
	if !cryptoprov.IsDefinitive(err) {
		t.Fatal("a status:error refusal did not execute and must be definitive")
	}
	if atomic.LoadInt32(n) != 1 {
		t.Fatalf("refusal was retried: %d", *n)
	}
}

func TestErrorCodeAndMessageAreReadFromTheDataObject(t *testing.T) {
	srv, _, _ := server(t, jsonReply(404, `{"status":"error","message":"Swap transaction not found.","data":{"code":"E0605","message":"Swap transaction not found."}}`))
	_, err := newClient(t, srv.URL, nil).GetSwap(context.Background(), "a", "sw")
	var api *cryptoprov.APIError
	if !errors.As(err, &api) || api.Code != "E0605" || api.Status != 404 {
		t.Fatalf("err = %#v", err)
	}
}

func TestQuoteExpiryWithMillisecondsParses(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"status":"success","data":{"id":"62e8","confirmed":false,"from_currency":"USDT","to_currency":"NGN","quoted_price":"1349.86","from_amount":"1.0","to_amount":"1349.86","expires_at":"2026-10-11T16:42:12.916Z"}}`))
	q, err := newClient(t, srv.URL, nil).QuoteSwap(context.Background(), cryptoprov.SwapQuoteRequest{AccountID: "me", From: "usdt", To: "ngn", FromAmount: dec("1")})
	if err != nil || q.From != "USDT" || !q.ExpiresAt.Equal(time.Date(2026, 10, 11, 16, 42, 12, 916_000_000, time.UTC)) {
		t.Fatalf("quote = %+v, %v", q, err)
	}
}
