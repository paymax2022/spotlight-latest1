package crypto

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// liveTickersBody is the recorded shape of GET /markets/tickers: `last` arrives as a
// JSON number while `open`/`high`/`low`/`vol` arrive as numeric strings, and `at` is
// epoch milliseconds. A provider that changes one of those types must not silently
// become "no price".
const liveTickersBody = `{"status":"success","message":"Successful","data":{
	"usdtngn":{"ticker":{"high":"1383.05","vol":"3015250.24624889","last":1377.34,"low":"1376.59","buy":1377.34,"sell":1378,"open":"1380.1"},"at":1793811745000},
	"btcngn":{"ticker":{"high":"111806579","vol":"1.08156625","last":110511835,"low":"104777805","buy":110503461,"sell":111039843,"open":"107165212"},"at":1793811745000},
	"ethusd":{"ticker":{"last":"3000"},"at":1793811745000}
}}`

func TestParseQuidaxTickers(t *testing.T) {
	book, err := parseQuidaxTickers([]byte(liveTickersBody))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(book) != 2 {
		t.Fatalf("want 2 naira markets, got %d: %v", len(book), book)
	}
	btc := book["BTC"]
	if btc.PriceKobo != 11_051_183_500 {
		t.Errorf("BTC last = %d kobo, want 11051183500 (₦110,511,835)", btc.PriceKobo)
	}
	if btc.OpenKobo != 10_716_521_200 {
		t.Errorf("BTC open = %d kobo, want 10716521200", btc.OpenKobo)
	}
	if btc.HighKobo != 11_180_657_900 || btc.LowKobo != 10_477_780_500 {
		t.Errorf("BTC range = %d..%d, want 11180657900..10477780500", btc.HighKobo, btc.LowKobo)
	}
	// vol is BASE units: 1.08156625 BTC × ₦110,511,835 ≈ ₦119,525,881 → 11,952,588,100 kobo
	if btc.VolumeKobo < 11_950_000_000 || btc.VolumeKobo > 11_960_000_000 {
		t.Errorf("BTC 24h turnover = %d kobo, want ≈11952588100", btc.VolumeKobo)
	}
	if btc.AsOf.IsZero() {
		t.Error("BTC AsOf must come from the payload `at`")
	}
	usdt := book["USDT"]
	if usdt.PriceKobo != 137_734 {
		t.Errorf("USDT last = %d kobo, want 137734 (₦1,377.34)", usdt.PriceKobo)
	}
	// vol 3,015,250.24624889 USDT × ₦1,377.34 ≈ ₦4,153,024,435 → 415,302,443,500 kobo
	if usdt.VolumeKobo < 415_000_000_000 || usdt.VolumeKobo > 416_000_000_000 {
		t.Errorf("USDT turnover = %d kobo, want ≈415302443500", usdt.VolumeKobo)
	}
	if _, ok := book["ETH"]; ok {
		t.Error("ETHUSD must be skipped — this product trades against naira only")
	}
}

func TestParseQuidaxTickersRejectsUnusableBooks(t *testing.T) {
	for name, body := range map[string]string{
		"empty data":  `{"status":"success","data":{}}`,
		"no naira":    `{"status":"success","data":{"ethusd":{"ticker":{"last":3000}}}}`,
		"zero last":   `{"status":"success","data":{"btcngn":{"ticker":{"last":0}}}}`,
		"not json":    `{`,
		"string last": `{"status":"success","data":{"btcngn":{"ticker":{"last":"110511835"}}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			book, err := parseQuidaxTickers([]byte(body))
			if name == "string last" {
				if err != nil {
					t.Fatalf("a numeric string is a valid price: %v", err)
				}
				if book["BTC"].PriceKobo != 11_051_183_500 {
					t.Fatalf("BTC = %d, want 11051183500", book["BTC"].PriceKobo)
				}
				return
			}
			if err == nil {
				t.Fatalf("want an error, got book %v", book)
			}
		})
	}
}

func TestQuidaxMarketsSendsNoBodyAndParsesBook(t *testing.T) {
	rt := &rtFunc{status: 200, body: liveTickersBody}
	q := newTestQuidax(rt, false)
	book, err := q.Markets(context.Background())
	if err != nil {
		t.Fatalf("Markets: %v", err)
	}
	if rt.lastReq == nil || rt.lastReq.Method != http.MethodGet {
		t.Fatalf("want a GET, got %+v", rt.lastReq)
	}
	if rt.lastRaw != "" {
		t.Errorf("the ticker book must be a bodyless GET, sent %q", rt.lastRaw)
	}
	if got := len(book); got != 2 {
		t.Errorf("book size = %d, want 2", got)
	}
}

// priceCallCountingFeed counts how often the bulk seam is hit, which is the whole
// point of the cache: one page load across list + detail + portfolio is one fetch.
type countingFeed struct {
	calls int
}

func (f *countingFeed) PriceKobo(_ context.Context, symbol string) (int64, bool) {
	if symbol == "BTC" {
		return 11_051_183_500, true
	}
	return 0, false
}
func (f *countingFeed) Name() string { return "counting" }
func (f *countingFeed) Markets(_ context.Context) (map[string]MarketSnapshot, error) {
	f.calls++
	return map[string]MarketSnapshot{"BTC": {PriceKobo: 11_051_183_500, OpenKobo: 10_716_521_200, AsOf: time.Now().UTC()}}, nil
}

func TestServiceMarketsCachesTheBook(t *testing.T) {
	feed := &countingFeed{}
	s := &Service{price: feed}
	for i := 0; i < 3; i++ {
		book := s.Markets(context.Background())
		if len(book) != 1 {
			t.Fatalf("book = %v, want one market", book)
		}
	}
	if feed.calls != 1 {
		t.Errorf("bulk fetches = %d, want 1 (the 30s TTL must cover list+detail+portfolio)", feed.calls)
	}
}
