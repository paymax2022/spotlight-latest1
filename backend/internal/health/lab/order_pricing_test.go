package healthlab

import (
	"errors"
	"math"
	"testing"
)

func sumKobo(v []int64) int64 {
	var s int64
	for _, x := range v {
		s += x
	}
	return s
}

func TestAllocatePackagePrice_ExactSumPositiveAndProportional(t *testing.T) {
	cases := []struct {
		name   string
		pkg    int64
		prices []int64
	}{
		{"equal tests", 1_000_00, []int64{500_00, 500_00}},
		{"discounted bundle", 2_200_00, []int64{650_00, 950_00, 880_00}},
		{"remainder must be placed, not lost", 1_000, []int64{100, 200, 300}},
		{"one test", 7_777, []int64{9_000}},
		{"package barely above one kobo per test", 3, []int64{9_000, 1, 500}},
		{"large amounts do not overflow", math.MaxInt64 / 2, []int64{math.MaxInt64 / 4, math.MaxInt64 / 8, math.MaxInt64 / 16}},
	}
	for _, tc := range cases {
		got, err := allocatePackagePrice(tc.pkg, tc.prices)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if len(got) != len(tc.prices) {
			t.Fatalf("%s: want %d lines, got %d", tc.name, len(tc.prices), len(got))
		}
		if sumKobo(got) != tc.pkg {
			t.Errorf("%s: lines sum to %d, package costs %d — the held total must equal the package price exactly", tc.name, sumKobo(got), tc.pkg)
		}
		for i, g := range got {
			if g < 1 {
				t.Errorf("%s: line %d allocated %d kobo; every line must be positive", tc.name, i, g)
			}
		}
	}

	// A pricier test never carries a smaller share than a cheaper one.
	got, _ := allocatePackagePrice(2_200_00, []int64{350_00, 950_00})
	if got[0] > got[1] {
		t.Errorf("allocation must be proportional to test prices, got %v", got)
	}
}

func TestAllocatePackagePrice_Refusals(t *testing.T) {
	if _, err := allocatePackagePrice(2, []int64{100, 100, 100}); !errors.Is(err, ErrPackageUnallocatable) {
		t.Errorf("a package priced below one kobo per test cannot be split, got %v", err)
	}
	if _, err := allocatePackagePrice(0, []int64{100}); !errors.Is(err, ErrPackageUnallocatable) {
		t.Errorf("a zero package price must be refused, got %v", err)
	}
	if _, err := allocatePackagePrice(100, nil); !errors.Is(err, ErrPackageUnallocatable) {
		t.Errorf("a package with no tests must be refused, got %v", err)
	}
	if _, err := allocatePackagePrice(100, []int64{50, 0}); !errors.Is(err, ErrPackageUnallocatable) {
		t.Errorf("a zero-priced test inside a package must be refused, got %v", err)
	}
	if _, err := allocatePackagePrice(100, []int64{50, -5}); !errors.Is(err, ErrPackageUnallocatable) {
		t.Errorf("a negative test price must be refused, got %v", err)
	}
}

func TestAddKobo_GuardsOverflowAndSign(t *testing.T) {
	if got, err := addKobo(5, 7); err != nil || got != 12 {
		t.Fatalf("addKobo(5,7) = %d, %v", got, err)
	}
	if _, err := addKobo(math.MaxInt64, 1); !errors.Is(err, ErrTotalOverflow) {
		t.Errorf("overflow must be refused, got %v", err)
	}
	if _, err := addKobo(10, -1); !errors.Is(err, ErrNegativeLinePrice) {
		t.Errorf("a negative amount must be refused, got %v", err)
	}
}
