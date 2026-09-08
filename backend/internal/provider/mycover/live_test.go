package mycover

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"spotlight/backend/internal/insurance/gateway"
)

// ════════════════════════════════════════════════════════════════════════════
// LIVE PROVIDER TESTS
// ════════════════════════════════════════════════════════════════════════════
//
// These exercise the REAL MyCover API. They SKIP unless a key is available, so
// CI and offline runs are unaffected; run them with a key present to prove the
// adapter actually talks to the provider rather than to a fixture.
//
// They are strictly READ-ONLY. No test here purchases anything: a purchase
// debits Paymax's prefunded distributor wallet and creates a real policy record.
//
// The key is read from the environment or backend/.env and is NEVER printed,
// logged, or asserted on beyond its presence.

func liveClient(t *testing.T) *Client {
	t.Helper()
	key := os.Getenv("INSURANCE_MYCOVER_API_KEY")
	base := os.Getenv("INSURANCE_MYCOVER_BASE_URL")
	if key == "" {
		key, base = keysFromDotEnv(t)
	}
	if key == "" {
		t.Skip("INSURANCE_MYCOVER_API_KEY not set — skipping live provider test")
	}
	t.Logf("live MyCover key present (length %d), base URL %q", len(key), baseOrDefault(base))
	return New(key, "", "", base)
}

func baseOrDefault(b string) string {
	if b == "" {
		return defaultBaseURL
	}
	return b
}

// keysFromDotEnv reads backend/.env when the variables are not exported. It
// returns the VALUES to the client and never to the log.
func keysFromDotEnv(t *testing.T) (key, base string) {
	t.Helper()
	for _, path := range []string{".env", "../../../.env"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			v = strings.Trim(strings.TrimSpace(v), `"'`)
			switch strings.TrimSpace(k) {
			case "INSURANCE_MYCOVER_API_KEY":
				key = v
			case "INSURANCE_MYCOVER_BASE_URL":
				base = v
			}
		}
		if key != "" {
			return key, base
		}
	}
	return "", ""
}

// TestLive_ListProducts proves the whole live catalog comes back THROUGH THE
// ADAPTER — normalised, with money already in kobo — not merely through curl.
func TestLive_ListProducts(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	products, total, err := c.ListProducts(ctx, 1, 100)
	if err != nil {
		t.Fatalf("live ListProducts: %v", err)
	}
	t.Logf("live catalog: %d products returned, provider total_count %d", len(products), total)
	if len(products) < 60 {
		t.Fatalf("expected the full live catalog (~68 products), got %d", len(products))
	}

	var (
		percentage, flat, withUnderwriter, withCommission int
		categories                                        = map[string]int{}
	)
	for _, p := range products {
		if p.Code == "" {
			t.Fatalf("product with no code: %+v", p.Name)
		}
		categories[p.Category]++
		if p.Underwriter != "" {
			withUnderwriter++
		}
		if p.DistributorCommissionPercent != "" {
			withCommission++
		}
		switch {
		case p.IsPercentage:
			percentage++
			// A rate product must carry a rate in bps and NO flat price.
			if p.RateBps <= 0 {
				t.Fatalf("rate product %q has rate_bps %d (raw %q)", p.Code, p.RateBps, p.BasePriceRaw)
			}
			if p.BasePriceKobo != 0 {
				t.Fatalf("rate product %q also carries a flat price %d", p.Code, p.BasePriceKobo)
			}
		default:
			flat++
			if p.BasePriceRaw != "" && p.BasePriceKobo <= 0 {
				t.Fatalf("flat product %q priced %q converted to %d kobo", p.Code, p.BasePriceRaw, p.BasePriceKobo)
			}
			// MONEY INVARIANT: kobo is exactly 100x the provider's naira figure.
			if p.BasePriceRaw != "" {
				want, cErr := NairaToKobo(p.BasePriceRaw)
				if cErr != nil {
					t.Fatalf("live price %q on %q does not convert: %v", p.BasePriceRaw, p.Code, cErr)
				}
				if want != p.BasePriceKobo {
					t.Fatalf("product %q: %q naira became %d kobo, want %d", p.Code, p.BasePriceRaw, p.BasePriceKobo, want)
				}
			}
		}
	}
	t.Logf("pricing models: %d rate-priced, %d flat", percentage, flat)
	t.Logf("categories: %v", categories)
	t.Logf("underwriter disclosed on %d/%d, commission split on %d/%d",
		withUnderwriter, len(products), withCommission, len(products))

	if withUnderwriter == 0 {
		t.Fatal("no product disclosed an underwriter — the disclosure mapping is broken")
	}
	if percentage == 0 || flat == 0 {
		t.Fatal("expected both pricing models in the live catalog")
	}
}

