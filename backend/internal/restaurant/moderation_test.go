package restaurant

import "testing"

func TestAutoFlagComment(t *testing.T) {
	if autoFlagComment("great jollof, fast delivery") != "visible" {
		t.Error("clean comment should be visible")
	}
	if autoFlagComment("this place is a total SCAM") != "flagged" {
		t.Error("abusive comment should be flagged")
	}
}

func TestMaskEmail(t *testing.T) {
	cases := map[string]string{
		"amara.obi@gmail.com": "am****@gmail.com",
		"a@b.co":              "a****@b.co",
		"not-an-email":        "************",
	}
	for in, want := range cases {
		if got := maskEmail(in); got != want {
			t.Errorf("maskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMaskPhone(t *testing.T) {
	if got := maskPhone("08031234567"); got != "********567" {
		t.Errorf("got %q", got)
	}
	if got := maskPhone("+234 803 123 4567"); got != "**********567" { // 13 digits, keep last 3
		t.Errorf("got %q", got)
	}
	if got := maskPhone("12"); got != "**" {
		t.Errorf("short number should be fully masked, got %q", got)
	}
}

func TestMaskDeliveryAddress(t *testing.T) {
	if got := maskDeliveryAddress("12b Adeola St, Victoria Island, Lagos"); got != "…, Victoria Island, Lagos" {
		t.Errorf("got %q", got)
	}
	// No structure to keep → fully hidden.
	if got := maskDeliveryAddress("somewhere"); got != "…" {
		t.Errorf("got %q", got)
	}
}
