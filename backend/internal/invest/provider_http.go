package invest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Real provider adapters (HTTP/JSON). These implement the same MarketDataAdapter
// / BrokerAdapter interfaces as the mocks, so swapping them in is a config
// change — no business-logic change. They speak a documented generic JSON
// contract; point them at the partner's gateway (or a thin shim that maps the
// partner API onto this contract).
//
// All prices on the wire are in NAIRA (major units, decimal); we convert to
// integer kobo at the boundary so the rest of the system stays kobo-only.
// ─────────────────────────────────────────────────────────────────────────────

func nairaToKoboF(naira float64) int64 { return int64(naira*100 + 0.5) }

// HealthChecker is implemented by adapters that can report connectivity.
type HealthChecker interface {
	Healthy(ctx context.Context) (bool, string)
}

// ── Market-data adapter ──────────────────────────────────────────────────────

// HTTPMarketDataConfig configures the real market-data adapter.
type HTTPMarketDataConfig struct {
	BaseURL string // e.g. https://md.partner.example/v1
	APIKey  string // Bearer token
	Timeout time.Duration
}

type HTTPMarketData struct {
	cfg    HTTPMarketDataConfig
	client *http.Client
}

func NewHTTPMarketData(cfg HTTPMarketDataConfig) *HTTPMarketData {
	if cfg.Timeout == 0 {
		cfg.Timeout = 8 * time.Second
	}
	return &HTTPMarketData{cfg: cfg, client: &http.Client{Timeout: cfg.Timeout}}
}

func (m *HTTPMarketData) Name() string { return "http-market-data" }

// Expected GET {base}/quote?symbol=SYM → 200
//
//	{ "symbol":"SYM","price":47.5,"prev_close":46.9,"high_52w":60,"low_52w":35,
//	  "volume":250000,"market_status":"open" }
func (m *HTTPMarketData) GetQuote(ctx context.Context, providerSymbol string) (Quote, error) {
	var body struct {
		Symbol       string  `json:"symbol"`
		Price        float64 `json:"price"`
		PrevClose    float64 `json:"prev_close"`
		High52       float64 `json:"high_52w"`
		Low52        float64 `json:"low_52w"`
		Volume       int64   `json:"volume"`
		MarketStatus string  `json:"market_status"`
	}
	if err := m.get(ctx, "/quote?symbol="+url.QueryEscape(providerSymbol), &body); err != nil {
		return Quote{}, err
	}
	price := nairaToKoboF(body.Price)
	prev := nairaToKoboF(body.PrevClose)
	change := price - prev
	var pct float64
	if prev != 0 {
		pct = float64(change) / float64(prev) * 100
	}
	status := body.MarketStatus
	if status == "" {
		status = "closed"
	}
	return Quote{
		Symbol: providerSymbol, PriceKobo: price, PrevCloseKobo: prev, DayChangeKobo: change,
		DayChangePct: pct, High52Kobo: nairaToKoboF(body.High52), Low52Kobo: nairaToKoboF(body.Low52),
		Volume: body.Volume, MarketStatus: status, DataStatus: "real_time", AsOf: time.Now().UTC(),
	}, nil
}

// Expected GET {base}/candles?symbol=SYM&range=1m → 200
//
//	{ "candles":[{"t":1700000000,"o":47,"h":48,"l":46,"c":47.5,"v":1000}, ...] }
func (m *HTTPMarketData) GetHistorical(ctx context.Context, providerSymbol, rng string) ([]Candle, error) {
	var body struct {
		Candles []struct {
			T int64   `json:"t"`
			O float64 `json:"o"`
			H float64 `json:"h"`
			L float64 `json:"l"`
			C float64 `json:"c"`
			V int64   `json:"v"`
		} `json:"candles"`
	}
	if err := m.get(ctx, "/candles?symbol="+url.QueryEscape(providerSymbol)+"&range="+url.QueryEscape(rng), &body); err != nil {
		return nil, err
	}
	out := make([]Candle, 0, len(body.Candles))
	for _, c := range body.Candles {
		out = append(out, Candle{T: c.T, OpenKobo: nairaToKoboF(c.O), HighKobo: nairaToKoboF(c.H),
			LowKobo: nairaToKoboF(c.L), CloseKobo: nairaToKoboF(c.C), Volume: c.V})
	}
	return out, nil
}

func (m *HTTPMarketData) GetMarketStatus(ctx context.Context) (string, error) {
	var body struct {
		Status string `json:"status"`
	}
	if err := m.get(ctx, "/market-status", &body); err != nil {
		return "closed", err
	}
	if body.Status == "" {
		return "closed", nil
	}
	return body.Status, nil
}

