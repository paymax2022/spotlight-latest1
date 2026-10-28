package kycverify

import (
	"net/http"
	"testing"
)

func TestIDTypeAlreadyUsed(t *testing.T) {
	cases := []struct {
		name string
		used []string
		id   string
		want bool
	}{
		{"same type", []string{"bvn"}, "BVN", true},
		{"case and space insensitive", []string{"BVN"}, " bvn ", true},
		{"different type", []string{"bvn"}, "NIN", false},
		{"one of several", []string{"bvn", "passport"}, "passport", true},
		{"nothing used yet", nil, "BVN", false},
		{"empty id type never matches", []string{"bvn"}, "", false},
	}
	for _, tc := range cases {
		if got := idTypeAlreadyUsed(tc.used, tc.id); got != tc.want {
			t.Errorf("%s: idTypeAlreadyUsed(%v, %q) = %v, want %v", tc.name, tc.used, tc.id, got, tc.want)
		}
	}
}

func TestErrIDTypeAlreadyUsedIsConflict(t *testing.T) {
	if got := errMap.Code(ErrIDTypeAlreadyUsed); got != http.StatusConflict {
		t.Fatalf("ErrIDTypeAlreadyUsed maps to %d, want %d", got, http.StatusConflict)
	}
}
