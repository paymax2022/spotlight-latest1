package maplerad

import "spotlight/backend/internal/finance/ledger"

// LegKind tags how a planned leg is posted to the ledger so the service can
// dispatch to the right ledger primitive (balanced journal vs reversal pair).
type LegKind string

const (
	// LegJournal — a balanced DR/CR posted via ledger.PostJournal.
	LegJournal LegKind = "journal"
	// LegReversalPair — a REVERSAL_DEBIT/REVERSAL_CREDIT posted via ledger.PostReversal.
	// RestoreAccount is credited back (+balance); ReleaseAccount has its hold drained.
	LegReversalPair LegKind = "reversal"
)

// PlannedLeg is one ledger posting the money path must apply for a transition.
// It is a pure description — no DB. The service resolves the named standing/
// user accounts to IDs and calls the matching ledger primitive.
type PlannedLeg struct {
	Kind           LegKind
	AmountKobo     int64
	IdempotencyKey string
	// For LegJournal: debit + credit account types.
	DebitAccount  ledger.AccountType
	CreditAccount ledger.AccountType
	// For LegReversalPair: which account is restored vs drained.
	RestoreAccount ledger.AccountType
	ReleaseAccount ledger.AccountType
	// IsUserWallet flags that DebitAccount / RestoreAccount refers to the user's
	// wallet (resolved per-user) rather than a standing account.
	DebitIsUserWallet   bool
	RestoreIsUserWallet bool
}

// PlanHold returns the single leg for INITIATED→PENDING:
//
//	DR user_wallet (amount+fee) → CR failed_transfer_suspense
//
// This reserves the funds (the suspense hold). amountKobo MUST already include
// the fee — the caller computes total = amount + fee.
func PlanHold(ref string, totalKobo int64) []PlannedLeg {
	return []PlannedLeg{{
		Kind:              LegJournal,
		AmountKobo:        totalKobo,
		IdempotencyKey:    LegKey(ref, LegHold),
		DebitAccount:      ledger.AccountUserWallet,
		DebitIsUserWallet: true,
		CreditAccount:     ledger.AccountFailedTransferSusp,
	}}
}

// PlanFinalize returns the legs for PENDING→SUCCESS:
//
//	DR suspense(amount) → CR settlement                 (money has left the building)
//	DR suspense(fee)    → CR paymax_revenue   (fee recognition, only when fee > 0)
//
// The held total (amount+fee) is swept out of suspense exactly once, split
// between settlement and revenue. Each leg has a distinct idempotency key.
func PlanFinalize(ref string, amountKobo, feeKobo int64) []PlannedLeg {
	legs := []PlannedLeg{{
		Kind:           LegJournal,
		AmountKobo:     amountKobo,
		IdempotencyKey: LegKey(ref, LegSettle),
		DebitAccount:   ledger.AccountFailedTransferSusp,
		CreditAccount:  ledger.AccountSettlement,
	}}
	if feeKobo > 0 {
		legs = append(legs, PlannedLeg{
			Kind:           LegJournal,
			AmountKobo:     feeKobo,
			IdempotencyKey: LegKey(ref, LegFee),
			DebitAccount:   ledger.AccountFailedTransferSusp,
			CreditAccount:  ledger.AccountPaymaxRevenue,
		})
	}
	return legs
}

// PlanReverseHold returns the leg for PENDING→FAILED:
//
//	REVERSAL: restore user_wallet (+amount+fee), drain failed_transfer_suspense
//
// The full held total returns to the user. This is the exact inverse of PlanHold.
func PlanReverseHold(ref string, totalKobo int64) []PlannedLeg {
	return []PlannedLeg{{
		Kind:                LegReversalPair,
		AmountKobo:          totalKobo,
		IdempotencyKey:      LegKey(ref, LegReversal),
		RestoreAccount:      ledger.AccountUserWallet,
		RestoreIsUserWallet: true,
		ReleaseAccount:      ledger.AccountFailedTransferSusp,
	}}
}

// PlanCompensate returns the leg for PENDING→REVERSED (a debit that had already
// settled out is compensated): restore the user_wallet (+amount+fee) and drain
// the settlement account. Compensating entry, append-only — never a balance edit.
func PlanCompensate(ref string, totalKobo int64) []PlannedLeg {
	return []PlannedLeg{{
		Kind:                LegReversalPair,
		AmountKobo:          totalKobo,
		IdempotencyKey:      LegKey(ref, LegCompensate),
		RestoreAccount:      ledger.AccountUserWallet,
		RestoreIsUserWallet: true,
		ReleaseAccount:      ledger.AccountSettlement,
	}}
}

// NetEffectKobo computes the net change to a user's available wallet balance
// implied by a sequence of planned legs, for invariant testing. A hold debits
// the wallet (-total); a reverse-hold / compensate restores it (+total);
// finalize touches only standing accounts (0 wallet effect). Pure.
func NetEffectKobo(legs []PlannedLeg) int64 {
	var net int64
	for _, l := range legs {
		switch l.Kind {
		case LegJournal:
			if l.DebitIsUserWallet {
				net -= l.AmountKobo
			}
		case LegReversalPair:
			if l.RestoreIsUserWallet {
				net += l.AmountKobo
			}
		}
	}
	return net
}
