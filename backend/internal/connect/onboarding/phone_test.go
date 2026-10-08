package connectonboarding

import "testing"

func TestNormalizePhone(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"+2348012345678", "+2348012345678", false},
		{"0801 234 5678", "08012345678", false},
		{"+1 (202) 555-0100", "+12025550100", false},
		{"  +2348012345678  ", "+2348012345678", false},
		{"123", "", true},                   // too short
		{"+23480123456789012345", "", true}, // too long
		{"not-a-number", "", true},
		{"", "", true},
		{"++2348012345678", "", true},
	}
	for _, tc := range cases {
		got, err := normalizePhone(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("normalizePhone(%q) = %q, want error", tc.in, got)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("normalizePhone(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
}

func TestMaskPhone(t *testing.T) {
	if got := maskPhone("+2348012345678"); got != "**********5678" {
		t.Errorf("maskPhone = %q", got)
	}
	if got := maskPhone("123"); got != "****" {
		t.Errorf("maskPhone(short) = %q", got)
	}
}
