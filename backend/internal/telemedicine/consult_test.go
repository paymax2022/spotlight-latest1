package telemedicine

import (
	"errors"
	"testing"

	"spotlight/backend/internal/health/consultengine"
)

func TestNormalizeConsultMode(t *testing.T) {
	cases := map[string]consultengine.Mode{
		"":      consultengine.ModeVideo,
		"video": consultengine.ModeVideo,
		"VIDEO": consultengine.ModeVideo,
		"audio": consultengine.ModeVoice,
		"voice": consultengine.ModeVoice,
		"chat":  consultengine.ModeChat,
	}
	for in, want := range cases {
		got, err := normalizeConsultMode(in)
		if err != nil || got != want {
			t.Fatalf("%q -> %q/%v, want %q", in, got, err, want)
		}
	}
	if _, err := normalizeConsultMode("in_person"); !errors.Is(err, ErrConsultModeInvalid) {
		t.Fatalf("in_person: err = %v, want ErrConsultModeInvalid", err)
	}
}

func TestModuleConsultTypeSpellsVoiceAsAudio(t *testing.T) {
	if got := moduleConsultType(consultengine.ModeVoice); got != "audio" {
		t.Fatalf("voice -> %q, want audio", got)
	}
	if got := moduleConsultType(consultengine.ModeChat); got != "chat" {
		t.Fatalf("chat -> %q", got)
	}
}

// The package price replaces the doctor's consult fee as the priced amount;
// the platform booking fee still rides on top, so the escrow, the receipt and
// the session snapshot all agree.
func TestPackagePriceDrivesTheBookingQuote(t *testing.T) {
	svc := (&Service{}).WithPlatformFeeBp(PlatformFeeBp)
	q := svc.quote(700_000)
	if q.ConsultFeeKobo != 700_000 || q.PlatformFeeKobo != 35_000 || q.TotalKobo != 735_000 {
		t.Fatalf("quote = %+v", q)
	}
}
