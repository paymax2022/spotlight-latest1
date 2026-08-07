package learner

import "testing"

func TestCellState(t *testing.T) {
	const today = "2026-08-02"
	cases := []struct {
		day     string
		studied bool
		want    string
	}{
		{"2026-08-02", true, "today"},   // today wins over studied
		{"2026-08-02", false, "today"},  // today wins over missed
		{"2026-08-03", false, "future"}, // future wins over missed
		{"2026-08-10", true, "future"},  // future wins over studied
		{"2026-08-01", true, "studied"}, // past + activity
		{"2026-07-15", false, "missed"}, // past + no activity
	}
	for _, tc := range cases {
		if got := cellState(tc.day, today, tc.studied); got != tc.want {
			t.Errorf("cellState(%q,%q,%v) = %q, want %q", tc.day, today, tc.studied, got, tc.want)
		}
	}
}

func TestIconForKind(t *testing.T) {
	for kind, want := range map[string]string{
		"subject": "book", "topic": "layers", "lesson": "play-circle", "past_question": "search", "": "search",
	} {
		if got := iconForKind(kind); got != want {
			t.Errorf("iconForKind(%q) = %q, want %q", kind, got, want)
		}
	}
}
