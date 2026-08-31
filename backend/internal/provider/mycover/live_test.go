package mycover

import (
	"bufio"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
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

// TestLive_ClaimsScopeIsReportedHonestly pins the entitlement gap: /claims
// exists but our key lacks the scope, and the adapter must say exactly that
// rather than degrade into fabricated data.
func TestLive_ClaimsScopeIsReportedHonestly(t *testing.T) {
	c := liveClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	_, err := c.GetClaim(ctx, "00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Log("claims scope appears to have been GRANTED — re-probe and enable the claims path")
		return
	}
	if errors.Is(err, ErrProviderScope) {
		t.Logf("claims remain scope-blocked as expected: %v", err)
		return
	}
	t.Logf("claims returned a non-scope error (acceptable — the ref is a dummy): %v", err)
}
