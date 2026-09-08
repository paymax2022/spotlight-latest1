package transfers_test

import (
	"errors"
	"net/http"
	"testing"

	"spotlight/backend/internal/finance/transfers"
)

// ---------------------------------------------------------------------------
// Wallet-to-wallet recipient resolution.
//
// The resolver used to compare RAW strings (`WHERE phone = $1`) against a column
// that was never normalised, so the same subscriber failed to resolve whenever
// the sender's format differed from the stored one — "08159491618" vs
// "8159491618" vs "+2348159491618" are all the same person and all missed.
//
// These tests pin the two properties that matter for money:
//   1. every spelling of one number resolves to the SAME account, and
//   2. when two accounts share a number the resolver REFUSES rather than
//      guessing — paying the wrong person is unrecoverable.
// ---------------------------------------------------------------------------

const (
	nsn = "8159491618" // the canonical 10-digit national significant number

	storedBare  = "8159491618"     // as one real row actually holds it
	storedLocal = "08159491618"    // leading-zero local form
	storedE164  = "+2348159491618" // full international form
)

// TestNormalizeRecipientPhone: every spelling of one number collapses to one NSN,
// and anything that cannot be a Nigerian mobile is rejected outright (so it can
// never be used as a loose "contains" probe against the whole user table).
func TestNormalizeRecipientPhone(t *testing.T) {
	same := []string{
		storedBare,
		storedLocal,
		storedE164,
		"2348159491618",
		"+234 815 949 1618",
		"0815-949-1618",
		"  08159491618  ",
	}
	for _, in := range same {
		if got := transfers.NormalizeRecipientPhone(in); got != nsn {
			t.Errorf("NormalizeRecipientPhone(%q) = %q, want %q", in, got, nsn)
		}
	}

	rejected := []string{
		"",
		"   ",
		"abc",
		"12345",           // too short
		"815949161",       // 9 digits
		"12345678901234",  // not a Nigerian shape
		"+1 415 555 0100", // wrong country
	}
	for _, in := range rejected {
		if got := transfers.NormalizeRecipientPhone(in); got != "" {
			t.Errorf("NormalizeRecipientPhone(%q) = %q, want \"\" (unusable input must not match anything)", in, got)
		}
	}
}

// TestChooseRecipientMatchesEveryStoredFormat is the actual regression: whatever
// format the row was stored in, the NSN lookup must find that one account.
func TestChooseRecipientMatchesEveryStoredFormat(t *testing.T) {
	for _, stored := range []string{storedBare, storedLocal, storedE164, "2348159491618"} {
		rows := []transfers.RecipientCandidate{
			{UserID: "u-1", FullName: "Ada Obi", Phone: stored},
		}
		got, err := transfers.ChooseRecipient(nsn, rows)
		if err != nil {
			t.Fatalf("stored as %q: unexpected error %v", stored, err)
		}
		if got.UserID != "u-1" {
			t.Errorf("stored as %q: UserID = %q, want u-1", stored, got.UserID)
		}
		if got.Phone != stored {
			t.Errorf("stored as %q: Phone = %q, want the stored value verbatim", stored, got.Phone)
		}
	}
}

// TestChooseRecipientRefusesAmbiguous is the money-safety gate. Two accounts
// carrying the same number is a data defect; picking either one could pay a
// stranger, and the payment is irreversible. Refuse, and return NOTHING.
func TestChooseRecipientRefusesAmbiguous(t *testing.T) {
	rows := []transfers.RecipientCandidate{
		{UserID: "u-1", FullName: "Ada Obi", Phone: storedLocal},
		{UserID: "u-2", FullName: "Bola Eze", Phone: storedE164},
	}
	got, err := transfers.ChooseRecipient(nsn, rows)
	if !errors.Is(err, transfers.ErrAmbiguousRecipient) {
		t.Fatalf("two accounts on one number: got %v, want ErrAmbiguousRecipient", err)
	}
	if got.UserID != "" || got.FullName != "" || got.Phone != "" {
		t.Fatalf("ambiguous resolve leaked a candidate: %+v — a caller could pay the wrong person", got)
	}
}

// TestChooseRecipientNoMatch: an empty NSN or an empty candidate set is a plain
// 404, never a panic and never a zero-value "match".
func TestChooseRecipientNoMatch(t *testing.T) {
	if _, err := transfers.ChooseRecipient("", []transfers.RecipientCandidate{{UserID: "u-1", Phone: storedLocal}}); !errors.Is(err, transfers.ErrRecipientNotFound) {
		t.Errorf("empty nsn: got %v, want ErrRecipientNotFound", err)
	}
	if _, err := transfers.ChooseRecipient(nsn, nil); !errors.Is(err, transfers.ErrRecipientNotFound) {
		t.Errorf("no rows: got %v, want ErrRecipientNotFound", err)
	}
}

// TestChooseRecipientRejectsNonMatchingRows is defence in depth against the SQL
// and Go disagreeing. The index expression is right(digits,10), which happily
// takes the last 10 digits of a 14-digit foreign number; Go's normalisation
// rejects that shape. Go is authoritative — a row it cannot normalise to the
// requested NSN must be discarded, not returned.
func TestChooseRecipientRejectsNonMatchingRows(t *testing.T) {
	rows := []transfers.RecipientCandidate{
		{UserID: "u-junk", FullName: "Wrong Person", Phone: "99998159491618"},
	}
	if _, err := transfers.ChooseRecipient(nsn, rows); !errors.Is(err, transfers.ErrRecipientNotFound) {
		t.Fatalf("row that does not normalise to the NSN must not match: got %v", err)
	}

	// One good row alongside one junk row still resolves — and is NOT ambiguous,
	// because the junk row was never a real candidate.
	rows = append(rows, transfers.RecipientCandidate{UserID: "u-1", FullName: "Ada Obi", Phone: storedBare})
	got, err := transfers.ChooseRecipient(nsn, rows)
	if err != nil {
		t.Fatalf("one real match among junk: unexpected error %v", err)
	}
	if got.UserID != "u-1" {
		t.Errorf("UserID = %q, want u-1", got.UserID)
	}
}

// TestAmbiguousRecipientHTTPMapping wires the new sentinel into the envelope the
// API already promises.
func TestAmbiguousRecipientHTTPMapping(t *testing.T) {
	if code := transfers.HTTPStatusForError(transfers.ErrAmbiguousRecipient); code != http.StatusConflict {
		t.Errorf("HTTPStatusForError(ErrAmbiguousRecipient) = %d, want 409", code)
	}
	if code := transfers.ErrorCode(transfers.ErrAmbiguousRecipient); code != "ambiguous_recipient" {
		t.Errorf("ErrorCode(ErrAmbiguousRecipient) = %q, want ambiguous_recipient", code)
	}
}
