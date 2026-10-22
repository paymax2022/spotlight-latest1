package restaurant

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/namematch"
)

// Payout-account name matching (FEATURE_BANK_ACCOUNT_NAME_MATCH).
//
// A successful bank name-enquiry only proves the account exists. With this on,
// a restaurant payout account is verified (withdrawals allowed) only when the
// holder name the bank returns matches the owner's KYC-verified legal name or
// the legal name on one of the owner's APPROVED KYB applications. Anything else
// is saved unverified and held for an admin to approve or reject. An owner with
// no verified identity cannot add a payout account at all.
//
// Automatic verification needs a STRONG identity (kycverify.VerifiedLegalName:
// anchored on a BVN/NIN/vNIN check, no conflicting check) and the KYC ownership
// gate on (autoVerify); otherwise every new account is held for review. Approved
// KYB legal names are owner-typed, so they never auto-verify an account — they
// are shown to the admin as context. With the flag on, an account verified
// before matching existed cannot be withdrawn to until it is re-added, which
// re-runs the check on the same row.

// Name-match states stored in restaurant_bank_accounts.name_match_status.
const (
	NameMatchMatched  = "matched"
	NameMatchReview   = "review"
	NameMatchApproved = "admin_approved"
	NameMatchRejected = "admin_rejected"
)

var (
	// ErrKYCNameRequired: the owner has no provider-verified legal name yet. HTTP 422.
	ErrKYCNameRequired = errors.New("restaurant: verify your identity (BVN or NIN) before adding a payout bank account")
	// ErrNameMatchUnavailable: matching is on but no identity reader is wired — fail closed. HTTP 503.
	ErrNameMatchUnavailable = errors.New("restaurant: payout account name check is unavailable")
	// ErrHeldBankAccountNotFound: no account awaiting a name-match decision with that id. HTTP 404.
	ErrHeldBankAccountNotFound = errors.New("restaurant: no bank account awaiting name review with that id")
	// ErrNameDecisionReason: an admin decision needs a reason. HTTP 400.
	ErrNameDecisionReason = errors.New("restaurant: a reason is required for a name-match decision")
	// ErrBankAccountNameUnchecked: the account was verified before name matching
	// existed. HTTP 400.
	ErrBankAccountNameUnchecked = errors.New("restaurant: this payout account's name has not been checked; add it again to confirm it before withdrawing")
	// errNameLookup wraps a database failure while reading names. HTTP 500.
	errNameLookup = errors.New("restaurant: could not read verified names")
)

// VerifiedNameReader returns a user's provider-verified legal name and whether
// it is strong enough to trust automatically
// (kycverify.Repository.VerifiedLegalName).
type VerifiedNameReader interface {
	VerifiedLegalName(ctx context.Context, userID string) (name string, strong bool, ok bool, err error)
}

// WithBankNameMatch turns payout-account name matching on, reading verified
// names from reader. autoVerify allows a matching account to be verified
// without review; wire it to the KYC ownership gate. On with a nil reader
// fails closed.
func (s *Service) WithBankNameMatch(enabled, autoVerify bool, reader VerifiedNameReader) *Service {
	s.nameMatchOn = enabled
	s.nameAutoVerify = autoVerify
	s.verifiedNames = reader
	return s
}

// payoutIdentity is what a payout account is checked against.
type payoutIdentity struct {
	KYCName  string
	Strong   bool
	KYBNames []string
}

// payoutIdentityFor reads the owner's verified identity and approved KYB legal
// names. It runs before anything is written.
func (s *Service) payoutIdentityFor(ctx context.Context, ownerID string) (payoutIdentity, error) {
	if s.verifiedNames == nil {
		return payoutIdentity{}, ErrNameMatchUnavailable
	}
	name, strong, ok, err := s.verifiedNames.VerifiedLegalName(ctx, ownerID)
	if err != nil {
		return payoutIdentity{}, fmt.Errorf("%w: %v", errNameLookup, err)
	}
	if !ok {
		return payoutIdentity{}, ErrKYCNameRequired
	}
	kyb, err := s.approvedKYBNames(ctx, ownerID)
	if err != nil {
		return payoutIdentity{}, err
	}
	return payoutIdentity{KYCName: name, Strong: strong, KYBNames: kyb}, nil
}

func (s *Service) approvedKYBNames(ctx context.Context, ownerID string) ([]string, error) {
	rows, err := s.db.Query(ctx, `
		SELECT k.legal_name FROM restaurant_kyb k
		JOIN restaurants r ON r.id = k.restaurant_id
		WHERE r.owner_id = $1 AND k.status = 'approved' AND COALESCE(k.legal_name, '') <> ''`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errNameLookup, err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var legal string
		if err := rows.Scan(&legal); err != nil {
			return nil, fmt.Errorf("%w: %v", errNameLookup, err)
		}
		out = append(out, legal)
	}
	return out, rows.Err()
}

