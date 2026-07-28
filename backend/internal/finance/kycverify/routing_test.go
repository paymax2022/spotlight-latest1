package kycverify

import (
	"testing"

	"spotlight/backend/internal/provider"
)

func TestDefaultRouting(t *testing.T) {
	tbl := DefaultRoutingTable()
	// Dojah is the default primary for every check type.
	if got := tbl.Resolve(provider.KycIDNumber); len(got) != 2 || got[0] != "dojah" || got[1] != "youverify" {
		t.Fatalf("ID_NUMBER default chain wrong: %v", got)
	}
	if got := tbl.Resolve(provider.KycLiveness); got[0] != "dojah" {
		t.Fatalf("LIVENESS primary should be dojah, got %v", got)
	}
}

func TestTableFromSeed_OverrideAndFallback(t *testing.T) {
	tbl := TableFromSeed(RoutingSeed{
		IDNumber:  "dojah, youverify", // override order
		Threshold: 80,
		// others empty → fall back to defaults but pick up threshold
	})
	if got := tbl.Resolve(provider.KycIDNumber); got[0] != "dojah" || got[1] != "youverify" {
		t.Fatalf("seed override not applied: %v", got)
	}
	if th := tbl.ThresholdFor(provider.KycIDFacial); th != 80 {
		t.Fatalf("threshold seed not applied to fallback: %d", th)
	}
	if got := tbl.Resolve(provider.KycAML); got[0] != "dojah" {
		t.Fatalf("AML should fall back to default primary dojah: %v", got)
	}
}

func TestResolveDisabled(t *testing.T) {
	tbl := DefaultRoutingTable()
	r := tbl[provider.KycAML]
	r.Enabled = false
	tbl[provider.KycAML] = r
	if got := tbl.Resolve(provider.KycAML); got != nil {
		t.Fatalf("disabled rule must resolve to empty chain, got %v", got)
	}
}
