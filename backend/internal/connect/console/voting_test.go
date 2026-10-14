package connectconsole

import "testing"

func TestParseContestStatus(t *testing.T) {
	for in, ok := range map[string]bool{"": true, "all": true, "scheduled": true, "live": true, "closed": true, "finalized": true, "open": false, "draft": false, "LIVE": false} {
		if _, got := parseContestStatus(in); got != ok {
			t.Errorf("%q ok=%v want %v", in, got, ok)
		}
	}
}

func TestMergeEntrantsCoversRosterAndPollOptions(t *testing.T) {
	roster := []rosterEntry{{ID: "c1", Name: "Ada"}, {ID: "c2", Name: "Bayo"}}
	tallies := map[string]tally{
		"c1":         {Paid: 3, Free: 2, Kobo: 30000},
		"poll-label": {Paid: 1, Free: 0, Kobo: 10000}, // not on the roster: a plain poll option or a phantom
	}
	got := mergeEntrants(roster, tallies)
	if len(got) != 3 {
		t.Fatalf("entrants = %+v", got)
	}
	if got[0].ID != "c1" || got[0].Name != "Ada" || got[0].PaidVotes != 3 || got[0].FreeVotes != 2 {
		t.Fatalf("top entrant = %+v", got[0])
	}
	byID := map[string]ContestEntrant{}
	for _, e := range got {
		byID[e.ID] = e
	}
	if byID["c2"].Name != "Bayo" || byID["c2"].PaidVotes != 0 {
		t.Fatalf("a roster entrant with no votes must still be listed: %+v", byID["c2"])
	}
	if byID["poll-label"].Name != "poll-label" {
		t.Fatalf("an off-roster option is named by its label: %+v", byID["poll-label"])
	}
}

func TestMergeEntrantsOrdersByTotalVotesThenName(t *testing.T) {
	got := mergeEntrants([]rosterEntry{{ID: "a", Name: "Zed"}, {ID: "b", Name: "Amy"}, {ID: "c", Name: "Bob"}},
		map[string]tally{"a": {Paid: 1}, "b": {Free: 1}, "c": {Paid: 5}})
	if got[0].ID != "c" || got[1].Name != "Amy" || got[2].Name != "Zed" {
		t.Fatalf("order = %+v", got)
	}
}

func TestContestWithoutIntegrityDataReportsNull(t *testing.T) {
	s := contestSummaryOf(contestRow{ID: "k1", Title: "T", Status: "live"})
	if s.IntegrityScore != nil || s.FlagsOpen != nil {
		t.Fatalf("integrity is not stored: it must be null, got %+v", s)
	}
	if s.StartsAt != nil || s.EndsAt != nil {
		t.Fatalf("dates must stay null when unset: %+v", s)
	}
}