// HeldBankAccount is one payout account awaiting a name-match decision.
type HeldBankAccount struct {
	ID                  string `json:"id"`
	OwnerID             string `json:"owner_id"`
	BankName            string `json:"bank_name"`
	AccountNumberMasked string `json:"account_number_masked"`
	AccountName         string `json:"account_name"` // holder name the bank returned
	NameMatchScore      *int   `json:"name_match_score,omitempty"`
	// What to compare it with: the owner's provider-verified name (and whether
	// that identity is strong) and their approved KYB legal names.
	VerifiedName       string    `json:"verified_name"`
	VerifiedNameStrong bool      `json:"verified_name_strong"`
	KYBLegalNames      []string  `json:"kyb_legal_names"`
	CreatedAt          time.Time `json:"created_at"`
}

// AdminListHeldBankAccounts lists accounts held for name review, oldest first.
func (s *Service) AdminListHeldBankAccounts(ctx context.Context) ([]HeldBankAccount, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, bank_name, account_number, account_name, name_match_score, created_at
		FROM restaurant_bank_accounts WHERE name_match_status = $1
		ORDER BY created_at LIMIT 200`, NameMatchReview)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HeldBankAccount{}
	for rows.Next() {
		var h HeldBankAccount
		var num string
		var score *int16
		if err := rows.Scan(&h.ID, &h.OwnerID, &h.BankName, &num, &h.AccountName, &score, &h.CreatedAt); err != nil {
			return nil, err
		}
		if score != nil {
			v := int(*score)
			h.NameMatchScore = &v
		}
		h.AccountNumberMasked = maskAccountNumber(num)
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for i := range out {
		if s.verifiedNames != nil {
			name, strong, _, err := s.verifiedNames.VerifiedLegalName(ctx, out[i].OwnerID)
			if err != nil {
				return nil, fmt.Errorf("%w: %v", errNameLookup, err)
			}
			out[i].VerifiedName, out[i].VerifiedNameStrong = name, strong
		}
		kyb, err := s.approvedKYBNames(ctx, out[i].OwnerID)
		if err != nil {
			return nil, err
		}
		out[i].KYBLegalNames = kyb
	}
	return out, nil
}

// AdminDecideBankAccountName approves (the account becomes verified) or
// rejects (it stays unverified) a held account. Only an account currently held
// for review can be decided, so a decision can never re-open a settled one.
func (s *Service) AdminDecideBankAccountName(ctx context.Context, adminID, accountID, decision, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ErrNameDecisionReason
	}
	var status string
	var verified bool
	switch decision {
	case "approve":
		status, verified = NameMatchApproved, true
	case "reject":
		status, verified = NameMatchRejected, false
	default:
		return errors.New("restaurant: decision must be approve or reject")
	}
	var ownerID string
	err := s.db.QueryRow(ctx, `
		UPDATE restaurant_bank_accounts
		SET is_verified = $2, name_match_status = $3, name_match_decided_by = $4,
		    name_match_decided_at = now(), name_match_reason = $5, updated_at = now()
		WHERE id = $1 AND name_match_status = $6
		RETURNING user_id`, accountID, verified, status, adminID, reason, NameMatchReview).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrHeldBankAccountNotFound
	}
	if err != nil {
		return err
	}
	if s.audit != nil {
		s.audit.LogAction(adminID, ownerID, "restaurant.bank_account.name_match_"+decision, "restaurant", "restaurant_bank_account", accountID,
			map[string]any{"name_match_status": NameMatchReview},
			map[string]any{"name_match_status": status, "is_verified": verified, "reason": reason},
			"", "", "warning")
	}
	body := "Your payout bank account was approved and can now receive withdrawals."
	if !verified {
		body = "Your payout bank account was not approved: the account name does not match your verified identity or business. Add an account in your own or your business's name."
	}
	s.notify(ctx, Notification{
		UserID: ownerID, Event: EventBankAccountAdded, Title: "Payout bank account review",
		Body: body, Data: map[string]any{"bank_account_id": accountID, "decision": decision},
	})
	return nil
}

// nameMatchVerdict decides a resolved holder name. Only the owner's own strong
// verified name can verify an account automatically, and only when autoVerify
// is on; the score is the best against every name, for the reviewer.
func nameMatchVerdict(holder string, id payoutIdentity, autoVerify bool) (verified bool, status string, score int) {
	own := namematch.Match(holder, id.KYCName)
	best := namematch.Match(holder, append([]string{id.KYCName}, id.KYBNames...)...)
	if autoVerify && id.Strong && own.Outcome == namematch.Matched {
		return true, NameMatchMatched, own.Score
	}
	return false, NameMatchReview, best.Score
}
