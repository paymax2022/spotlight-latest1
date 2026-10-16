package restaurant

import (
	"strings"
	"testing"
)

const kybTestRestaurant = "0b0c2f6e-2b7a-4f0e-9d53-1f3a8c1d2e4f"

func TestClassifyKYBFileRef(t *testing.T) {
	ownKey := kybKeyPrefix(kybTestRestaurant) + "cac_certificate/abc123.pdf"
	otherKey := kybKeyPrefix("11111111-1111-1111-1111-111111111111") + "cac_certificate/abc123.pdf"

	cases := []struct {
		name    string
		ref     string
		wantKey bool
		wantErr bool
	}{
		{"own object key", ownKey, true, false},
		{"own key, surrounding whitespace", "  " + ownKey + "\n", true, false},
		{"https link", "https://drive.example.com/file/d/1", false, false},
		{"http link", "http://example.com/cac.pdf", false, false},
		{"another outlet's key", otherKey, false, true},
		{"javascript scheme", "javascript:alert(1)", false, true},
		{"data scheme", "data:text/html;base64,PHNjcmlwdD4=", false, true},
		{"legacy r2 scheme", "r2://kyb/cac.pdf", false, true},
		{"file scheme", "file:///etc/passwd", false, true},
		{"scheme-relative host", "//evil.example/x.pdf", false, true},
		{"bare filename", "cac.pdf", false, true},
		{"traversal inside own prefix", kybKeyPrefix(kybTestRestaurant) + "../secret.pdf", false, true},
		{"https without host", "https://", false, true},
		{"empty", "", false, true},
	}
	for _, c := range cases {
		gotKey, err := classifyKYBFileRef(kybTestRestaurant, c.ref)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: err = %v, wantErr %v", c.name, err, c.wantErr)
			continue
		}
		if err == nil && gotKey != c.wantKey {
			t.Errorf("%s: isKey = %v, want %v", c.name, gotKey, c.wantKey)
		}
	}
}

func TestKYBDocKeyIsServerControlledAndUnique(t *testing.T) {
	a := kybDocKey(kybTestRestaurant, "cac_certificate", ".pdf")
	b := kybDocKey(kybTestRestaurant, "cac_certificate", ".pdf")
	if a == b {
		t.Fatal("two keys for the same document type must differ (random component)")
	}
	want := "restaurant/" + kybTestRestaurant + "/kyb/cac_certificate/"
	if !strings.HasPrefix(a, want) || !strings.HasSuffix(a, ".pdf") {
		t.Errorf("key %q must start with %q and end .pdf", a, want)
	}
	// A key we mint must be accepted back for the same restaurant and no other.
	if isKey, err := classifyKYBFileRef(kybTestRestaurant, a); err != nil || !isKey {
		t.Errorf("a freshly minted key must round-trip through classify: isKey=%v err=%v", isKey, err)
	}
	if _, err := classifyKYBFileRef("11111111-1111-1111-1111-111111111111", a); err == nil {
		t.Error("a key minted for one restaurant must not validate for another")
	}
}

func TestKYBDocTypeSlug(t *testing.T) {
	for _, ok := range []string{"cac_certificate", "director_id", "proof_of_address", "ab", "doc2"} {
		if !kybDocTypeRE.MatchString(ok) {
			t.Errorf("%q should be a valid doc_type", ok)
		}
	}
	for _, bad := range []string{"", "a", "CAC", "has space", "../x", "a/b", "9lives", "x" + strings.Repeat("y", 64), "dot.dot"} {
		if kybDocTypeRE.MatchString(bad) {
			t.Errorf("%q must not be a valid doc_type", bad)
		}
	}
}

func TestKYBContentTypeBoundToExtension(t *testing.T) {
	for ext, ct := range kybContentTypeByExt {
		if ct == "" || strings.ContainsAny(ext, "/ ") || !strings.HasPrefix(ext, ".") {
			t.Errorf("bad allowlist entry %q → %q", ext, ct)
		}
	}
	// Executables and scripts must never be signable.
	for _, ext := range []string{".exe", ".html", ".svg", ".js", ".zip", ""} {
		if _, ok := kybContentTypeByExt[ext]; ok {
			t.Errorf("extension %q must not be uploadable as a KYB document", ext)
		}
	}
}

func TestCanonicalRestaurantID(t *testing.T) {
	got, err := canonicalRestaurantID("  0B0C2F6E-2B7A-4F0E-9D53-1F3A8C1D2E4F ")
	if err != nil || got != kybTestRestaurant {
		t.Errorf("got %q err %v, want lower-case %q", got, err, kybTestRestaurant)
	}
	for _, bad := range []string{"", "not-a-uuid", "../etc", kybTestRestaurant + "/x"} {
		if _, err := canonicalRestaurantID(bad); err == nil {
			t.Errorf("%q must not be accepted as a restaurant id", bad)
		}
	}
}

func TestKYBDocPresentation(t *testing.T) {
	cases := map[string][2]string{
		"cac_certificate":  {"cac", "CAC certificate"},
		"director_id":      {"id", "Director ID"},
		"proof_of_address": {"other", "Proof of address"},
		"food_hygiene":     {"other", "Food hygiene"},
	}
	for in, want := range cases {
		kind, label := kybDocPresentation(in)
		if kind != want[0] || label != want[1] {
			t.Errorf("%s: got (%s, %s), want (%s, %s)", in, kind, label, want[0], want[1])
		}
	}
}
