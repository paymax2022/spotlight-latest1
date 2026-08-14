package tests

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ADR-042's safety argument for letting an UNVERIFIED (Tier 0) account move money
// is precisely that it cannot get value back OUT: every cash-out path refuses
// Tier 0. ADR-043 relaxes the SPEND side so a card-funded customer is not blocked
// at escrow — via a separate method, EnforceCheckoutDebitLimit, used only by
// consumer-purchase paths.
//
// If that method ever reaches a cash-out path, the argument collapses and an
// unverified account gains a funded, withdrawable wallet — a KYC bypass.
//
// This test reads the production source and asserts the boundary directly,
// because the failure is a one-word edit (EnforceWallet… → EnforceCheckout…) that
// no arithmetic test would notice and that compiles cleanly.

// Paths that must NEVER use the relaxed checkout gate, and why.
var cashOutPaths = map[string]string{
	"internal/restaurant/withdrawal.go":          "merchant withdrawal — money leaves the platform",
	"internal/finance/transfers/service.go":      "wallet-to-wallet and bank transfers — money leaves the wallet",
	"internal/fractionalre/service_subscribe.go": "investment purchase — warrants stricter KYC, not looser",
	"internal/fractionalre/service_secondary.go": "investment purchase — warrants stricter KYC, not looser",
}

// Consumer-purchase paths that SHOULD use it, so a Tier-0 customer funded by the
// card rail can actually complete the purchase they paid for.
var checkoutPaths = map[string]string{
	"internal/restaurant/service.go":  "customer order escrow",
	"internal/transport/service.go":   "rider fare escrow",
	"internal/estate/service_dues.go": "resident dues payment",
	"internal/doctor/service.go":      "consultation payment",
}

func readSource(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

// callRe matches a real call, not the interface declaration or a comment.
func callRe(method string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^\s*(?:if err :?= )?[\w.]*\.` + method + `\(`)
}

func TestCashOutPathsNeverUseTheCheckoutAllowance(t *testing.T) {
	for rel, why := range cashOutPaths {
		src := readSource(t, rel)
		if callRe("EnforceCheckoutDebitLimit").MatchString(src) {
			t.Errorf("%s calls EnforceCheckoutDebitLimit (%s).\n"+
				"ADR-042 permits an unverified account to move money ONLY because it cannot get value out. "+
				"Relaxing this path hands a Tier-0 account a funded, extractable wallet.", rel, why)
		}
	}
}

func TestCashOutPathsStillEnforceTheStrictGate(t *testing.T) {
	// Removing the gate entirely would also pass the test above, so assert the
	// strict call is still there.
	for rel, why := range cashOutPaths {
		src := readSource(t, rel)
		if !callRe("EnforceWalletDebitLimit").MatchString(src) {
			t.Errorf("%s no longer calls EnforceWalletDebitLimit (%s) — the strict tier gate was dropped", rel, why)
		}
	}
}

func TestConsumerPurchasePathsUseTheCheckoutAllowance(t *testing.T) {
	// The point of ADR-043: without this, a Tier-0 customer is charged by the card
	// rail, credited, and then refused at escrow — holding money they can neither
	// spend nor withdraw.
	for rel, why := range checkoutPaths {
		src := readSource(t, rel)
		if !callRe("EnforceCheckoutDebitLimit").MatchString(src) {
			t.Errorf("%s does not call EnforceCheckoutDebitLimit (%s) — a card-funded Tier-0 customer would be blocked at escrow with money they cannot withdraw", rel, why)
		}
	}
}

// The relaxed gate must stay rare and reviewable. If a new call site appears,
// someone has to come here and justify it against the cash-out argument.
func TestCheckoutAllowanceCallSitesAreEnumerated(t *testing.T) {
	var found []string
	root := filepath.Join("..", "internal")
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		// The tiers package defines and documents the method; it is not a call site.
		if strings.Contains(path, filepath.Join("internal", "finance", "tiers")) {
			return nil
		}
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if callRe("EnforceCheckoutDebitLimit").Match(b) {
			rel, _ := filepath.Rel("..", path)
			found = append(found, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	for _, f := range found {
		if _, ok := checkoutPaths[f]; !ok {
			t.Errorf("%s uses the Tier-0 checkout allowance but is not in checkoutPaths.\n"+
				"Add it here ONLY after confirming it is a consumer purchase and not a cash-out or investment path (ADR-043).", f)
		}
	}
	if len(found) != len(checkoutPaths) {
		t.Errorf("expected %d call sites, found %d: %v — a consumer-purchase path may have lost its gate",
			len(checkoutPaths), len(found), found)
	}
}
