package healthpharmacy

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

type fakePresigner struct{ configured bool }

func (f fakePresigner) Configured() bool { return f.configured }
func (f fakePresigner) PresignPut(key, _ string, _ time.Duration) (string, error) {
	return "https://r2.test/" + key, nil
}

func TestPresignRxUpload(t *testing.T) {
	ctx := context.Background()
	s := &Service{}
	if _, err := s.PresignRxUpload(ctx, "p1", "rx.jpg", "image/jpeg"); !errors.Is(err, ErrUploadsNotConfigured) {
		t.Fatalf("no presigner must be ErrUploadsNotConfigured, got %v", err)
	}
	s.SetUploadPresigner(fakePresigner{configured: true})
	p, err := s.PresignRxUpload(ctx, "p1", "rx.JPG", "Image/JPEG")
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	if !strings.HasPrefix(p.StorageKey, "pharmacy-rx/p1/") || !strings.HasSuffix(p.StorageKey, ".jpg") || p.Method != http.MethodPut {
		t.Fatalf("key not scoped to the patient: %+v", p)
	}
	for _, tc := range [][2]string{{"x.exe", "image/jpeg"}, {"rx.jpg", "text/html"}} {
		if _, err := s.PresignRxUpload(ctx, "p1", tc[0], tc[1]); !errors.Is(err, ErrRxUploadInvalid) {
			t.Fatalf("%v must be rejected, got %v", tc, err)
		}
	}
}

// Validation runs before the INSERT (nil-db Service would panic on fallthrough).
func TestRecordRxUpload_Validation(t *testing.T) {
	ctx := context.Background()
	s := &Service{}
	for name, tc := range map[string][4]string{
		"foreign key":  {"pharmacy-rx/someone-else/a.jpg", "image/jpeg", "Ada", ""},
		"traversal":    {"pharmacy-rx/p1/../p2/a.jpg", "image/jpeg", "Ada", ""},
		"content type": {"pharmacy-rx/p1/a.jpg", "text/html", "Ada", ""},
		"blank name":   {"pharmacy-rx/p1/a.jpg", "image/jpeg", "  ", ""},
		"long note":    {"pharmacy-rx/p1/a.jpg", "image/jpeg", "Ada", strings.Repeat("n", 1001)},
	} {
		if _, err := s.RecordRxUpload(ctx, "p1", tc[0], tc[1], tc[2], tc[3]); !errors.Is(err, ErrRxUploadInvalid) {
			t.Errorf("%s: want ErrRxUploadInvalid, got %v", name, err)
		}
	}
}

func TestRxUploadHandlers_Unconfigured503(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/prescriptions/upload/presign", h.PresignRxUpload)
	w := postJSON(t, r, "/prescriptions/upload/presign", `{"file_name":"rx.jpg","content_type":"image/jpeg"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}
