package connectnetprofile

import (
	"sort"
	"testing"
)

// TestComputeStrength covers the PR-11 pure calc: completion + verification
// weighting, recommendation credit capping, and clamping.
func TestComputeStrength(t *testing.T) {
	cases := []struct {
		name    string
		signals StrengthSignals
		want    int
	}{
		{"empty", StrengthSignals{}, 0},
		{"experience only", StrengthSignals{HasExperience: true}, wExperience},
		{"education only", StrengthSignals{HasEducation: true}, wEducation},
		{"about only", StrengthSignals{HasAbout: true}, wAbout},
		{"verified only", StrengthSignals{VerifiedBadge: true}, wVerified},
		{"assessment only", StrengthSignals{PassedAssessment: true}, wAssessment},
		{"one reco", StrengthSignals{AcceptedRecommendations: 1}, wPerReco},
		{"three recos capped", StrengthSignals{AcceptedRecommendations: 3}, maxRecoCredit},
		{"ten recos still capped", StrengthSignals{AcceptedRecommendations: 10}, maxRecoCredit},
		{"negative recos clamped", StrengthSignals{AcceptedRecommendations: -5}, 0},
		{
			"fully complete = 100",
			StrengthSignals{
				HasExperience: true, HasEducation: true, HasAbout: true,
				VerifiedBadge: true, PassedAssessment: true, AcceptedRecommendations: 3,
			},
			100,
		},
		{
			"complete-but-unverified never reaches all_star band",
			StrengthSignals{
				HasExperience: true, HasEducation: true, HasAbout: true,
				AcceptedRecommendations: 3,
			},
			wExperience + wEducation + wAbout + maxRecoCredit, // 65
		},
	}
	for _, c := range cases {
		if got := ComputeStrength(c.signals); got != c.want {
			t.Errorf("%s: ComputeStrength=%d want %d", c.name, got, c.want)
		}
	}
}

// TestStrengthBand covers band boundaries and the PN-1-relevant property that a
// completion-only (unverified) profile cannot land in the top band.
func TestStrengthBand(t *testing.T) {
	cases := []struct {
		score int
		want  string
	}{
		{0, "beginner"},
		{29, "beginner"},
		{30, "intermediate"},
		{59, "intermediate"},
		{60, "strong"},
		{84, "strong"},
		{85, "all_star"},
		{100, "all_star"},
	}
	for _, c := range cases {
		if got := StrengthBand(c.score); got != c.want {
			t.Errorf("StrengthBand(%d)=%q want %q", c.score, got, c.want)
		}
	}

	// PN-3 spirit: a fully-completed but unverified profile (score 65) is at most
	// "strong", never "all_star" — verification must contribute.
	unverified := ComputeStrength(StrengthSignals{
		HasExperience: true, HasEducation: true, HasAbout: true, AcceptedRecommendations: 3,
	})
	if band := StrengthBand(unverified); band == "all_star" {
		t.Errorf("unverified complete profile reached all_star band (score %d) — verification not weighted", unverified)
	}
}

// TestBuildStrengthView asserts the PN-1-safe projection: it exposes a band and
// the missing sections, and (by type) never a raw numeric score.
func TestBuildStrengthView(t *testing.T) {
	v := BuildStrengthView(StrengthSignals{HasExperience: true})
	if v.Band != StrengthBand(ComputeStrength(StrengthSignals{HasExperience: true})) {
		t.Errorf("band mismatch: %q", v.Band)
	}
	got := append([]string{}, v.Missing...)
	sort.Strings(got)
	want := []string{"about", "education", "recommendations", "skill_assessment", "verification"}
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("missing sections=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("missing sections=%v want %v", got, want)
		}
	}

	// A complete profile has no missing sections.
	full := BuildStrengthView(StrengthSignals{
		HasExperience: true, HasEducation: true, HasAbout: true,
		VerifiedBadge: true, PassedAssessment: true, AcceptedRecommendations: 3,
	})
	if len(full.Missing) != 0 {
		t.Errorf("complete profile still reports missing=%v", full.Missing)
	}
	if full.Band != "all_star" {
		t.Errorf("complete profile band=%q want all_star", full.Band)
	}
}
