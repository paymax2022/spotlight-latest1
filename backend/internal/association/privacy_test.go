package association

// Covers the memberPrivacy decoder — the single place the stored privacy
// jsonb turns into effective visibility. The column defaults to '{}' (rows
// predating the settings screen), so key PRESENCE is what distinguishes
// "explicitly turned off" from "never set", and the defaults differ per
// flag. A regression here either re-leaks contact data a member hid or
// mass-hides every existing member from the directory.
import "testing"

func TestMemberPrivacy(t *testing.T) {
	visible := effectivePrivacy{InDirectory: true, Profession: true, Email: true, Phone: true}
	defaults := effectivePrivacy{InDirectory: true, Profession: true, Email: false, Phone: false}

	cases := []struct {
		name string
		raw  string
		want effectivePrivacy
	}{
		{"sql NULL / empty bytes", "", defaults},
		{"schema default {}", "{}", defaults},
		{"null literal", "null", defaults},
		{"malformed json", "{not json", defaults},
		{"all explicitly on", `{"showEmail":true,"showPhone":true,"showInDirectory":true,"showProfession":true}`, visible},
		{
			"all explicitly off",
			`{"showEmail":false,"showPhone":false,"showInDirectory":false,"showProfession":false}`,
			effectivePrivacy{},
		},
		{
			"email hidden only",
			`{"showEmail":false}`,
			effectivePrivacy{InDirectory: true, Profession: true, Email: false, Phone: false},
		},
		{
			"directory opt-out keeps field defaults",
			`{"showInDirectory":false}`,
			effectivePrivacy{InDirectory: false, Profession: true, Email: false, Phone: false},
		},
		{
			"profession hidden only",
			`{"showProfession":false}`,
			effectivePrivacy{InDirectory: true, Profession: false, Email: false, Phone: false},
		},
		{
			"phone shown only",
			`{"showPhone":true}`,
			effectivePrivacy{InDirectory: true, Profession: true, Email: false, Phone: true},
		},
		// A non-boolean value is not an opt-out — a corrupt/foreign shape
		// must fall back to the flag's default, never to hidden-by-accident.
		{"non-bool ignored", `{"showInDirectory":"yes","showEmail":1}`, defaults},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := memberPrivacy([]byte(tc.raw))
			if got != tc.want {
				t.Errorf("memberPrivacy(%s) = %+v, want %+v", tc.raw, got, tc.want)
			}
		})
	}
}
