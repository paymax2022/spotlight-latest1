package healthvet

import (
	"errors"
	"testing"

	"spotlight/backend/internal/health/consultengine"
)

func TestNormalizeVetConsultMode(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    consultengine.Mode
		wantErr bool
	}{
		{"empty defaults to video", "", consultengine.ModeVideo, false},
		{"video", "video", consultengine.ModeVideo, false},
		{"case and padding", "  VIDEO ", consultengine.ModeVideo, false},
		{"tele alias", "tele", consultengine.ModeVideo, false},
		{"voice", "voice", consultengine.ModeVoice, false},
		{"audio alias", "audio", consultengine.ModeVoice, false},
		{"chat", "chat", consultengine.ModeChat, false},
		{"unknown", "fax", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeVetConsultMode(tc.in)
			if tc.wantErr {
				if !errors.Is(err, ErrConsultModeInvalid) {
					t.Fatalf("err = %v, want ErrConsultModeInvalid", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("mode = %q, want %q", got, tc.want)
			}
		})
	}
}

// The vet's unpaid-consult fallback predates LiveKit and is 30 minutes. The
// spec pins it so a legacy tele appointment keeps the length owners saw.
func TestLegacyVetConsultMinutesIsThirty(t *testing.T) {
	if legacyVetConsultMinutes != 30 {
		t.Fatalf("legacyVetConsultMinutes = %d, want 30", legacyVetConsultMinutes)
	}
}
