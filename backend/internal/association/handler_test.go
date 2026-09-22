package association

// Closes the TODO in docs/qa/modules/association.md §3/§7: the handler layer
// (statusFor mapping) was previously untested — only the service layer had
// coverage. A wrong mapping here is invisible to every live-DB service test
// in tests/association, since those call the service directly and never go
// through statusFor at all.

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestStatusFor_MapsErrorsToHTTPStatus(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"idempotency key required", ErrIdempotencyRequired, http.StatusBadRequest},
		{"invalid ballot", ErrInvalidBallot, http.StatusBadRequest},
		{"invalid input", ErrInvalidInput, http.StatusBadRequest},
		{"forbidden", ErrForbidden, http.StatusForbidden},
		{"ineligible", ErrIneligible, http.StatusForbidden},
		{"voting closed", ErrVotingClosed, http.StatusForbidden},
		{"election state", ErrElectionState, http.StatusConflict},
		{"no membership", ErrNoMembership, http.StatusNotFound},
		{"pgx no rows", pgx.ErrNoRows, http.StatusNotFound},
		{"wrapped forbidden", errWrap(ErrForbidden), http.StatusForbidden},
		{"unknown/generic error", errors.New("association: something else broke"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := statusFor(tc.err)
			if got != tc.want {
				t.Errorf("statusFor(%v) = %d, want %d", tc.err, got, tc.want)
			}
		})
	}
}

// errWrap mimics the fmt.Errorf("...: %w", err) wrapping every service method
// in this package actually uses — statusFor MUST match via errors.Is, not a
// direct == comparison, or every real wrapped error would fall through to
// the generic 500 default. This is the exact regression the wrapped-forbidden
// case above guards.
func errWrap(err error) error {
	return &wrappedErr{msg: "association: some context", err: err}
}

type wrappedErr struct {
	msg string
	err error
}

func (w *wrappedErr) Error() string { return w.msg + ": " + w.err.Error() }
func (w *wrappedErr) Unwrap() error { return w.err }
