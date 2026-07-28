package connectfeed

import "testing"

// Reaction uniqueness: the toggle decision guarantees at most one reaction row per
// (post,user). No prior → insert; same type again → delete (toggle off); different
// type → update the single existing row (never a second insert).
func TestReactionAction_OnePerUserPost(t *testing.T) {
	cases := []struct {
		name        string
		existing    string
		hasExisting bool
		requested   string
		want        string
	}{
		{"first reaction inserts", "", false, "like", reactInsert},
		{"same reaction toggles off", "like", true, "like", reactDelete},
		{"different reaction updates in place", "like", true, "celebrate", reactUpdate},
		{"another different reaction still updates", "support", true, "insightful", reactUpdate},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := reactionAction(tc.existing, tc.hasExisting, tc.requested); got != tc.want {
				t.Fatalf("reactionAction(%q,%v,%q)=%q, want %q",
					tc.existing, tc.hasExisting, tc.requested, got, tc.want)
			}
		})
	}
}

// A change of reaction is never an insert (which would risk a second row); it is
// always an in-place update, so the UNIQUE(post_id,user_id) row count stays at one.
func TestReactionAction_ChangeNeverInserts(t *testing.T) {
	if got := reactionAction("like", true, "curious"); got == reactInsert {
		t.Fatalf("changing reaction must not insert a second row, got %q", got)
	}
}
