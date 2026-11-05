package config

import "testing"

func TestConsultUsesLiveKit(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"unset defaults to livekit", "", true},
		{"livekit", "livekit", true},
		{"case and padding", "  LiveKit ", true},
		{"videosdk rollback", "videosdk", false},
		{"videosdk any case", "VideoSDK", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := (Config{ConsultMediaProvider: tc.raw}).ConsultUsesLiveKit(); got != tc.want {
				t.Fatalf("ConsultUsesLiveKit() = %v, want %v", got, tc.want)
			}
		})
	}
}
