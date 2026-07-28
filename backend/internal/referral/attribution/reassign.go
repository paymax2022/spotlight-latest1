package attribution

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/referral/events"
	rewardledger "spotlight/backend/internal/referral/ledger"
)

// Errors returned by the claim / reassignment flows.
var (
	ErrWindowClosed   = fmt.Errorf("referral/attribution: grace window closed (locked)")
	ErrSelfClaim      = fmt.Errorf("referral/attribution: self-referral cannot be claimed")
	ErrInvalidCode    = fmt.Errorf("referral/attribution: invalid or unknown code")
	ErrNotHouse       = fmt.Errorf("referral/attribution: late-claim only reassigns house attributions")
	ErrCosignRequired = fmt.Errorf("referral/attribution: house-benefiting reassignment requires a distinct co-signer")
	ErrNoAttribution  = fmt.Errorf("referral/attribution: attribution not found")
)

// ClaimCode is the §7A.3 late code-claim. Within the grace window, a user who
// forgot to enter a code can claim a valid referrer: the house accrual is
// reversed, re-accrued to the real referrer, the attribution is reassigned and
// then LOCKED. After the window (status='locked' or grace_expires_at passed) the
// claim is rejected.
func (s *Service) ClaimCode(ctx context.Context, referredUserID, code string) (*Attribution, error) {
	att, err := s.getByReferred(ctx, referredUserID)
	if err == pgx.ErrNoRows {
		return nil, ErrNoAttribution
	}
	if err != nil {
		return nil, err
	}

	// Window must still be open.
	if att.Status == StatusLocked {
		return nil, ErrWindowClosed
	}
	if att.GraceExpiresAt != nil && time.Now().After(*att.GraceExpiresAt) {
		// Best-effort lock so future calls are cheap.
		_ = s.lock(ctx, att.ID)
		return nil, ErrWindowClosed
	}
	// Only house-captured attributions are claimable (a real code already won).
	if !att.IsHouse {
		return nil, ErrNotHouse
	}

	norm := normalizeCode(code)
	referrerID, rerr := s.codes.ResolveCodeToReferrer(ctx, norm)
	if rerr != nil || referrerID == "" {
		return nil, ErrInvalidCode
	}
	if referrerID == referredUserID {
		return nil, ErrSelfClaim
	}

	// Reverse the house accrual and re-accrue to the real referrer.
	if err := s.reverseAndReaccrue(ctx, referredUserID, referrerID); err != nil {
		return nil, err
	}

	// Reassign attribution → referrer, then LOCK.
	const upd = `
		UPDATE referral_attributions
		SET referrer_id = $2, house_account_id = NULL, attribution_type = 'code',
		    code_used = $3, is_house = false, risk_flag = NULL,
		    status = 'locked', reassigned_from = 'house', reassigned_at = now(),
		    updated_at = now()
		WHERE id = $1`
	if _, err := s.db.Exec(ctx, upd, att.ID, referrerID, norm); err != nil {
		return nil, fmt.Errorf("referral/attribution: claim update: %w", err)
	}

	// Auto-approved reassignment record (benefits_house=false: house gives up).
	const ins = `
		INSERT INTO referral_reassignments
			(attribution_id, from_party, to_party, reason, requested_by, benefits_house,
			 status, decided_at)
		VALUES ($1, 'house', $2, 'late_code_claim', $3, false, 'approved', now())`
	if _, err := s.db.Exec(ctx, ins, att.ID, referrerID, referredUserID); err != nil {
		return nil, fmt.Errorf("referral/attribution: claim record: %w", err)
	}

	_ = s.events.Record(ctx, events.Input{
		EventType:      events.TypeLateClaimed,
		UserID:         referredUserID,
		ReferrerID:     referrerID,
		Payload:        map[string]any{"code": norm},
		IdempotencyKey: "ref:late_claim:" + referredUserID,
	})

	return s.getByReferred(ctx, referredUserID)
}

// ReassignInput drives a manual reassignment (A-USR-06).
type ReassignInput struct {
	AttributionID string
	ToParty       string // a user id, or "house"
	Reason        string
	RequestedBy   string
	CosignedBy    string // required (and must differ from RequestedBy) when benefits_house
}

