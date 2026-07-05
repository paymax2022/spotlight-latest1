package estate

import "testing"

func TestAtoiDefault(t *testing.T) {
	cases := []struct {
		in        string
		def, want int
	}{
		{"", 50, 50}, {"10", 50, 10}, {"abc", 7, 7}, {"0", 5, 0}, {"-3", 9, -3},
	}
	for _, c := range cases {
		if got := atoiDefault(c.in, c.def); got != c.want {
			t.Errorf("atoiDefault(%q,%d)=%d want %d", c.in, c.def, got, c.want)
		}
	}
}
