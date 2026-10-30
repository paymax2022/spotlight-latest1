package transport

import (
	"testing"

	"spotlight/backend/internal/provider"
)

func TestNormalizeIdentityDocType(t *testing.T) {
	cases := map[string]string{
		"nin":             "nin",
		" NIN ":           "nin",
		"national_id":     "nin",
		"drivers_licence": "drivers_licence",
		"drivers_license": "drivers_licence",
		"dl":              "drivers_licence",
		"license":         "drivers_licence",
		"passport":        "passport",
	}
	for in, want := range cases {
		if got := normalizeIdentityDocType(in); got != want {
			t.Errorf("normalizeIdentityDocType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidIdentityNumber(t *testing.T) {
	for _, v := range []string{"12345678901", "00000000000"} {
		if !validIdentityNumber("nin", v) {
			t.Errorf("validIdentityNumber(nin, %q) = false, want true", v)
		}
	}
	for _, v := range []string{"", "1234567890", "123456789012", "1234567890a"} {
		if validIdentityNumber("nin", v) {
			t.Errorf("validIdentityNumber(nin, %q) = true, want false", v)
		}
	}
	for _, v := range []string{"ABC123456", "LND-238-KJA", "12345"} {
		if !validIdentityNumber("drivers_license", v) {
			t.Errorf("validIdentityNumber(dl, %q) = false, want true", v)
		}
	}
	for _, v := range []string{"", "1234", "ABC 123", "ABCDEFGHIJKLMNOPQRSTU"} {
		if validIdentityNumber("drivers_license", v) {
			t.Errorf("validIdentityNumber(dl, %q) = true, want false", v)
		}
	}
}

func TestDriverDocStatusForKyc(t *testing.T) {
	cases := map[provider.KycCheckStatus]string{
		provider.KycPassed:  "approved",
		provider.KycFailed:  "rejected",
		provider.KycPending: "submitted",
		provider.KycReview:  "submitted",
	}
	for in, want := range cases {
		if got := driverDocStatusForKyc(in); got != want {
			t.Errorf("driverDocStatusForKyc(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMatchedIdentityName(t *testing.T) {
	cases := []struct {
		fields map[string]string
		want   string
	}{
		{map[string]string{"full_name": "Amara Okonkwo"}, "Amara Okonkwo"},
		{map[string]string{"first_name": "Amara", "last_name": "Okonkwo"}, "Amara Okonkwo"},
		{map[string]string{"first_name": "Amara"}, "Amara"},
		{map[string]string{}, ""},
	}
	for _, c := range cases {
		if got := matchedIdentityName(c.fields); got != c.want {
			t.Errorf("matchedIdentityName(%v) = %q, want %q", c.fields, got, c.want)
		}
	}
}

func TestValidGuarantorPhone(t *testing.T) {
	for _, v := range []string{"08031234567", "+2348031234567", "0803 123 4567", "(0803) 123-4567"} {
		if !validGuarantorPhone(v) {
			t.Errorf("validGuarantorPhone(%q) = false, want true", v)
		}
	}
	for _, v := range []string{"", "123", "0803abc4567", "+23480312345678901"} {
		if validGuarantorPhone(v) {
			t.Errorf("validGuarantorPhone(%q) = true, want false", v)
		}
	}
}

func TestDriverUploadContentTypes_RejectsExecutableFormats(t *testing.T) {
	for _, ext := range []string{".svg", ".html", ".exe", ".js", ""} {
		if _, ok := driverUploadContentTypes[ext]; ok {
			t.Errorf("driverUploadContentTypes allows %q — renamed files could be served as that type", ext)
		}
	}
	for ext, want := range map[string]string{
		".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
		".webp": "image/webp", ".pdf": "application/pdf",
	} {
		if got := driverUploadContentTypes[ext]; got != want {
			t.Errorf("driverUploadContentTypes[%q] = %q, want %q", ext, got, want)
		}
	}
}
