package connectdiscovery

import (
	"encoding/json"
	"testing"
)

// The mobile profile-detail screen reads profile.photos.map(...),
// profile.interests.length and profile.prompts.length with NO null guard, so the
// wire shape must always carry real arrays — never null — or the screen crashes.
func TestAssemblePublicProfile_CollectionsNeverNull(t *testing.T) {
	pp := assemblePublicProfile(rawPublicProfile{id: "p1"}, nil, "")

	if pp.Photos == nil || pp.Interests == nil || pp.Prompts == nil || pp.Verified == nil {
		t.Fatalf("collections must be non-nil slices: %+v", pp)
	}

	// Confirm the JSON emits [] and not null for every collection.
	b, err := json.Marshal(pp)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"photos", "interests", "prompts", "verified"} {
		if string(raw[key]) != "[]" {
			t.Fatalf("%s = %s, want []", key, raw[key])
		}
	}
}

func TestAssemblePublicProfile_MapsFields(t *testing.T) {
	name, city, headline, bio := "Amara", "Lagos", "Designer", "Hello there"
	age := 27
	rp := rawPublicProfile{
		id:          "p1",
		displayName: &name,
		city:        &city,
		headline:    &headline,
		bio:         &bio,
		interests:   []string{"Music", "Travel"},
		age:         &age,
		verified:    true,
	}
	pp := assemblePublicProfile(rp, []string{"https://cdn/x.jpg"}, "within 25 km")

	if pp.ID != "p1" || pp.DisplayName != "Amara" || pp.City != "Lagos" ||
		pp.Headline != "Designer" || pp.Bio != "Hello there" || pp.Age != 27 {
		t.Fatalf("scalar fields not mapped: %+v", pp)
	}
	if len(pp.Interests) != 2 || len(pp.Photos) != 1 || pp.DistanceLabel != "within 25 km" {
		t.Fatalf("collections/distance not mapped: %+v", pp)
	}
	if len(pp.Verified) != 1 || pp.Verified[0] != "identity" {
		t.Fatalf("verified bool should map to [identity]: %+v", pp.Verified)
	}
}

func TestPublicVerifiedFlags(t *testing.T) {
	if got := publicVerifiedFlags(false); len(got) != 0 {
		t.Fatalf("unverified → %v, want []", got)
	}
	if got := publicVerifiedFlags(true); len(got) != 1 || got[0] != "identity" {
		t.Fatalf("verified → %v, want [identity]", got)
	}
}

// A zero/negative age (no DOB on profile) must stay 0, not surface a bogus value.
func TestAssemblePublicProfile_MissingAgeStaysZero(t *testing.T) {
	if pp := assemblePublicProfile(rawPublicProfile{id: "p1"}, nil, ""); pp.Age != 0 {
		t.Fatalf("missing age = %d, want 0", pp.Age)
	}
	zero := 0
	if pp := assemblePublicProfile(rawPublicProfile{id: "p1", age: &zero}, nil, ""); pp.Age != 0 {
		t.Fatalf("zero age = %d, want 0", pp.Age)
	}
}
