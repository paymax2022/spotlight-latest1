package referrals

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// pgxQuerier is the subset of *pgxpool.Pool and pgx.Tx that tryConsumeCommissionSlot
// needs, so it can run either standalone or inside insertRewardAndResolveCap's
// transaction (see rewards_service.go for why that atomicity matters).
type pgxQuerier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// admin_default_and_cap.go implements the Refer & Earn modification (Module 8
// spec sign-off, 2026-09-18): every user has a referrer — the platform Admin by
// default — and a referral code's tiered-rate commission (unchanged; still
// ComputeReward(margin, currentRate) from rewards_service.go, per explicit
// product decision NOT to introduce a separate flat 20% rate) applies for a
// lifetime maximum of 100 commission-earning purchase events on that ONE code,
// counted across every user referred by it. On the 101st such event the code's
// tiered share stops going to the referrer and goes to Admin instead,
// permanently, for that code. See ADR-PR185 (docs/adr) for the full design
// rationale — including why the rate stays tiered rather than a flat 20%.

// ErrAdminUserNotConfigured is returned when the platform's Admin/"spotlight
// owner" user id cannot be resolved. Fails closed rather than guessing: crediting
// the wrong account with real money is worse than refusing the write.
var ErrAdminUserNotConfigured = errors.New("referrals: SUPER_ADMIN_USER_ID is not configured")

// EnvSuperAdminUserID is the same env var the existing referral/house package
// resolves the platform owner from (§7A) — reused here rather than inventing a
// second "who is Admin" mechanism.
const EnvSuperAdminUserID = "SUPER_ADMIN_USER_ID"

// resolveAdminUserID returns the platform Admin's user id. Fails closed if unset.
func resolveAdminUserID() (string, error) {
	id := strings.TrimSpace(os.Getenv(EnvSuperAdminUserID))
	if id == "" {
		return "", ErrAdminUserNotConfigured
	}
	return id, nil
}

// AttributeOrDefault applies a referral code at signup, exactly like Attribute,
// EXCEPT it never leaves a signup unattributed: an empty code, an unknown code,
// or a self-referral attempt all fall back to the Admin user as referrer rather
// than failing the request. Returns the resolved referrer id and whether the
// Admin default was used (so the caller can decide whether to show the user an
// "invalid code" notice even though signup succeeded — spec A3).
//
// Idempotent per user (referred_user_id UNIQUE), same as Attribute.
func (s *RewardService) AttributeOrDefault(ctx context.Context, referredUserID, code string) (referrerID string, usedAdminDefault bool, invalidCode bool, err error) {
	code = strings.TrimSpace(code)

	// Already attributed? Idempotent — the relationship is locked in permanently
	// at signup (spec: never changes later even if a code is entered post-signup).
	if existing, err := s.attributedReferrer(ctx, referredUserID); err != nil {
		return "", false, false, err
	} else if existing != "" {
		return existing, false, false, nil
	}

	if code != "" {
		referrerID, attrErr := s.Attribute(ctx, referredUserID, code)
		switch {
		case attrErr == nil:
			return referrerID, false, false, nil
		case strings.Contains(attrErr.Error(), "unknown referral code"):
			invalidCode = true // fall through to Admin default, but tell the caller
		case strings.Contains(attrErr.Error(), "self-referral"):
			// fall through to Admin default; not flagged as "invalid" to the user —
			// this is a policy rejection, not a typo.
		default:
			return "", false, false, attrErr
		}
	}

	adminID, err := resolveAdminUserID()
	if err != nil {
		return "", false, false, err
	}
	if adminID == referredUserID {
		// The Admin account itself never needs (or gets) a default attribution.
		return "", false, invalidCode, fmt.Errorf("referrals: admin account cannot be attributed to itself")
	}

	// claimOrRespectAttribution (not a plain INSERT ... DO NOTHING): the §7A
	// attribution engine (referral/attribution, wired into every signup ahead of
	// this one via NewSignupAttributor) already writes a placeholder row with
	// referrer_id NULL for exactly this case — no code / an unresolvable code —
	// its own house/global fallback. A DO-NOTHING insert would silently no-op
	// against that placeholder forever, so "Admin as default referrer" would
	// never actually take effect for any real signup. This claims that
	// placeholder instead, without ever overwriting an already-real referrer_id.
	if err := s.claimOrRespectAttribution(ctx, referredUserID, adminID, "admin_default", code); err != nil {
		return "", false, false, fmt.Errorf("referrals: insert admin-default attribution: %w", err)
	}
	final, err := s.attributedReferrer(ctx, referredUserID)
	if err != nil {
		return "", false, false, err
	}
	s.emit(ctx, "referral.attributed.admin_default", map[string]any{
		"referred_user_id": referredUserID, "referrer_id": final, "code_attempted": code,
		"invalid_code": invalidCode,
	})
	return final, true, invalidCode, nil
}

