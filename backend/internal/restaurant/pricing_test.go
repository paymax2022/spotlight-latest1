package restaurant

import (
	"errors"
	"testing"
)

// sample menu-item modifier layout used across the tests:
//   - "Size"   : REQUIRED, pick exactly one (min=max=1): Small (+0), Large (+50000)
//   - "Extras" : optional, pick up to two (min=0,max=2):  Cheese (+20000), Bacon (+30000), Sold-out (unavailable)
func sampleGroups() []ModifierGroup {
	return []ModifierGroup{
		{
			ID: "g-size", Name: "Size", Required: true, MinSelect: 1, MaxSelect: 1,
			Modifiers: []Modifier{
				{ID: "m-small", GroupID: "g-size", Name: "Small", PriceDeltaKobo: 0, IsAvailable: true},
				{ID: "m-large", GroupID: "g-size", Name: "Large", PriceDeltaKobo: 50_000, IsAvailable: true},
			},
		},
		{
			ID: "g-extras", Name: "Extras", Required: false, MinSelect: 0, MaxSelect: 2,
			Modifiers: []Modifier{
				{ID: "m-cheese", GroupID: "g-extras", Name: "Cheese", PriceDeltaKobo: 20_000, IsAvailable: true},
				{ID: "m-bacon", GroupID: "g-extras", Name: "Bacon", PriceDeltaKobo: 30_000, IsAvailable: true},
				{ID: "m-soldout", GroupID: "g-extras", Name: "Truffle", PriceDeltaKobo: 90_000, IsAvailable: false},
			},
		},
	}
}

func TestResolveLineModifiers_Valid(t *testing.T) {
	cases := []struct {
		name      string
		chosen    []string
		wantDelta int64
		wantNames []string // expected chosen order (group order, then option order)
	}{
		{"size only (required satisfied)", []string{"m-small"}, 0, []string{"Small"}},
		{"large size", []string{"m-large"}, 50_000, []string{"Large"}},
		{"large + one extra", []string{"m-large", "m-cheese"}, 70_000, []string{"Large", "Cheese"}},
		{"large + two extras (max)", []string{"m-large", "m-cheese", "m-bacon"}, 100_000, []string{"Large", "Cheese", "Bacon"}},
		// Chosen order must follow group+option order regardless of input order.
		{"input order does not matter", []string{"m-bacon", "m-cheese", "m-small"}, 50_000, []string{"Small", "Cheese", "Bacon"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			chosen, delta, err := resolveLineModifiers(sampleGroups(), tc.chosen)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if delta != tc.wantDelta {
				t.Errorf("delta = %d, want %d", delta, tc.wantDelta)
			}
			if len(chosen) != len(tc.wantNames) {
				t.Fatalf("chosen len = %d, want %d (%v)", len(chosen), len(tc.wantNames), tc.wantNames)
			}
			for i, m := range chosen {
				if m.Name != tc.wantNames[i] {
					t.Errorf("chosen[%d] = %q, want %q", i, m.Name, tc.wantNames[i])
				}
			}
		})
	}
}

func TestResolveLineModifiers_Invalid(t *testing.T) {
	cases := []struct {
		name   string
		chosen []string
	}{
		{"required group missing (no size)", []string{"m-cheese"}},
		{"nothing chosen but Size is required", nil},
		{"two sizes exceeds max=1", []string{"m-small", "m-large"}},
		{"three extras exceeds max=2", []string{"m-small", "m-cheese", "m-bacon", "m-soldout"}}, // soldout also unavailable
		{"unknown option id", []string{"m-small", "m-ketchup"}},
		{"unavailable option", []string{"m-small", "m-soldout"}},
		{"duplicate option", []string{"m-large", "m-cheese", "m-cheese"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := resolveLineModifiers(sampleGroups(), tc.chosen)
			if !errors.Is(err, ErrInvalidModifierSelection) {
				t.Fatalf("want ErrInvalidModifierSelection, got %v", err)
			}
		})
	}
}

// TestResolveLineModifiers_NoGroups: an item with no modifier groups accepts an empty
// selection and prices at zero delta (back-compat for plain items).
func TestResolveLineModifiers_NoGroups(t *testing.T) {
	chosen, delta, err := resolveLineModifiers(nil, nil)
	if err != nil {
		t.Fatalf("no-groups empty selection should be valid: %v", err)
	}
	if delta != 0 || len(chosen) != 0 {
		t.Fatalf("want zero delta / no chosen, got delta=%d chosen=%d", delta, len(chosen))
	}
	// But choosing an option when the item has NO groups is still rejected (unknown id).
	if _, _, err := resolveLineModifiers(nil, []string{"m-x"}); !errors.Is(err, ErrInvalidModifierSelection) {
		t.Fatalf("choosing an option on a no-group item must be rejected, got %v", err)
	}
}

// TestEffectiveMin locks the required-vs-min interaction: a required group with
// MinSelect left at 0 still demands at least one selection.
func TestEffectiveMin(t *testing.T) {
	if got := (ModifierGroup{Required: true, MinSelect: 0}).effectiveMin(); got != 1 {
		t.Errorf("required group with min 0 should demand 1, got %d", got)
	}
	if got := (ModifierGroup{Required: true, MinSelect: 2}).effectiveMin(); got != 2 {
		t.Errorf("explicit min should win when >= 1, got %d", got)
	}
	if got := (ModifierGroup{Required: false, MinSelect: 0}).effectiveMin(); got != 0 {
		t.Errorf("optional group should allow 0, got %d", got)
	}
}
