package healthlab

import (
	"errors"
	"testing"
	"time"
)

func fptr(v float64) *float64 { return &v }

func TestValidateCollectionDetails(t *testing.T) {
	soon := time.Now().Add(2 * time.Hour)
	past := time.Now().Add(-3 * time.Hour)
	far := time.Now().Add(120 * 24 * time.Hour)

	cases := []struct {
		name    string
		in      CreateOrderInput
		wantErr bool
	}{
		{"home with address and time", CreateOrderInput{CollectionMethod: CollectHome, CollectionAddress: "12 Ozumba Mbadiwe", ScheduledFor: &soon}, false},
		{"home without address", CreateOrderInput{CollectionMethod: CollectHome}, true},
		{"home with blank address", CreateOrderInput{CollectionMethod: CollectHome, CollectionAddress: "   "}, true},
		{"lat without lng", CreateOrderInput{CollectionMethod: CollectHome, CollectionAddress: "x", CollectionLat: fptr(6.4)}, true},
		{"latitude out of range", CreateOrderInput{CollectionMethod: CollectHome, CollectionAddress: "x", CollectionLat: fptr(95), CollectionLng: fptr(3)}, true},
		{"time in the past", CreateOrderInput{CollectionMethod: CollectHome, CollectionAddress: "x", ScheduledFor: &past}, true},
		{"time too far ahead", CreateOrderInput{CollectionMethod: CollectHome, CollectionAddress: "x", ScheduledFor: &far}, true},
		{"walk-in needs none", CreateOrderInput{CollectionMethod: CollectWalkIn}, false},
	}
	for _, tc := range cases {
		in := tc.in
		err := validateCollectionDetails(&in)
		if (err != nil) != tc.wantErr {
			t.Errorf("%s: err=%v wantErr=%v", tc.name, err, tc.wantErr)
		}
		if err != nil && !errors.Is(err, ErrBadCollectionInput) {
			t.Errorf("%s: want ErrBadCollectionInput, got %v", tc.name, err)
		}
	}

	walk := CreateOrderInput{CollectionMethod: CollectWalkIn, CollectionAddress: "ignored", ScheduledFor: &soon}
	_ = validateCollectionDetails(&walk)
	if walk.CollectionAddress != "" || walk.ScheduledFor != nil {
		t.Error("a walk-in order must not keep home-collection details")
	}
}

func TestChecklistTemplate_FastingOnlyWhenNeeded(t *testing.T) {
	has := func(items []ChecklistItem, id string) bool {
		for _, it := range items {
			if it.ID == id {
				return true
			}
		}
		return false
	}
	if has(checklistTemplate(false), "fasting") || !has(checklistTemplate(true), "fasting") {
		t.Fatal("the fasting step must appear only when a fasting test is ordered")
	}
	for _, it := range checklistTemplate(true) {
		if it.ID == "comfort" && it.Required {
			t.Fatal("the comfort step is optional")
		}
	}
}

func TestAssignmentStatus(t *testing.T) {
	cases := []struct{ sample, coll, want string }{
		{"", "", "assigned"},
		{"", "EN_ROUTE", "en_route"},
		{"", "ARRIVED", "arrived"},
		{"COLLECTED", "ARRIVED", "collected"},
		{"IN_CUSTODY", "", "collected"},
		{"HANDED_OVER", "", "dropped_off"},
		{"ACCESSIONED", "", "dropped_off"},
	}
	for _, c := range cases {
		if got := assignmentStatus(c.sample, c.coll); got != c.want {
			t.Errorf("assignmentStatus(%q,%q) = %q, want %q", c.sample, c.coll, got, c.want)
		}
	}
}

func TestBarcodePattern(t *testing.T) {
	for _, ok := range []string{"LAB-ABC123", "A1B2C3", "TUBE-2026-0001"} {
		if !barcodePattern.MatchString(ok) {
			t.Errorf("%q should be accepted", ok)
		}
	}
	for _, bad := range []string{"", "ab", "short", "has space 123", "-LEADING1", "lowercase1"} {
		if barcodePattern.MatchString(bad) {
			t.Errorf("%q should be rejected", bad)
		}
	}
}
