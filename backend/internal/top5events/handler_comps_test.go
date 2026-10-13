package top5events

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

// compsStatus is the sentinel→HTTP contract for the comp/announce routes. The
// 409 cases (ErrSoldOut, ErrNotPurchasable) and the 400 case (ErrValidation)
// matter most: a regression that let any of them fall through to 500 would be
// invisible in the live handler tests, which don't exercise those paths.
func TestCompsStatus(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"not_found", ErrNotFound, http.StatusNotFound},
		{"forbidden", ErrForbidden, http.StatusForbidden},
		{"sold_out", ErrSoldOut, http.StatusConflict},
		{"not_purchasable", ErrNotPurchasable, http.StatusConflict},
		{"validation", ErrValidation, http.StatusBadRequest},
		{"wrapped_sold_out", fmt.Errorf("issue: %w", ErrSoldOut), http.StatusConflict},
		{"wrapped_validation", fmt.Errorf("bad: %w", ErrValidation), http.StatusBadRequest},
		{"unknown", errors.New("boom"), http.StatusInternalServerError},
	}
	for _, c := range cases {
		if got := compsStatus(c.err); got != c.want {
			t.Errorf("compsStatus(%s) = %d, want %d", c.name, got, c.want)
		}
	}
}