// Reassign is the manual reassignment/dispute tool (§7A.5). It reverses the prior
// reward accrual and re-accrues to the corrected party, with a full audit trail.
// Separation of duties: a change that BENEFITS THE HOUSE requires a distinct
// co-signer (cosignedBy != requestedBy) before it is applied.
func (s *Service) Reassign(ctx context.Context, in ReassignInput) (*Attribution, error) {
	att, err := s.GetByID(ctx, in.AttributionID)
	if err == pgx.ErrNoRows {
		return nil, ErrNoAttribution
	}
	if err != nil {
		return nil, err
	}

	toHouse := in.ToParty == "" || in.ToParty == "house"
	benefitsHouse := toHouse

	if benefitsHouse {
		if in.CosignedBy == "" || in.CosignedBy == in.RequestedBy {
			return nil, ErrCosignRequired
		}
	}

	fromParty := "house"
	if !att.IsHouse && att.ReferrerID != "" {
		fromParty = att.ReferrerID
	}

	// Reverse the prior accrual; re-accrue to the corrected party.
	if err := s.reverseAccrual(ctx, att.ReferredUserID); err != nil {
		return nil, err
	}
	if toHouse {
		acc, herr := s.house.GetOrCreateGlobalHouse(ctx)
		if herr != nil {
			return nil, herr
		}
		if _, aerr := s.reward.Accrue(ctx, rewardledger.AccrueInput{
			HouseAccountID: acc.ID,
			ReferredUserID: att.ReferredUserID,
			Kind:           rewardledger.KindReferrer,
			AmountKobo:     HouseReferrerRewardKobo,
			IsHouse:        true,
			IdempotencyKey: "ref:reaccrue:" + att.ReferredUserID + ":" + in.AttributionID,
		}); aerr != nil {
			return nil, aerr
		}
		const upd = `
			UPDATE referral_attributions
			SET referrer_id = NULL, house_account_id = $2, attribution_type = 'global_house',
			    is_house = true, status = 'locked', reassigned_from = $3, reassigned_at = now(),
			    updated_at = now()
			WHERE id = $1`
		if _, err := s.db.Exec(ctx, upd, in.AttributionID, acc.ID, fromParty); err != nil {
			return nil, fmt.Errorf("referral/attribution: reassign to house: %w", err)
		}
	} else {
		if _, aerr := s.reward.Accrue(ctx, rewardledger.AccrueInput{
			BeneficiaryID:  in.ToParty,
			ReferredUserID: att.ReferredUserID,
			Kind:           rewardledger.KindReferrer,
			AmountKobo:     HouseReferrerRewardKobo,
			IsHouse:        false,
			IdempotencyKey: "ref:reaccrue:" + att.ReferredUserID + ":" + in.AttributionID,
		}); aerr != nil {
			return nil, aerr
		}
		const upd = `
			UPDATE referral_attributions
			SET referrer_id = $2, house_account_id = NULL, attribution_type = 'code',
			    is_house = false, risk_flag = NULL, status = 'locked',
			    reassigned_from = $3, reassigned_at = now(), updated_at = now()
			WHERE id = $1`
		if _, err := s.db.Exec(ctx, upd, in.AttributionID, in.ToParty, fromParty); err != nil {
			return nil, fmt.Errorf("referral/attribution: reassign to referrer: %w", err)
		}
	}

	// Audit record (always; approved on apply).
	var cosign any
	if in.CosignedBy != "" {
		cosign = in.CosignedBy
	}
	const ins = `
		INSERT INTO referral_reassignments
			(attribution_id, from_party, to_party, reason, requested_by, cosigned_by,
			 benefits_house, status, decided_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', now())`
	if _, err := s.db.Exec(ctx, ins,
		in.AttributionID, fromParty, in.ToParty, in.Reason,
		nullable(in.RequestedBy), cosign, benefitsHouse); err != nil {
		return nil, fmt.Errorf("referral/attribution: reassign record: %w", err)
	}

	_ = s.events.Record(ctx, events.Input{
		EventType:      events.TypeReassigned,
		UserID:         att.ReferredUserID,
		Payload:        map[string]any{"to": in.ToParty, "benefits_house": benefitsHouse, "reason": in.Reason},
		IdempotencyKey: "ref:reassigned:" + in.AttributionID + ":" + time.Now().Format(time.RFC3339Nano),
	})

	return s.GetByID(ctx, in.AttributionID)
}

// reverseAndReaccrue claws back the house accrual and credits the real referrer.
func (s *Service) reverseAndReaccrue(ctx context.Context, referredUserID, referrerID string) error {
	if err := s.reverseAccrual(ctx, referredUserID); err != nil {
		return err
	}
	_, err := s.reward.Accrue(ctx, rewardledger.AccrueInput{
		BeneficiaryID:  referrerID,
		ReferredUserID: referredUserID,
		Kind:           rewardledger.KindReferrer,
		AmountKobo:     HouseReferrerRewardKobo,
		IsHouse:        false,
		IdempotencyKey: "ref:reaccrue:" + referredUserID + ":claim",
	})
	return err
}

// reverseAccrual claws back the original referrer-side accrual for a referred
// user (matched by the resolver's stable idempotency key).
func (s *Service) reverseAccrual(ctx context.Context, referredUserID string) error {
	const q = `SELECT id FROM referral_reward_ledger WHERE idempotency_key = $1`
	var rewardID string
	err := s.db.QueryRow(ctx, q, "ref:accrue:"+referredUserID).Scan(&rewardID)
	if err == pgx.ErrNoRows {
		return nil // nothing to reverse
	}
	if err != nil {
		return fmt.Errorf("referral/attribution: find accrual: %w", err)
	}
	if cberr := s.reward.ClawBack(ctx, rewardID, "ref:clawback:"+referredUserID); cberr != nil {
		if cberr == rewardledger.ErrIllegalTransition {
			return nil // already terminal — safe
		}
		return cberr
	}
	return nil
}

func (s *Service) lock(ctx context.Context, attributionID string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE referral_attributions SET status='locked', updated_at=now() WHERE id=$1`,
		attributionID)
	return err
}
