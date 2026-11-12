package consultengine

import (
	"testing"
	"time"
)

func TestWarnLeadIsFiveMinutesOrAProportionalFifth(t *testing.T) {
	cases := []struct {
		window time.Duration
		want   time.Duration
	}{
		{30 * time.Minute, 5 * time.Minute},
		{25 * time.Minute, 5 * time.Minute},
		{20 * time.Minute, 4 * time.Minute},
		{10 * time.Minute, 2 * time.Minute},
		{5 * time.Minute, time.Minute},
		{0, 0},
	}
	for _, tc := range cases {
		if got := WarnLead(tc.window); got != tc.want {
			t.Errorf("WarnLead(%v) = %v, want %v", tc.window, got, tc.want)
		}
	}
}

func TestWarnAtAnchorsToTheBookedWindow(t *testing.T) {
	start := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	ends := start.Add(30 * time.Minute)
	if got, want := WarnAt(start, ends), start.Add(25*time.Minute); !got.Equal(want) {
		t.Fatalf("WarnAt = %v, want %v", got, want)
	}
}

func TestExtensionPriceCeilsToTheKobo(t *testing.T) {
	cases := []struct {
		price    int64
		duration int
		added    int
		want     int64
	}{
		{500_000, 30, 10, 166_667},
		{500_000, 30, 30, 500_000},
		{200_000, 20, 1, 10_000},
		{0, 30, 10, 0},
		{500_000, 0, 10, 0},
	}
	for _, tc := range cases {
		if got := ExtensionPriceKobo(tc.price, tc.duration, tc.added); got != tc.want {
			t.Errorf("ExtensionPriceKobo(%d,%d,%d) = %d, want %d",
				tc.price, tc.duration, tc.added, got, tc.want)
		}
	}
}

func TestJoinTTLIsCappedByTheRemainingSession(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	if got, want := JoinTTL(now, now.Add(20*time.Minute), 10*time.Minute), 10*time.Minute; got != want {
		t.Errorf("plenty of time: got %v, want %v", got, want)
	}
	if got, want := JoinTTL(now, now.Add(30*time.Second), 10*time.Minute), time.Minute; got != want {
		t.Errorf("almost over: got %v, want %v", got, want)
	}
	if got, want := JoinTTL(now, now.Add(90*time.Second), 10*time.Minute), 150*time.Second; got != want {
		t.Errorf("short session: got %v, want %v", got, want)
	}
	if got, want := JoinTTL(now, now.Add(20*time.Minute), 0), DefaultJoinTTL; got != want {
		t.Errorf("unconfigured ttl: got %v, want %v", got, want)
	}
}
