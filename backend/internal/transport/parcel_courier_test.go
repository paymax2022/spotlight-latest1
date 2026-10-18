package transport

import "testing"

func TestMaskPhoneKeepsOnlyTheLastFourDigits(t *testing.T) {
	cases := map[string]string{
		"+2348031234567":      "••••4567",
		"0803 123 4567":       "••••4567",
		"+234 (803) 123-4567": "••••4567",
		"123":                 "",
		"":                    "",
	}
	for in, want := range cases {
		if got := maskPhone(in); got != want {
			t.Errorf("maskPhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDisplayVehicleType(t *testing.T) {
	if got := displayVehicleType("bike"); got != "Bike" {
		t.Errorf("got %q", got)
	}
	if got := displayVehicleType(""); got != "" {
		t.Errorf("got %q", got)
	}
}
