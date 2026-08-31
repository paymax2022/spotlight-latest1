package mycover

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"spotlight/backend/internal/insurance/gateway"
)

// ════════════════════════════════════════════════════════════════════════════
// THE SEAM: what the client submits vs what the provider is sent
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover's form inputs are denominated in NAIRA. The internal contract — and
// the mobile app — carry every money value as INTEGER KOBO. Nothing converted
// between them, so a declared value reached the insurer 100x too large.
//
// Verified live against product ffb0711c-1e4a-453b-a26c-2726e0a1a7bb (gadget
// cover, rated at 5% of the declared value):
//
//	body.value = 200000    → {"data":{"price":10000}}
//	body.value = 20000000  → {"data":{"price":1000000}}
//
// percentageRatedProvider replays exactly that arithmetic so the assertion below
// is the same one the live API answers.

// percentageRatedProvider is a stand-in for MyCover's compute-price on a
// percentage-rated product: premium = value × rate, in naira, exactly as the
// live endpoint above.
func percentageRatedProvider(t *testing.T, ratePercent int64, capture *map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Body map[string]any `json:"body"`
		}
		dec := json.NewDecoder(r.Body)
		dec.UseNumber() // the provider sees exactly what we wrote on the wire
		_ = dec.Decode(&in)
		if capture != nil {
			*capture = in.Body
		}
		// The provider's `value` is a NAIRA number, whole or decimal. Price it in
		// exact minor units so the fake never introduces rounding the real API
		// would not have.
		valueKobo := int64(0)
		if n, ok := in.Body["value"].(json.Number); ok {
			k, err := NairaToKobo(n.String())
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"responseCode":400,"responseText":["bad value"]}`))
				return
			}
			valueKobo = k
		}
		premiumKobo := valueKobo * ratePercent / 100
		_, _ = fmt.Fprintf(w, `{"responseCode":1,"responseText":"Price computed successfully","data":{"price":%s}}`,
			KoboToNaira(premiumKobo))
	}))
}

func gadgetProduct() gateway.ProviderProduct {
	return gateway.ProviderProduct{
		Code:              "mcg-gadget-cover",
		ProviderProductID: "ffb0711c-1e4a-453b-a26c-2726e0a1a7bb",
		IsPercentage:      true,
		RateBps:           500, // 5%
		CommissionBps:     1000,
		Underwriter:       "Sovereign Trust Insurance Plc",
		FormSchemaKnown:   true,
		MoneyInputPaths:   []string{"value"},
	}
}

// TestGetQuote_DeclaredValueReachesTheProviderInNaira is THE regression test.
// A ₦200,000 phone must be quoted at ₦10,000, never at ₦1,000,000.
func TestGetQuote_DeclaredValueReachesTheProviderInNaira(t *testing.T) {
	cases := []struct {
		name             string
		ratePercent      int64
		declaredKobo     int64
		wantProviderSees string
		wantPremiumKobo  int64
	}{
		{
			name:             "the live gadget case: ₦200,000 at 5%",
			ratePercent:      5,
			declaredKobo:     20_000_000, // ₦200,000
			wantProviderSees: "200000",
			wantPremiumKobo:  1_000_000, // ₦10,000 — NOT ₦1,000,000 (100_000_000 kobo)
		},
		{
			name:             "the published minimum: ₦100,000 at 5%",
			ratePercent:      5,
			declaredKobo:     10_000_000,
			wantProviderSees: "100000",
			wantPremiumKobo:  500_000, // ₦5,000
		},
		{
			name:             "a large cover: ₦100,000,000 at 2%",
			ratePercent:      2,
			declaredKobo:     10_000_000_000,
			wantProviderSees: "100000000",
			wantPremiumKobo:  200_000_000, // ₦2,000,000
		},
		{
			name:             "a value with kobo: ₦12.50 at 5%",
			ratePercent:      100,
			declaredKobo:     1_250,
			wantProviderSees: "12.5",
			wantPremiumKobo:  1_250,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body map[string]any
			srv := percentageRatedProvider(t, tc.ratePercent, &body)
			defer srv.Close()

			p := gadgetProduct()
			p.RateBps = tc.ratePercent * 100

			c := New("k", "", "", srv.URL)
			q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
				Product: p,
				Inputs: map[string]any{
					"value":       tc.declaredKobo,
					"device_make": "Samsung",
				},
			})
			if err != nil {
				t.Fatalf("GetQuote: %v", err)
			}

			gotOnWire := fmt.Sprint(body["value"])
			if gotOnWire != tc.wantProviderSees {
				t.Fatalf("provider saw value=%s, want %s naira (we hold %d kobo)",
					gotOnWire, tc.wantProviderSees, tc.declaredKobo)
			}
			if body["device_make"] != "Samsung" {
				t.Fatalf("non-money answers must be untouched: %v", body)
			}
			if q.PremiumKobo != tc.wantPremiumKobo {
				t.Fatalf("premium = %d kobo (₦%d), want %d kobo (₦%d)",
					q.PremiumKobo, q.PremiumKobo/100, tc.wantPremiumKobo, tc.wantPremiumKobo/100)
			}
			// The exact shape of the bug: 100x the correct premium.
			if q.PremiumKobo == tc.wantPremiumKobo*100 {
				t.Fatalf("premium is 100x the correct figure — kobo reached the provider as naira")
			}
		})
	}
}

// TestGetQuote_MisclassifiedMoneyFieldRoundTripsToIdentity — `money` is a
// NAME-BASED heuristic (mapFieldType matches value/amount/price/sum/…), so it
// can be wrong. Symmetry is what makes that safe: the client scales by 100
// because the schema SAID money, and the adapter divides by 100 for exactly the
// fields the schema said money, so a wrong label cancels itself out.
func TestGetQuote_MisclassifiedMoneyFieldRoundTripsToIdentity(t *testing.T) {
	// `sum_of_dependants` is not money at all, but "sum" trips the heuristic. The
	// client therefore submits 3 dependants as 300 kobo.
	const dependants = 3
	clientSubmits := int64(dependants * 100)

	var body map[string]any
	srv := percentageRatedProvider(t, 5, &body)
	defer srv.Close()

	p := gadgetProduct()
	p.MoneyInputPaths = []string{"value", "sum_of_dependants"}

	c := New("k", "", "", srv.URL)
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: p,
		Inputs: map[string]any{
			"value":             int64(20_000_000),
			"sum_of_dependants": clientSubmits,
		},
	}); err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if got := fmt.Sprint(body["sum_of_dependants"]); got != fmt.Sprint(dependants) {
		t.Fatalf("a misclassified field must round-trip to identity: sent %d, provider saw %s, want %d",
			clientSubmits, got, dependants)
	}
}

// TestBindPolicy_DeclaredValueReachesTheProviderInNaira — bind replays the
// quote-time answers, which are stored in KOBO. The purchase must convert them
// the same way the quote did, or a member is charged for one cover and issued
// another.
func TestBindPolicy_DeclaredValueReachesTheProviderInNaira(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		_ = dec.Decode(&body)
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"policy_id":"pol-1","status":"active","premium":"10000.0000"}}`))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	inputs := map[string]any{"value": int64(20_000_000), "device_make": "Samsung"}
	pol, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product:     gadgetProduct(),
		Currency:    "NGN",
		PremiumKobo: 1_000_000,
		Inputs:      inputs,
	})
	if err != nil {
		t.Fatalf("BindPolicy: %v", err)
	}
	if got := fmt.Sprint(body["value"]); got != "200000" {
		t.Fatalf("provider saw value=%s, want 200000 naira", got)
	}
	if pol.PremiumKobo != 1_000_000 {
		t.Fatalf("premium = %d kobo, want 1000000 (₦10,000)", pol.PremiumKobo)
	}
	// The stored quote answers are replayed on every retry; converting them in
	// place would divide again on the second attempt.
	if fmt.Sprint(inputs["value"]) != "20000000" {
		t.Fatalf("bind mutated the stored quote inputs: %v", inputs)
	}
}