func (m *HTTPMarketData) Healthy(ctx context.Context) (bool, string) {
	if _, err := m.GetMarketStatus(ctx); err != nil {
		return false, err.Error()
	}
	return true, "ok"
}

func (m *HTTPMarketData) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(m.cfg.BaseURL, "/")+path, nil)
	if err != nil {
		return err
	}
	if m.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+m.cfg.APIKey)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("market-data: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("market-data: status %d: %s", resp.StatusCode, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// ── Broker adapter ───────────────────────────────────────────────────────────

type HTTPBrokerConfig struct {
	BaseURL       string
	APIKey        string
	WebhookSecret string // HMAC-SHA256 secret for inbound webhooks
	Timeout       time.Duration
}

type HTTPBroker struct {
	cfg    HTTPBrokerConfig
	client *http.Client
}

func NewHTTPBroker(cfg HTTPBrokerConfig) *HTTPBroker {
	if cfg.Timeout == 0 {
		cfg.Timeout = 12 * time.Second
	}
	return &HTTPBroker{cfg: cfg, client: &http.Client{Timeout: cfg.Timeout}}
}

func (b *HTTPBroker) Name() string { return "http-broker" }

// SubmitBuyOrder POST {base}/orders → 200/201
//
//	req:  { "side":"buy","symbol":"SYM","order_type":"market","quantity":10,
//	        "amount_kobo":..., "limit_price_kobo":..., "idempotency_key":"..." }
//	resp: { "provider_reference":"abc","accepted":true,"status":"filled",
//	        "executed_price":47.5,"filled_quantity":10,"reason":"" }
func (b *HTTPBroker) SubmitBuyOrder(ctx context.Context, o Order, _ Quote) (BrokerOrderResult, error) {
	return b.submit(ctx, o, "buy")
}

func (b *HTTPBroker) SubmitSellOrder(ctx context.Context, o Order, _ Quote) (BrokerOrderResult, error) {
	return b.submit(ctx, o, "sell")
}

func (b *HTTPBroker) submit(ctx context.Context, o Order, side string) (BrokerOrderResult, error) {
	payload := map[string]any{
		"side": side, "symbol": o.Symbol, "order_type": string(o.OrderType),
		"quantity": o.Quantity, "amount_kobo": o.AmountKobo, "limit_price_kobo": o.LimitPriceKobo,
		"idempotency_key": o.IdempotencyKey,
	}
	var resp struct {
		ProviderReference string  `json:"provider_reference"`
		Accepted          bool    `json:"accepted"`
		Status            string  `json:"status"`
		ExecutedPrice     float64 `json:"executed_price"`
		FilledQuantity    float64 `json:"filled_quantity"`
		Reason            string  `json:"reason"`
	}
	if err := b.post(ctx, "/orders", payload, &resp); err != nil {
		return BrokerOrderResult{}, err
	}
	return BrokerOrderResult{
		ProviderReference: resp.ProviderReference, Accepted: resp.Accepted, Status: resp.Status,
		ExecutedPriceKobo: nairaToKoboF(resp.ExecutedPrice), FilledQuantity: resp.FilledQuantity,
		Reason: resp.Reason,
	}, nil
}

func (b *HTTPBroker) CancelOrder(ctx context.Context, providerReference string) error {
	return b.post(ctx, "/orders/"+url.PathEscape(providerReference)+"/cancel", map[string]any{}, &struct{}{})
}

func (b *HTTPBroker) Healthy(ctx context.Context) (bool, string) {
	// A lightweight GET /health on the broker gateway.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(b.cfg.BaseURL, "/")+"/health", nil)
	if err != nil {
		return false, err.Error()
	}
	if b.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+b.cfg.APIKey)
	}
	resp, err := b.client.Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Sprintf("status %d", resp.StatusCode)
	}
	return true, "ok"
}

// WebhookSecret exposes the configured HMAC secret for the webhook handler.
func (b *HTTPBroker) WebhookSecret() string { return b.cfg.WebhookSecret }

func (b *HTTPBroker) post(ctx context.Context, path string, payload, out any) error {
	buf, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(b.cfg.BaseURL, "/")+path, strings.NewReader(string(buf)))
	if err != nil {
		return err
	}
	if b.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+b.cfg.APIKey)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("broker: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bb, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("broker: status %d: %s", resp.StatusCode, string(bb))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
