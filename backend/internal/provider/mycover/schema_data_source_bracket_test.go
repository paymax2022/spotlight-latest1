package mycover

import (
	"encoding/json"
	"testing"
)

// MyCover's `data_source` for several LIVE products (verified 2026-09-17
// against outpatient-hospicash-mini / surgeryandoupatienthospicash /
// goxi-artisan-basic / traveller-accident-basic-cover, all with active buy
// paths) is a stringified bracketed list — "[Surgery, Out Patient]",
// "[true, false]" — not a JSON array. parseDataSource used to split on comma
// BEFORE stripping the brackets, so the first and last option came out
// "[Surgery" / "Out Patient]" (or "[true" / "false]"). The provider's own
// /products/buy validation never accepts an option value it did not itself
// offer, so any member request built from that corrupted schema — whatever
// they actually selected — got a live 422 provider_validation "must be equal
// to one of the allowed values", and the product was unbuyable regardless of
// input. This pins the fix: strip one matching outer [...] pair first, then
// split, then trim stray quote characters from each part.
func TestParseDataSource_StripsOuterBracketsBeforeSplitting(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []Option
	}{
		{
			name: "bracketed multi-word list (benefits)",
			raw:  `"[Surgery, Out Patient]"`,
			want: []Option{{Value: "Surgery", Label: "Surgery"}, {Value: "Out Patient", Label: "Out Patient"}},
		},
		{
			name: "bracketed boolean list (bought_for_self)",
			raw:  `"[true, false]"`,
			want: []Option{{Value: "true", Label: "true"}, {Value: "false", Label: "false"}},
		},
		{
			name: "unbracketed list still works (no regression)",
			raw:  `"Male, Female"`,
			want: []Option{{Value: "Male", Label: "Male"}, {Value: "Female", Label: "Female"}},
		},
		{
			name: "single bracketed value",
			raw:  `"[true]"`,
			want: []Option{{Value: "true", Label: "true"}},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			opts, url := parseDataSource(json.RawMessage(tc.raw))
			if url != "" {
				t.Fatalf("unexpected options_url %q", url)
			}
			if len(opts) != len(tc.want) {
				t.Fatalf("got %d options %+v, want %d %+v", len(opts), opts, len(tc.want), tc.want)
			}
			for i, o := range opts {
				if o.Value != tc.want[i].Value || o.Label != tc.want[i].Label {
					t.Errorf("option %d = %+v, want %+v (leaked bracket char)", i, o, tc.want[i])
				}
				if o.Value[0] == '[' || o.Value[len(o.Value)-1] == ']' {
					t.Errorf("option %d still carries a bracket: %q", i, o.Value)
				}
			}
		})
	}
}
