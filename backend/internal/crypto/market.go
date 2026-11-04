package crypto

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"
)

// MarketSnapshot is one asset's 24h market read, as the feed reports it. All money is
// NGN kobo per ONE WHOLE asset unit; a zero field means the feed does not report it,
// and callers must render "unavailable" rather than guess.
type MarketSnapshot struct {
	PriceKobo  int64
	OpenKobo   int64 // 24h opening price → the client derives the % change from this
	HighKobo   int64
	LowKobo    int64
	VolumeKobo int64 // traded value over 24h, in kobo (base volume × last, priced to NGN)
	AsOf       time.Time
}

// MarketFeed is the optional bulk seam on a PriceProvider: one call returns every
// market the provider quotes. Without it a market list would be one HTTP request
// per asset per page load.
type MarketFeed interface {
	Markets(ctx context.Context) (map[string]MarketSnapshot, error)
}

// marketCacheTTL bounds how often a page load hits the exchange. The assets list,
// the detail screen and the portfolio all read the same book, so without this each
// refresh would re-fetch the tickers per screen.
const marketCacheTTL = 30 * time.Second

// Markets returns the provider's bulk ticker book, cached for marketCacheTTL.
// Symbols the provider does not quote are ABSENT — callers treat that as "no price",
// which blocks trading for that asset rather than pricing it off a guess. On a
// provider error the last good book is kept: a stale price is honest as long as its
// AsOf travels with it, while dropping every price would blank the whole market list.
func (s *Service) Markets(ctx context.Context) map[string]MarketSnapshot {
	feed, ok := s.price.(MarketFeed)
	if !ok {
		return map[string]MarketSnapshot{}
	}
	now := time.Now()
	s.marketMu.Lock()
	defer s.marketMu.Unlock()
	if s.marketBook != nil && now.Sub(s.marketFetchedAt) < marketCacheTTL {
		return s.marketBook
	}
	book, err := feed.Markets(ctx)
	if err != nil || len(book) == 0 {
		if s.marketBook != nil {
			return s.marketBook
		}
		return map[string]MarketSnapshot{}
	}
	s.marketBook = book
	s.marketFetchedAt = now
	return book
}

// marketOf looks one symbol up in the cached book (uppercase symbol keys).
func (s *Service) marketOf(ctx context.Context, symbol string) (MarketSnapshot, bool) {
	m, ok := s.Markets(ctx)[strings.ToUpper(strings.TrimSpace(symbol))]
	return m, ok
}

// quidaxTickersPath is the public ticker book: every market in one response.
// Verified against the live API (docs/crypto/DISCOVERY.md).
const quidaxTickersPath = "/markets/tickers"

// Markets implements MarketFeed for Quidax. The ticker payload mixes JSON numbers
// and numeric strings (last is a number, open/vol are strings), so every value is
// decoded as `any` and re-read as an exact decimal before it becomes kobo.
func (q *quidaxProvider) Markets(ctx context.Context) (map[string]MarketSnapshot, error) {
	code, raw, err := q.do(ctx, http.MethodGet, quidaxTickersPath, nil)
	if err != nil {
		return nil, err
	}
	if code < 200 || code >= 300 {
		return nil, fmt.Errorf("quidax: ticker book http %d: %s", code, snippet(raw))
	}
	return parseQuidaxTickers(raw)
}

