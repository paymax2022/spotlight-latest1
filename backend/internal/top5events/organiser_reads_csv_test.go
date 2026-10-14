package top5events

import "testing"

// csvSafe guards the attendee CSV export against spreadsheet formula injection.
func TestCSVSafe_FormulaInjection(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"John Doe", "John Doe"},
		{"Doe, John \"JD\"", "Doe, John \"JD\""},
		{"@handle", "'@handle"},
		{"=1+1", "'=1+1"},
		{"+1234567890", "'+1234567890"},
		{"-cmd", "'-cmd"},
		{"\tLeadingTab", "'\tLeadingTab"},
		{"\rLeadingCR", "'\rLeadingCR"},
		{"mid@dle", "mid@dle"},
		{"price -5", "price -5"},
	}
	for _, c := range cases {
		if got := csvSafe(c.in); got != c.want {
			t.Errorf("csvSafe(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