// TestLive_ListPolicies proves the policy read path reaches the provider.
func TestLive_ListPolicies(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	policies, total, err := c.ListPolicies(ctx, 1, 50)
	if err != nil {
		t.Fatalf("live ListPolicies: %v", err)
	}
	t.Logf("live policies: %d returned, provider total_count %d", len(policies), total)
	for _, p := range policies {
		if p.ProviderPolicyRef == "" {
			t.Fatalf("a live policy came back with no reference: %+v", p)
		}
		t.Logf("  policy ref=%s status=%s premium=%d kobo", p.ProviderPolicyRef, p.Status, p.PremiumKobo)
	}
}

// TestLive_ListClaims proves v2's claims read path works. The v1 403 was a scope
// limit on the LEGACY api, not a wrong path — the same key gets 200 here.
func TestLive_ListClaims(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	claims, total, err := c.ListClaims(ctx, 1, 50)
	if err != nil {
		t.Fatalf("live ListClaims: %v", err)
	}
	t.Logf("live claims: %d returned, provider total_count %d", len(claims), total)
}

// TestLive_ComputePrice is the anchor live assertion for the money path: a real,
// deterministic, server-computed premium that needs no wallet funding.
//
// Verified live on Bastion FlexiCare Mini Retail:
//
//	payment_plan  1 -> NGN 4,000   ->    400,000 kobo
//	payment_plan 12 -> NGN 48,000  ->  4,800,000 kobo
//
// This proves three things at once: the adapter reaches v2's quote endpoint, the
// premium is the PROVIDER's figure rather than one we computed, and the
// naira->kobo crossing is exact.
func TestLive_ComputePrice(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	product := liveProduct(t, ctx, c, gateway.ProviderProduct{
		Code:              "bastion-flexicare-mini",
		ProviderProductID: "f7b4bca1-b870-4648-8704-11c1802a51d0",
		CommissionBps:     1000, // 10%, for the commission assertion below
		Underwriter:       "Bastion Health Ltd",
	})
	base := map[string]any{
		"first_name":   "Q",
		"last_name":    "A",
		"email":        "q@a.com",
		"phone_number": "2348012345678",
	}

	for _, tc := range []struct {
		plan     int
		wantKobo int64
	}{
		{1, 400_000},
		{12, 4_800_000},
	} {
		inputs := map[string]any{}
		for k, v := range base {
			inputs[k] = v
		}
		inputs[FieldPaymentPlan] = tc.plan

		q, err := c.GetQuote(ctx, gateway.QuoteRequest{Product: product, Inputs: inputs})
		if err != nil {
			t.Fatalf("live compute-price (plan %d): %v", tc.plan, err)
		}
		t.Logf("plan %2d -> premium %d kobo, commission %d kobo", tc.plan, q.PremiumKobo, q.CommissionKobo)
		if q.PremiumKobo != tc.wantKobo {
			t.Fatalf("plan %d: premium = %d kobo, want %d", tc.plan, q.PremiumKobo, tc.wantKobo)
		}
		if q.Terms["priced_by"] != "provider" {
			t.Fatalf("a live quote must be disclosed as provider-priced: %v", q.Terms)
		}
		// 10% of the provider's own premium, integer math.
		if want := tc.wantKobo / 10; q.CommissionKobo != want {
			t.Fatalf("plan %d: commission = %d kobo, want %d", tc.plan, q.CommissionKobo, want)
		}
	}
}

// TestLive_ProductSchema proves form schemas are FETCHED from the provider — no
// hand-maintained field table exists in this repo to drift out of date.
func TestLive_ProductSchema(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	schema, err := c.ProductSchemaFor(ctx, "f7b4bca1-b870-4648-8704-11c1802a51d0")
	if err != nil {
		t.Fatalf("live ProductSchemaFor: %v", err)
	}
	if len(schema.Fields) == 0 {
		t.Fatal("live schema came back with no fields")
	}
	t.Logf("live schema: %d fields", len(schema.Fields))

	var sawProductID, sawMemberField bool
	for _, f := range schema.Fields {
		if f.Name == FieldProductID {
			sawProductID = true
			if f.Type != "hidden" || !f.System {
				t.Fatalf("product_id must be hidden+system so no form renders it: %+v", f)
			}
		} else {
			sawMemberField = true
		}
		if f.Label == "" {
			t.Fatalf("field %q has no label — the app cannot render it", f.Name)
		}
		if f.Type == "" {
			t.Fatalf("field %q has no type", f.Name)
		}
	}
	if !sawProductID {
		t.Fatal("every product schema carries product_id")
	}
	if !sawMemberField || !schema.Purchasable() {
		t.Fatal("this product should be purchasable (it has member-fillable fields)")
	}
}

