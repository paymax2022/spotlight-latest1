package notifications

import (
	"spotlight/backend/internal/platform/queue"
	"testing"
)

func TestTaskTypeForChannel(t *testing.T) {
	cases := []struct {
		channel Channel
		want    string
	}{
		{ChannelPush, queue.TypeNotificationPush},
		{ChannelEmail, queue.TypeNotificationEmail},
		{ChannelSMS, queue.TypeNotificationSMS},
		{ChannelInApp, ""},
		{Channel("carrier_pigeon"), ""},
	}
	for _, tc := range cases {
		if got := taskTypeForChannel(tc.channel); got != tc.want {
			t.Errorf("taskTypeForChannel(%q) = %q, want %q", tc.channel, got, tc.want)
		}
	}
}