// TestGetQuote_RefusesWhenTheMoneySpecIsUnknown — the conversion is only safe
// because it keys off the SAME schema the client rendered. Without that schema
// we do not know which inputs are money, and sending them unconverted is the
// original bug. Fail closed.
func TestGetQuote_RefusesWhenTheMoneySpecIsUnknown(t *testing.T) {
	srv := percentageRatedProvider(t, 5, nil)
	defer srv.Close()

	p := gadgetProduct()
	p.FormSchemaKnown = false
	p.MoneyInputPaths = nil

	c := New("k", "", "", srv.URL)
	_, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: p,
		Inputs:  map[string]any{"value": int64(20_000_000)},
	})
	if !errors.Is(err, ErrNoFormSchema) {
		t.Fatalf("want ErrNoFormSchema, got %v", err)
	}

	_, err = c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: p,
		Inputs:  map[string]any{"value": int64(20_000_000)},
	})
	if !errors.Is(err, ErrNoFormSchema) {
		t.Fatalf("bind: want ErrNoFormSchema, got %v", err)
	}
}

// TestGetQuote_RefusesAnUnconvertibleMoneyAnswer — a money field we cannot scale
// exactly stops the quote instead of being forwarded raw.
func TestGetQuote_RefusesAnUnconvertibleMoneyAnswer(t *testing.T) {
	srv := percentageRatedProvider(t, 5, nil)
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	_, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gadgetProduct(),
		Inputs:  map[string]any{"value": "two hundred thousand"},
	})
	if err == nil {
		t.Fatal("an unconvertible money answer must fail the quote, not reach the insurer")
	}
}

// ════════════════════════════════════════════════════════════════════════════
// THE SEAM PIN
// ════════════════════════════════════════════════════════════════════════════
//
// This bug existed because each side of the boundary assumed the other did the
// conversion, and nothing in either tree said which unit crossed it. Both sides
// now DECLARE the wire unit, and this test fails if they ever stop agreeing.

// TestSeam_MobileSubmitsTheUnitTheAdapterExpects reads the mobile form engine's
// declared wire unit and compares it with the Go contract's. A change on either
// side without the other is the exact defect this pins.
func TestSeam_MobileSubmitsTheUnitTheAdapterExpects(t *testing.T) {
	const formEnginePath = "../../../../mobile-app/reactnative/src/features/insurance/live/formEngine.ts"
	src, err := os.ReadFile(formEnginePath)
	if err != nil {
		t.Fatalf("cannot read the mobile side of the seam (%s): %v", formEnginePath, err)
	}
	re := regexp.MustCompile(`MONEY_WIRE_UNIT\s*=\s*'([a-z]+)'`)
	m := re.FindSubmatch(src)
	if m == nil {
		t.Fatalf("%s no longer declares MONEY_WIRE_UNIT — the seam is undocumented again", formEnginePath)
	}
	mobileUnit := string(m[1])
	if mobileUnit != gateway.MoneyInputWireUnit {
		t.Fatalf("SEAM BROKEN: mobile submits money inputs in %q, the adapter converts FROM %q. "+
			"One of the two is now applying the wrong scale to every declared value.",
			mobileUnit, gateway.MoneyInputWireUnit)
	}
	if !strings.Contains(string(src), "MONEY_WIRE_UNIT") {
		t.Fatal("unreachable")
	}
}