// TestLive_BrokenProductsAreDetected pins the 7 products MyCover's own
// configuration is broken for. Four return a schema containing NOTHING but
// product_id — nothing to collect, so nothing to sell.
func TestLive_BrokenProductsAreDetected(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// The four "no purchase config" products.
	broken := map[string]string{
		"58a6df7e-87f4-40e8-bf78-5b1f85c6d87f": "aiico-shop-content-cover",
		"cfee22e7-5aa1-4413-ba66-8ac5d550c69e": "aiico-hospital-cash",
		"fab6bda1-b870-4648-8704-11c0102a41c0": "leadway-home-content",
		"b0d0f39c-0b8a-452f-a876-78bef8dde1d9": "sti-goods-in-transit",
	}
	for id, code := range broken {
		schema, err := c.ProductSchemaFor(ctx, id)
		if err != nil {
			t.Logf("%s: schema unavailable (%v) — still not sellable", code, err)
			continue
		}
		if schema.Purchasable() {
			t.Errorf("%s was reported PURCHASABLE but its provider config is broken — it must not be sellable", code)
			continue
		}
		t.Logf("%s: correctly detected as not purchasable (%d fields, all system)", code, len(schema.Fields))
	}
}

// liveProduct completes a routing descriptor the way the CATALOG does: it
// fetches the product's REAL published schema and derives the money-input spec
// from it, exactly as catalog.ResolveProduct derives it from the stored copy of
// that same schema.
//
// Hand-writing the spec here would prove nothing about production. Deriving it
// from the provider's own schema is what makes the live tests below exercise the
// real seam.
func liveProduct(t *testing.T, ctx context.Context, c *Client, p gateway.ProviderProduct) gateway.ProviderProduct {
	t.Helper()
	schema, err := c.ProductSchemaFor(ctx, p.ProviderProductID)
	if err != nil {
		t.Fatalf("live product schema for %s: %v", p.Code, err)
	}
	raw, err := json.Marshal(schema.AsMap())
	if err != nil {
		t.Fatalf("marshal schema: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var stored map[string]any
	if err := dec.Decode(&stored); err != nil {
		t.Fatalf("decode schema: %v", err)
	}
	fields, _ := stored["fields"].([]any)
	p.FormSchemaKnown = len(fields) > 0
	p.MoneyInputPaths = gateway.MoneyInputPaths(stored)
	t.Logf("%s: %d published fields, money inputs %v", p.Code, len(fields), p.MoneyInputPaths)
	return p
}

// TestLive_DeclaredValueIsPricedInNaira is the live proof of the money-unit bug
// and of its fix, on a PERCENTAGE-rated product where the premium is a direct
// function of the declared value.
//
// MyCover's `value` field is denominated in NAIRA; every Paymax client submits
// INTEGER KOBO. Nothing converted between them, so the provider was told a
// ₦200,000 phone was worth ₦20,000,000 and priced it accordingly:
//
//	body.value = 200000    -> price 10,000     (correct)
//	body.value = 20000000  -> price 1,000,000  (the bug: 100x)
//
// The quote below submits 20,000,000 KOBO — what the app actually sends — and
// must come back at ₦10,000. If the outbound conversion is ever removed this
// test fails against the real insurer, not against a fixture.
func TestLive_DeclaredValueIsPricedInNaira(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	product := liveProduct(t, ctx, c, gateway.ProviderProduct{
		Code:              "mcg-gadget-cover",
		ProviderProductID: "ffb0711c-1e4a-453b-a26c-2726e0a1a7bb",
		IsPercentage:      true,
		RateBps:           500, // 5%
		Underwriter:       "Sovereign Trust Insurance Plc",
	})
	if len(product.MoneyInputPaths) == 0 {
		t.Fatal("the gadget schema publishes a `money` value field; deriving none means the seam is broken at the source")
	}

	const declaredKobo = 20_000_000 // ₦200,000, as the app submits it
	q, err := c.GetQuote(ctx, gateway.QuoteRequest{
		Product: product,
		Inputs: map[string]any{
			"first_name":   "Quote",
			"last_name":    "Probe",
			"email":        "quote.probe@example.com",
			"phone_number": "2348012345678",
			"device_type":  "Phone",
			"device_make":  "Samsung",
			"device_model": "SM-S916B",
			"value":        int64(declaredKobo),
		},
	})
	if err != nil {
		t.Fatalf("live compute-price: %v", err)
	}
	t.Logf("declared %d kobo (₦%d) -> premium %d kobo (₦%d)",
		declaredKobo, declaredKobo/100, q.PremiumKobo, q.PremiumKobo/100)

	const wantKobo = 1_000_000 // ₦10,000 = 5% of ₦200,000
	if q.PremiumKobo != wantKobo {
		if q.PremiumKobo == wantKobo*100 {
			t.Fatalf("premium = %d kobo (₦%d) — 100x the correct figure: kobo reached the insurer as naira",
				q.PremiumKobo, q.PremiumKobo/100)
		}
		t.Fatalf("premium = %d kobo, want %d (₦10,000)", q.PremiumKobo, wantKobo)
	}
}