// parseQuidaxTickers turns the ticker book into symbol-keyed snapshots, keeping only
// the naira-quoted markets this product trades against.
func parseQuidaxTickers(raw []byte) (map[string]MarketSnapshot, error) {
	var out struct {
		Data map[string]struct {
			Ticker map[string]any `json:"ticker"`
			At     any            `json:"at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("quidax: ticker book decode: %w", err)
	}
	if len(out.Data) == 0 {
		return nil, errors.New("quidax: empty ticker book")
	}
	book := make(map[string]MarketSnapshot, len(out.Data))
	for market, entry := range out.Data {
		sym, isNGN := strings.CutSuffix(strings.ToUpper(strings.TrimSpace(market)), "NGN")
		if !isNGN || sym == "" {
			continue
		}
		last := koboFromNaira(entry.Ticker["last"])
		if last <= 0 {
			continue
		}
		snap := MarketSnapshot{
			PriceKobo: last,
			OpenKobo:  koboFromNaira(entry.Ticker["open"]),
			HighKobo:  koboFromNaira(entry.Ticker["high"]),
			LowKobo:   koboFromNaira(entry.Ticker["low"]),
			AsOf:      millisToTime(entry.At),
		}
		// vol is quoted in BASE units (1.08 BTC, 3.0M USDT), so the NGN turnover is
		// vol × last — exact decimal math, never a float multiply.
		if base, errB := decimalOf(entry.Ticker["vol"]); errB == nil && base.Sign() > 0 {
			if lastRat, errL := decimalOf(entry.Ticker["last"]); errL == nil {
				if turnover := new(big.Rat).Mul(base, lastRat); turnover.Sign() > 0 {
					snap.VolumeKobo = koboOf(turnover)
				}
			}
		}
		book[sym] = snap
	}
	if len(book) == 0 {
		return nil, errors.New("quidax: ticker book has no naira markets")
	}
	return book, nil
}

// decimalOf reads a provider number that may arrive as a JSON number or a numeric
// string, exactly — no float64 in the money path.
func decimalOf(v any) (*big.Rat, error) {
	switch t := v.(type) {
	case string:
		r, ok := new(big.Rat).SetString(strings.TrimSpace(t))
		if !ok {
			return nil, errors.New("crypto: not a decimal string")
		}
		return r, nil
	case json.Number:
		r, ok := new(big.Rat).SetString(t.String())
		if !ok {
			return nil, errors.New("crypto: not a decimal number")
		}
		return r, nil
	case float64:
		r := new(big.Rat).SetFloat64(t)
		if r == nil {
			return nil, errors.New("crypto: unrepresentable float")
		}
		return r, nil
	default:
		return nil, errors.New("crypto: unsupported json type for a decimal")
	}
}

// koboFromNaira prices a naira quantity into integer kobo; unreadable or
// non-positive values read as 0 = "the feed does not report this".
func koboFromNaira(v any) int64 {
	r, err := decimalOf(v)
	if err != nil || r.Sign() <= 0 {
		return 0
	}
	return koboOf(r)
}

// koboOf converts naira to kobo (×100), rounded to the nearest kobo.
func koboOf(naira *big.Rat) int64 {
	k := new(big.Rat).Mul(naira, big.NewRat(100, 1))
	k.Add(k, big.NewRat(1, 2)) // round half up, then floor by integer division
	i := new(big.Int).Quo(k.Num(), k.Denom())
	if !i.IsInt64() {
		return 0
	}
	return i.Int64()
}

func millisToTime(v any) time.Time {
	switch t := v.(type) {
	case json.Number:
		if ms, err := t.Int64(); err == nil && ms > 0 {
			return time.UnixMilli(ms).UTC()
		}
	case float64:
		if t > 0 {
			return time.UnixMilli(int64(t)).UTC()
		}
	}
	return time.Time{}
}

// Markets implements MarketFeed for the deterministic mock: its fixed prices, and NO
// 24h open/high/low/volume, because the mock has no market history to report. Those
// zeros are what make the UI say "unavailable" instead of inventing a trend. Symbols
// outside the fixed table stay unpriced, so the mock no longer hands out a
// hash-derived price for any asset an admin happens to add.
func (m *MockPriceProvider) Markets(_ context.Context) (map[string]MarketSnapshot, error) {
	book := make(map[string]MarketSnapshot, len(m.prices))
	now := time.Now().UTC()
	for sym, kobo := range m.prices {
		book[strings.ToUpper(sym)] = MarketSnapshot{PriceKobo: kobo, AsOf: now}
	}
	return book, nil
}
