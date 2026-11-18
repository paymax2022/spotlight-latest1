package transfers

// Cashtag recipients on the wallet-to-wallet rail.
//
// contracts/openapi.yaml has documented the transfer recipient as
// "phone, email, or Paymax username" since the rail was specified; only phone
// (and, in the Next BFF, email) was ever implemented. This closes that leg:
// `@bisi` and `$bisi` address the account that claimed that handle, and the
// money movement that follows is the SAME wallet-to-wallet mutation — transaction
// PIN, tier daily limit, fee schedule, one wallet_transfers row, the same audit
// event — as a phone send. Nothing here posts a second kind of transfer.
//
// The sigil is what makes it safe. A wallet credit cannot be clawed back, and the
// handle grammar `[a-z0-9][a-z0-9_]{2,29}` admits strings that are also digit
// runs, so a BARE `bisi` is never read as a cashtag: it keeps its current
// meaning, which is "not a phone, not an email, 404". Guessing which identifier
// the sender meant would be the same failure ErrAmbiguousRecipient exists to
// refuse.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/cashtag"
)

// ParseCashtagRecipient recognises a cashtag-addressed recipient and returns the
// NORMALISED handle (lower-cased, sigil stripped) to look up.
//
// Deliberately NOT reused from cashtag.Normalize: that helper strips '@' only,
// so it cannot see the '$' form this rail accepts, and its '@' stripping is what
// makes a handle and an email address indistinguishable to a shared helper. The
// shape check goes through cashtag.IsValidShape so the directory and this rail
// can never disagree about what a handle is — the same reason
// NormalizeRecipientPhone delegates to services.NormalizePhone.
func ParseCashtagRecipient(raw string) (string, bool) {
	t := strings.TrimSpace(raw)
	if len(t) < 2 {
		return "", false
	}
	if t[0] != '@' && t[0] != '$' {
		return "", false
	}
	handle := strings.ToLower(strings.TrimSpace(t[1:]))
	if !cashtag.IsValidShape(handle) {
		return "", false
	}
	return handle, true
}

// cashtagLookupFailure decides what a failed cashtag lookup MEANS to the caller.
//
// Two answers, and the difference is the whole point:
//
//   - "nobody holds that handle" → ErrRecipientNotFound (404). The sender's input
//     is the problem; re-typing it cannot help, and the client should say so.
//   - "we could not tell" (pool exhausted, statement timeout, cancelled request)
//     → the error itself, which HTTPStatusForError maps to 500 by its fail-closed
//     default. The directory was briefly blind, not empty.
//
// Collapsing the second into the first is what the Next BFF does NOT do —
// wallet-to-wallet.ts throws 500 for a directory or profile error — so a handle
// would answer "unclaimed" to the web app and "outage" to the mobile app for the
// same database at the same moment. On a money path the 404 is the dangerous
// half: it tells the sender to give up on a recipient that exists.
func cashtagLookupFailure(err error) error {
	// Only these two answers mean "the sender's identifier resolves to nobody".
	if errors.Is(err, cashtag.ErrNotFound) || errors.Is(err, pgx.ErrNoRows) {
		return ErrRecipientNotFound
	}
	// Anything else is the database failing. Returned wrapped so HTTPStatusForError
	// falls through to its fail-closed 500 and the driver's reason survives for
	// whoever has to read the log.
	return fmt.Errorf("transfers: cashtag recipient lookup failed: %w", err)
}

// errCashtagDirectoryUnwired is deliberately NOT one of the 404/409 sentinels
// registered in decision.go: an unwired directory is a deployment bug, not an
// answer about the recipient, and HTTPStatusForError's fail-closed default gives
// it the 500 it deserves (code `internal_error`).
var errCashtagDirectoryUnwired = errors.New("transfers: cashtag directory not configured")

// resolveByCashtag answers the @handle branch of ResolvePaymaxUser.
//
// The directory guarantees exactly one account per handle (uq_cashtag_handle),
// so the ambiguity refusal the phone leg needs cannot arise here, and no
// re-normalisation pass is required. An unclaimed handle is ErrRecipientNotFound
// (404) — the same answer the phone leg gives for a number no account carries,
// and the answer that leaks nothing about whether the name is reserved. A lookup
// that could not be answered at all is NOT folded into that 404; see
// cashtagLookupFailure.
func (s *Service) resolveByCashtag(ctx context.Context, handle string) (*WalletTransferResolveResponse, error) {
	if s.handles == nil {
		// Fail closed, and fail loudly: falling through to phone matching would
		// answer "no such number" for an input that was never a number, and
		// answering 404 would blame the sender's handle for a missing wiring line.
		log.Printf("[transfers] cashtag directory not wired — cannot address a handle recipient")
		return nil, errCashtagDirectoryUnwired
	}
	userID, err := s.handles.Resolve(ctx, handle)
	if err != nil {
		if !errors.Is(err, cashtag.ErrNotFound) {
			log.Printf("[transfers] cashtag resolve failed: %v", err)
		}
		return nil, cashtagLookupFailure(err)
	}

	// The preview shape is the phone leg's shape: name plus masked number, so the
	// confirmation screen shows the recipient the sender can already recognise.
	// A claimed handle whose profile row is missing is a data defect — refuse
	// rather than move money to an account we cannot name.
	//
	// COALESCE is not decoration. `phone` is nullable, and the phone leg never
	// sees a NULL only because its WHERE clause excludes them; this leg looks the
	// owner up by user_id, so it reads the row as it is. Scanning NULL into
	// RecipientCandidate.Phone errors out, and an error here refuses the send —
	// which would make a handle owned by a phone-less account unpayable from this
	// rail while the BFF happily resolves it. Pinned live by
	// cashtag_livedb_test.go:TestLiveDB_CashtagRecipient_PhonelessProfileIsStillPayable.
	var candidate RecipientCandidate
	const q = `SELECT id, full_name, COALESCE(phone, '') FROM user_profiles WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, userID).Scan(&candidate.UserID, &candidate.FullName, &candidate.Phone); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRecipientNotFound
		}
		log.Printf("[transfers] cashtag profile lookup failed: %v", err)
		return nil, cashtagLookupFailure(err)
	}

	return &WalletTransferResolveResponse{
		UserID:      candidate.UserID,
		FullName:    candidate.FullName,
		MaskedPhone: MaskPhone(candidate.Phone),
		Handle:      "@" + handle,
	}, nil
}
