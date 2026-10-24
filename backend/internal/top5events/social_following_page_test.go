package top5events

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// The page-size checks run before any database access, so a zero Service is
// enough: these tests need no TEST_DATABASE_URL.
func TestListFollowingEvents_RejectsBadPaging(t *testing.T) {
	svc := &Service{}
	user := uuid.New().String()
	for _, tc := range []struct {
		name          string
		limit, offset int
	}{
		{"limit 0", 0, 0},
		{"limit 101", 101, 0},
		{"limit -1", -1, 0},
		{"offset -1", 20, -1},
	} {
		_, err := svc.ListFollowingEvents(context.Background(), user, tc.limit, tc.offset)
		if !errors.Is(err, ErrValidation) {
			t.Fatalf("%s: err = %v, want ErrValidation", tc.name, err)
		}
		if got := socialStatus(err); got != 422 {
			t.Fatalf("%s: status = %d, want 422", tc.name, got)
		}
	}
}

func TestFollowingPage_ParsesAndValidates(t *testing.T) {
	if l, o, err := followingPage("", ""); err != nil || l != 20 || o != 0 {
		t.Fatalf("defaults = %d,%d,%v, want 20,0,nil", l, o, err)
	}
	if l, o, err := followingPage("100", "5"); err != nil || l != 100 || o != 5 {
		t.Fatalf("100/5 = %d,%d,%v", l, o, err)
	}
	for _, c := range [][2]string{{"0", ""}, {"101", ""}, {"abc", ""}, {"", "-1"}, {"", "x"}} {
		if _, _, err := followingPage(c[0], c[1]); !errors.Is(err, ErrValidation) {
			t.Fatalf("followingPage(%q,%q) err = %v, want ErrValidation", c[0], c[1], err)
		}
	}
}