// ============================================================================
// Signup / KYC points (non-cash — separate from the reward-kobo money path).
// ============================================================================

const (
	SignupPoints    = 1
	KYCUpdatePoints = 5
)

// AwardSignupPoints credits the referral-program signup point exactly once per
// user (idempotency_key UNIQUE). No money moves — this is attribution-time
// gamification only (spec: "no money changes hands at signup").
func (s *RewardService) AwardSignupPoints(ctx context.Context, userID string) error {
	return s.awardPoints(ctx, userID, "signup", SignupPoints, "referral:points:signup:"+userID)
}

// AwardKYCPoints credits the KYC-update point exactly once per user.
func (s *RewardService) AwardKYCPoints(ctx context.Context, userID string) error {
	return s.awardPoints(ctx, userID, "kyc_update", KYCUpdatePoints, "referral:points:kyc:"+userID)
}

func (s *RewardService) awardPoints(ctx context.Context, userID, event string, points int, idemKey string) error {
	const ins = `
		INSERT INTO referral_signup_points (user_id, event, points, idempotency_key)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, userID, event, points, idemKey); err != nil {
		return fmt.Errorf("referrals: award %s points: %w", event, err)
	}
	s.emit(ctx, "referral.points.awarded", map[string]any{
		"user_id": userID, "event": event, "points": points,
	})
	return nil
}

// TotalPoints returns a user's lifetime referral-program points.
func (s *RewardService) TotalPoints(ctx context.Context, userID string) (int, error) {
	const q = `SELECT COALESCE(SUM(points),0) FROM referral_signup_points WHERE user_id=$1`
	var total int
	if err := s.db.QueryRow(ctx, q, userID).Scan(&total); err != nil {
		return 0, fmt.Errorf("referrals: total points: %w", err)
	}
	return total, nil
}

// ============================================================================
// 100-commission-event cap per code, with atomic Admin handoff.
// ============================================================================

// tryConsumeCommissionSlot atomically claims the referrer's next commission
// slot if their code has not yet reached the 100-event lifetime cap, and
// reports whether the code just became capped as a RESULT of this claim (i.e.
// this was event #100 exactly) so the caller can log the transition once.
//
// This is the race-condition-safe primitive the spec's cap boundary requires
// (two concurrent purchases from different referred users under the same code,
// both near count 99-100, must never both be treated as "under 100"): the
// INSERT...ON CONFLICT DO UPDATE...WHERE guard is a single atomic statement —
// Postgres row-locks the conflicting row for the duration, so a concurrent
// second caller sees the FIRST caller's committed count, never a stale read.
//
// Returns (allowed=true, justCapped) when this event counts toward the
// referrer (slots 1-100); (allowed=false, false) when the code was already
// capped before this call — the caller must route the commission to Admin
// instead of the referrer, WITHOUT calling this function again for that event
// (a refused claim does not consume anything).
func tryConsumeCommissionSlot(ctx context.Context, q pgxQuerier, referrerID string) (allowed bool, justCapped bool, err error) {
	const query = `
		INSERT INTO referral_commission_caps (referrer_id, commission_events_used)
		VALUES ($1, 1)
		ON CONFLICT (referrer_id) DO UPDATE
		  SET commission_events_used = referral_commission_caps.commission_events_used + 1,
		      updated_at = now()
		  WHERE referral_commission_caps.commission_events_used < 100
		RETURNING commission_events_used`
	var count int
	err = q.QueryRow(ctx, query, referrerID).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil // already at the cap — no slot claimed
	}
	if err != nil {
		return false, false, fmt.Errorf("referrals: consume commission slot: %w", err)
	}
	if count >= 100 {
		// This claim was exactly the 100th — stamp capped_at now, in a separate
		// statement guarded so only the caller who actually reached 100 sets it
		// (a later 100-vs-100 race is impossible: the row is now at 100 and every
		// subsequent caller fails the WHERE < 100 guard above and never reaches here).
		const capUpd = `UPDATE referral_commission_caps SET capped_at = now()
		                WHERE referrer_id=$1 AND capped_at IS NULL`
		if _, cerr := q.Exec(ctx, capUpd, referrerID); cerr != nil {
			return true, false, fmt.Errorf("referrals: stamp capped_at: %w", cerr)
		}
		return true, true, nil
	}
	return true, false, nil
}

// insertRewardAndResolveCap inserts the reward row and resolves/consumes the
// commission-cap slot as ONE atomic transaction. See the caller in
// rewards_service.go's OnPurchaseSettled for why splitting these two steps is
// unsafe under replay (a crash between them could burn a cap slot without ever
// crediting anyone, or leave a reward row permanently stuck on a placeholder
// payee). Returns wasNew as part of `status` semantics: on conflict the
// EXISTING row's already-resolved payee_id/capped are returned unchanged; on a
// fresh insert, the cap is consumed and recorded in the same statement batch
// before commit.
func (s *RewardService) insertRewardAndResolveCap(ctx context.Context, referrerID string, in PurchaseSettled, rate float64, rewardKobo int64, cfgVersion int) (rewardID, status, payeeID string, capped bool, err error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", "", "", false, fmt.Errorf("referrals: begin reward tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	const ins = `
		INSERT INTO referral_rewards
		  (referrer_id, referred_user_id, source_transaction_id, module,
		   margin_kobo, applied_rate, reward_kobo, status, config_version, payee_id, capped)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$1,false)
		ON CONFLICT (source_transaction_id) DO NOTHING
		RETURNING id, status`
	err = tx.QueryRow(ctx, ins,
		referrerID, in.PayerUserID, in.TransactionID, in.Module,
		in.MarginKobo, rate, rewardKobo, cfgVersion).Scan(&rewardID, &status)

	switch {
	case err == nil:
		// Won the insert race for this transaction id — and ONLY this call may
		// ever decide the cap outcome for it.
		payeeID = referrerID
		capped = false
		if adminID, aerr := resolveAdminUserID(); aerr == nil && referrerID != adminID {
			allowed, _, cerr := tryConsumeCommissionSlot(ctx, tx, referrerID)
			if cerr != nil {
				return "", "", "", false, cerr
			}
			if !allowed {
				payeeID = adminID
				capped = true
			}
		} else if aerr != nil && !errors.Is(aerr, ErrAdminUserNotConfigured) {
			return "", "", "", false, aerr
		}
		// (ErrAdminUserNotConfigured: no admin handoff possible — the referrer
		// keeps earning uncapped rather than the purchase silently crediting no
		// one. A deploy-time misconfiguration, not a reason to fail a live
		// customer purchase.)
		const updPayee = `UPDATE referral_rewards SET payee_id=$2, capped=$3 WHERE id=$1`
		if _, uerr := tx.Exec(ctx, updPayee, rewardID, payeeID, capped); uerr != nil {
			return "", "", "", false, fmt.Errorf("referrals: record cap outcome: %w", uerr)
		}

	case errors.Is(err, pgx.ErrNoRows):
		// Lost the race — a prior (possibly still-in-flight-until-just-now)
		// caller already inserted this transaction's row. Read its FINISHED,
		// already-resolved outcome rather than deciding anything ourselves.
		// Postgres's upsert conflict resolution only reaches us after the
		// conflicting transaction has committed or rolled back, so this SELECT
		// is guaranteed to see a fully-resolved row, never a half-written one.
		const sel = `SELECT id, status, COALESCE(payee_id, referrer_id), capped
		             FROM referral_rewards WHERE source_transaction_id=$1`
		if serr := tx.QueryRow(ctx, sel, in.TransactionID).Scan(&rewardID, &status, &payeeID, &capped); serr != nil {
			return "", "", "", false, fmt.Errorf("referrals: fetch existing reward: %w", serr)
		}

	default:
		return "", "", "", false, fmt.Errorf("referrals: insert reward: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", "", "", false, fmt.Errorf("referrals: commit reward tx: %w", err)
	}
	return rewardID, status, payeeID, capped, nil
}

// CommissionCapStatus is the admin/reporting view of one code's cap progress.
type CommissionCapStatus struct {
	ReferrerID           string     `json:"referrer_id"`
	CommissionEventsUsed int        `json:"commission_events_used"`
	Capped               bool       `json:"capped"`
	CappedAt             *time.Time `json:"capped_at,omitempty"`
}

// GetCommissionCapStatus returns a referrer's cap progress (0 used, not capped,
// if they have never yet had a commission-eligible purchase under their code).
func (s *RewardService) GetCommissionCapStatus(ctx context.Context, referrerID string) (*CommissionCapStatus, error) {
	const q = `SELECT commission_events_used, capped_at FROM referral_commission_caps WHERE referrer_id=$1`
	st := &CommissionCapStatus{ReferrerID: referrerID}
	var eventsUsed int
	var cappedAt *time.Time
	err := s.db.QueryRow(ctx, q, referrerID).Scan(&eventsUsed, &cappedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return nil, fmt.Errorf("referrals: cap status: %w", err)
	}
	st.CommissionEventsUsed = eventsUsed
	if cappedAt != nil {
		st.Capped = true
		st.CappedAt = cappedAt
	}
	return st, nil
}
