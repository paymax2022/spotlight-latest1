package restaurant

import (
	"strings"
	"testing"

	"spotlight/backend/internal/platform/r2"
)

const imgRID = "11111111-2222-4333-8444-555555555555"
const otherRID = "99999999-2222-4333-8444-555555555555"

func testPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "test-bucket",
		AccessKeyID:     "AKIDEXAMPLE",
		SecretAccessKey: "secretsecretsecretsecretsecretsecretsecret",
		Region:          "auto",
	})
}

func TestStoreImageKind(t *testing.T) {
	for _, ok := range []string{"logo", "banner"} {
		if _, valid := parseStoreImageKind(ok); !valid {
			t.Errorf("%q should be a valid kind", ok)
		}
	}
	for _, bad := range []string{"", "Logo", "cover", "../logo", "logo/", "banner "} {
		if _, valid := parseStoreImageKind(bad); valid {
			t.Errorf("%q must not be a valid kind", bad)
		}
	}
}

func TestStoreImageKeyIsServerControlledAndScoped(t *testing.T) {
	k := storeImageKey(imgRID, StoreImageBanner, ".png")
	if !strings.HasPrefix(k, "restaurant/"+imgRID+"/store/banner/") || !strings.HasSuffix(k, ".png") {
		t.Fatalf("unexpected key shape: %q", k)
	}
	if k == storeImageKey(imgRID, StoreImageBanner, ".png") {
		t.Fatal("keys must be unguessable and unique per upload")
	}
	if strings.Contains(k, "..") || strings.Contains(k, " ") {
		t.Fatalf("key must be a clean path: %q", k)
	}
}

func TestStoreImageContentTypes(t *testing.T) {
	want := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
	for ext, ct := range want {
		if got := storeImageContentTypeByExt[ext]; got != ct {
			t.Errorf("%s -> %q, want %q", ext, got, ct)
		}
	}
	// SVG can carry script and these images are rendered back to customers; a PDF is not an image.
	for _, ext := range []string{".svg", ".pdf", ".gif", ".html", ""} {
		if _, ok := storeImageContentTypeByExt[ext]; ok {
			t.Errorf("%q must not be uploadable as a store image", ext)
		}
	}
}

func TestClassifyStoreImageRef(t *testing.T) {
	logoKey := storeImageKeyPrefix(imgRID) + "logo/abc123.png"
	bannerKey := storeImageKeyPrefix(imgRID) + "banner/abc123.webp"

	cases := []struct {
		name    string
		kind    StoreImageKind
		ref     string
		wantKey bool
		wantErr bool
	}{
		{"https link passes through", StoreImageLogo, "https://cdn.example.com/a.png", false, false},
		{"http link passes through", StoreImageLogo, "http://cdn.example.com/a.png", false, false},
		{"own logo key", StoreImageLogo, logoKey, true, false},
		{"own banner key", StoreImageBanner, bannerKey, true, false},
		{"empty means no change", StoreImageLogo, "", false, false},
		{"a banner key cannot be used as the logo", StoreImageLogo, bannerKey, false, true},
		{"another restaurant's key is refused", StoreImageLogo, storeImageKeyPrefix(otherRID) + "logo/abc.png", false, true},
		{"a KYB document key is refused", StoreImageLogo, "restaurant/" + imgRID + "/kyb/cac_certificate/abc.pdf", false, true},
		{"path traversal is refused", StoreImageLogo, storeImageKeyPrefix(imgRID) + "logo/../../x.png", false, true},
		{"javascript scheme is refused", StoreImageLogo, "javascript:alert(1)", false, true},
		{"data URI is refused", StoreImageLogo, "data:image/png;base64,AAAA", false, true},
		{"device file URI is refused", StoreImageLogo, "file:///var/mobile/a.png", false, true},
		{"r2 scheme is refused", StoreImageLogo, "r2://bucket/key", false, true},
		{"key with a disallowed extension is refused", StoreImageLogo, storeImageKeyPrefix(imgRID) + "logo/abc.svg", false, true},
		{"bare path is refused", StoreImageLogo, "/images/logo.png", false, true},
	}
	for _, c := range cases {
		isKey, err := classifyStoreImageRef(imgRID, c.kind, c.ref)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: err=%v, wantErr=%v", c.name, err, c.wantErr)
			continue
		}
		if err == nil && isKey != c.wantKey {
			t.Errorf("%s: isKey=%v, want %v", c.name, isKey, c.wantKey)
		}
	}
}

func str(s string) *string { return &s }

func TestViewStoreImage(t *testing.T) {
	signed := &Service{kybPresigner: testPresigner()}
	unsigned := &Service{}
	key := storeImageKeyPrefix(imgRID) + "logo/abc123.png"

	// A minted key becomes a short-lived signed GET for that exact object.
	got := signed.viewStoreImage(str(key))
	if got == nil || !strings.Contains(*got, "abc123.png") || !strings.Contains(*got, "X-Amz-Signature") {
		t.Fatalf("a stored key must resolve to a signed URL, got %v", got)
	}

	// Links, and anything that is not one of OUR keys, are returned exactly as stored —
	// rows written before uploads existed keep rendering.
	for _, legacy := range []string{"https://cdn.example.com/a.png", "/images/legacy.png", "legacy-name.png"} {
		if out := signed.viewStoreImage(str(legacy)); out == nil || *out != legacy {
			t.Errorf("legacy value %q must pass through unchanged, got %v", legacy, out)
		}
	}

	// Nil and empty stay nil: no image, not a broken one.
	if signed.viewStoreImage(nil) != nil || signed.viewStoreImage(str("")) != nil {
		t.Error("nil/empty must stay nil")
	}

	// A key we cannot sign is hidden. Returning the raw key would show the customer a
	// broken image AND leak an internal storage path.
	if out := unsigned.viewStoreImage(str(key)); out != nil {
		t.Errorf("an unsignable key must not be returned, got %q", *out)
	}
	// ...but an unsignable LEGACY value is still returned: nothing is being hidden.
	if out := unsigned.viewStoreImage(str("https://cdn.example.com/a.png")); out == nil {
		t.Error("a link must not depend on the presigner")
	}
}

func TestResolveStoreImagesCoversBothFields(t *testing.T) {
	s := &Service{kybPresigner: testPresigner()}
	logo := storeImageKeyPrefix(imgRID) + "logo/l.png"
	banner := storeImageKeyPrefix(imgRID) + "banner/b.jpg"
	r := &Restaurant{LogoURL: &logo, BannerURL: &banner}
	s.resolveStoreImages(r)
	if r.LogoURL == nil || !strings.Contains(*r.LogoURL, "X-Amz-Signature") {
		t.Errorf("logo not resolved: %v", r.LogoURL)
	}
	if r.BannerURL == nil || !strings.Contains(*r.BannerURL, "X-Amz-Signature") {
		t.Errorf("banner not resolved: %v", r.BannerURL)
	}
	s.resolveStoreImages(nil) // must not panic
}
