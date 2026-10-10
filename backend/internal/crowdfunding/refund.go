package crowdfunding

// The crowdfunding per-contribution refund money path — the single executor
// shared by Service.RefundAll and adminext.Service.DecideRefund.
//
// Contributions instant-settle 90/10, so almost every real contribution sits
// 'released' with a 'settled' settlement. The refund mechanism follows the
// settlement's state:
//   - 'escrowed'/'disputed' → settlement.Refund / RefundExternal (money never
//     left the escrow pool).
//   - 'settled' → a balanced clawback reversing the settle legs at gross:
//     DR creator wallet provider_kobo + DR paymax_revenue fee_kobo → CR backer.
//     Amounts come from the settlement row (what actually moved), and the
//     creator leg is balance-checked — a creator who already withdrew fails
//     closed rather than overdrawing.
// Leg keys derive from the contribution id so replays converge: a crash
// mid-sequence leaves rows un-flipped and the retry no-ops posted legs.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// ErrRefundDepsMissing fails the refund path closed when the service lacks
// money-path dependencies (nil ledger or settlement).
var ErrRefundDepsMissing = errors.New("crowdfunding: refund path requires a wired ledger and settlement service")

// ErrContributionNotFound is returned when the contribution id resolves to no row.
var ErrContributionNotFound = errors.New("crowdfunding: contribution not found")

// ErrNoSettlement is returned when a refundable contribution has no settlement
// row — no recorded money movement exists to reverse.
var ErrNoSettlement = errors.New("crowdfunding: contribution has no settlement to refund")

// ErrCreatorInsufficient is returned when the clawback cannot pull the provider
// share back out of the creator's wallet (already withdrawn/spent).
var ErrCreatorInsufficient = errors.New("crowdfunding: creator wallet cannot cover the refund clawback")

// statusRefunded is the shared contribution/settlement terminal value — the
// row-pair converge check reads both columns against it.
const statusRefunded = "refunded"

// ContributionRefund reports what a single-contribution refund did.
type ContributionRefund struct {
	ContributionID string `json:"contributionId"`
	// RefundedKobo is the gross credited back to the backer.
	RefundedKobo int64 `json:"refundedKobo"`
	// Via is the money mechanism: "escrow" or "clawback".
	Via string `json:"via,omitempty"`
	// AlreadyRefunded reports an idempotent replay — no legs posted.
	AlreadyRefunded bool `json:"alreadyRefunded,omitempty"`
}

// RefundContribution executes the money-side refund for one contribution,
// choosing the mechanism from the settlement's state (the money truth), not
// the contribution's. Idempotent: already-refunded input is a no-op.
func RefundContribution(ctx context.Context, db *pgxpool.Pool, led *ledger.Service, sett *settlement.Service, contributionID, reason string) (*ContributionRefund, error) {
	if db == nil || led == nil || sett == nil {
		return nil, ErrRefundDepsMissing
	}
	if contributionID == "" {
		return nil, ErrContributionNotFound
	}

	var (
		contribStatus, contributorID, creatorID string
		settlementID                            *string
		settStatus, fundingSource               *string
		totalKobo, providerKobo, feeKobo        int64
	)
	const sel = `
		SELECT co.status, co.contributor_id::text, c.creator_id::text,
		       co.settlement_id,
		       st.status, st.funding_source,
		       COALESCE(st.provider_kobo,0), COALESCE(st.fee_kobo,0), COALESCE(st.total_kobo,0)
		  FROM contributions co
		  JOIN campaigns c ON c.id = co.campaign_id
		  LEFT JOIN settlements st ON st.id = co.settlement_id
		 WHERE co.id = $1`
	err := db.QueryRow(ctx, sel, contributionID).Scan(
		&contribStatus, &contributorID, &creatorID,
		&settlementID, &settStatus, &fundingSource,
		&providerKobo, &feeKobo, &totalKobo,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrContributionNotFound
		}
		return nil, fmt.Errorf("crowdfunding: load contribution for refund: %w", err)
	}

	out := &ContributionRefund{ContributionID: contributionID}

	// Idempotent no-op: already refunded on an earlier attempt — converge the
	// contribution row if a partial attempt left the pair inconsistent.
	if contribStatus == statusRefunded || (settStatus != nil && *settStatus == statusRefunded) {
		if contribStatus != statusRefunded {
			if _, err := db.Exec(ctx, `UPDATE contributions SET status='refunded' WHERE id=$1`, contributionID); err != nil {
				return nil, fmt.Errorf("crowdfunding: mark contribution refunded: %w", err)
			}
		}
		out.AlreadyRefunded = true
		return out, nil
	}

	if settlementID == nil || settStatus == nil {
		return nil, ErrNoSettlement
	}

	switch *settStatus {
	case string(settlement.StatusEscrowed), string(settlement.StatusDisputed):
		// Money never left the escrow pool — refund through the settlement rail.
		var refundErr error
		if fundingSource != nil && *fundingSource == "external" {
			refundErr = sett.RefundExternal(ctx, *settlementID, reason)
		} else {
			refundErr = sett.Refund(ctx, *settlementID, reason)
		}
		if refundErr != nil {
			return nil, fmt.Errorf("crowdfunding: escrow refund contribution %s: %w", contributionID, refundErr)
		}
		out.Via = "escrow"
		out.RefundedKobo = totalKobo

	case string(settlement.StatusSettled):
		// Claw the 90/10 settle legs back so the backer is made whole at gross.
		refundedKobo, err := clawbackSettledLegs(ctx, db, led, contributionID, contributorID, creatorID, reason,
			providerKobo, feeKobo, *settlementID)
		if err != nil {
			return nil, err
		}
		out.Via = "clawback"
		out.RefundedKobo = refundedKobo

	default:
		return nil, fmt.Errorf("crowdfunding: cannot refund contribution %s in settlement state %q", contributionID, *settStatus)
	}

	if _, err := db.Exec(ctx, `UPDATE contributions SET status='refunded' WHERE id=$1`, contributionID); err != nil {
		return nil, fmt.Errorf("crowdfunding: mark contribution %s refunded: %w", contributionID, err)
	}
	return out, nil
}

// clawbackSettledLegs reverses a settled 90/10 contribution at gross: DR
// creator wallet providerKobo + DR paymax_revenue feeKobo → CR backer wallet.
// Returns the gross refunded. Leg keys derive from the contribution id, so a
// crash between legs converges on retry (posted legs no-op as ErrDuplicate);
// the settlement flip runs only after both legs are durable. The creator leg
// is balance-checked — an already-withdrawn creator fails closed rather than
// overdrawing the wallet.
func clawbackSettledLegs(ctx context.Context, db *pgxpool.Pool, led *ledger.Service, contributionID, contributorID, creatorID, reason string, providerKobo, feeKobo int64, settlementID string) (int64, error) {
	backerWallet, err := led.GetOrCreateUserWallet(ctx, contributorID)
	if err != nil {
		return 0, fmt.Errorf("crowdfunding: resolve backer wallet: %w", err)
	}
	ref := "cf:refund:" + contributionID
	// (1) DR creator wallet providerKobo / CR backer wallet — balance-checked.
	// Deliberately plain Debit (not DebitGated): a refund clawback is a
	// system-initiated correction, not a creator spend — the daily debit cap
	// must not trap a refund the platform owes the backer (mirrors the
	// restaurant tip clawback / savings penalty exceptions).
	if providerKobo > 0 {
		err := led.Debit(ctx, creatorID, ref, ref+":provider", backerWallet.ID, providerKobo)
		switch {
		case err == nil, errors.Is(err, ledger.ErrDuplicate):
		case errors.Is(err, ledger.ErrInsufficientFunds):
			return 0, fmt.Errorf("%w (contribution %s)", ErrCreatorInsufficient, contributionID)
		default:
			return 0, fmt.Errorf("crowdfunding: claw back provider leg %s: %w", contributionID, err)
		}
	}
	// (2) DR paymax_revenue feeKobo / CR backer wallet — the platform
	// disgorges its fee on a full refund.
	if feeKobo > 0 {
		revenueAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			return 0, fmt.Errorf("crowdfunding: resolve revenue account: %w", err)
		}
		err = led.PostJournal(ctx, ledger.JournalEntry{
			Reference:       ref + ":fee",
			IdempotencyKey:  ref + ":fee",
			AmountKobo:      feeKobo,
			DebitAccountID:  revenueAcc.ID,
			CreditAccountID: backerWallet.ID,
			Description:     "Crowdfunding refund — platform fee reversal: " + reason,
		})
		if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return 0, fmt.Errorf("crowdfunding: claw back fee leg %s: %w", contributionID, err)
		}
	}
	// Both legs durable; flip the tracking rows (retry-safe — posted legs
	// no-op as ErrDuplicate).
	if _, err := db.Exec(ctx, `UPDATE settlements SET status='refunded' WHERE id=$1`, settlementID); err != nil {
		return 0, fmt.Errorf("crowdfunding: mark settlement refunded: %w", err)
	}
	return providerKobo + feeKobo, nil
}
