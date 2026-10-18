package transport

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Hand-off PINs (ride start, parcel pickup/drop-off, business-delivery
// drop-off, towing) are 4 digits. Unlimited guesses let the party being
// verified — the courier or driver — brute-force the PIN the OTHER party holds
// and complete the hand-off (and the escrow settlement) on their own. checkPin
// counts failures per (entity, purpose) in transport_pin_attempts:
//   - every pinCooldownEvery failures: a pinCooldown during which even the
//     correct PIN is refused (10,000 guesses go from seconds to weeks);
//   - pinHardLockAt failures in total: locked until support clears the row;
//   - a correct PIN resets the count.
const (
	pinCooldownEvery = 5
	pinCooldown      = 15 * time.Minute
	pinHardLockAt    = 15

	CodePinLocked = "PIN_LOCKED"
)

// checkPin verifies given against expected for one hand-off. expected == ""
// means no PIN is on file, which never matches (callers that treat a missing
// PIN as "not required" skip the call). actorUserID is the caller (audit).
//
// Each check runs in its own transaction holding an advisory lock on the
// (entity, purpose): concurrent guesses queue behind each other, so a parallel
// burst cannot slip past the cooldown — the 6th guess always sees the lock the
// 5th set. Every write is inside that transaction and fails closed.
func (s *Service) checkPin(ctx context.Context, entityType, entityID, purpose, expected, given, actorUserID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`,
		"transport_pin:"+entityType+":"+entityID+":"+purpose); err != nil {
		return err
	}

	var failed int
	var lockedUntil *time.Time
	var hard bool
	err = tx.QueryRow(ctx, `
		SELECT failed_count, locked_until, hard_locked FROM public.transport_pin_attempts
		WHERE entity_type=$1 AND entity_id=$2 AND purpose=$3`, entityType, entityID, purpose).
		Scan(&failed, &lockedUntil, &hard)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err // fail closed: no verification without the attempt record
	}
	if hard {
		return codedErr(http.StatusLocked, CodePinLocked, "too many wrong PINs; contact support to continue")
	}
	if lockedUntil != nil && time.Now().Before(*lockedUntil) {
		ce := codedErr(http.StatusTooManyRequests, CodePinLocked, "too many wrong PINs; try again later")
		ce.Details = map[string]any{"retry_after_s": int(time.Until(*lockedUntil).Seconds()) + 1}
		return ce
	}

	if expected != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(given)) == 1 {
		if failed > 0 {
			if _, err := tx.Exec(ctx, `DELETE FROM public.transport_pin_attempts
				WHERE entity_type=$1 AND entity_id=$2 AND purpose=$3`, entityType, entityID, purpose); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	}

	// Wrong PIN: count it, and lock if this one crossed a line — one statement,
	// committed before the next queued guess reads the row.
	failed++
	var lockFor *float64
	hardNow := failed >= pinHardLockAt
	if !hardNow && failed%pinCooldownEvery == 0 {
		secs := pinCooldown.Seconds()
		lockFor = &secs
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.transport_pin_attempts
			(entity_type, entity_id, purpose, failed_count, locked_until, hard_locked, last_actor_id, updated_at)
		VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6, NULLIF($7,'')::uuid, now())
		ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE
		  SET failed_count = EXCLUDED.failed_count, locked_until = EXCLUDED.locked_until,
		      hard_locked = EXCLUDED.hard_locked, last_actor_id = EXCLUDED.last_actor_id, updated_at = now()`,
		entityType, entityID, purpose, failed, lockFor, hardNow, actorUserID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	switch {
	case hardNow:
		log.Printf("[transport] SECURITY %s %s %s PIN hard-locked after %d wrong attempts (actor %s)", entityType, entityID, purpose, failed, actorUserID)
		s.recordModeEvent(ctx, actorUserID, "pin.hard_locked", entityType, entityID, "", "",
			map[string]any{"purpose": purpose, "failed_count": failed})
		return codedErr(http.StatusLocked, CodePinLocked, "too many wrong PINs; contact support to continue")
	case lockFor != nil:
		s.recordModeEvent(ctx, actorUserID, "pin.cooldown", entityType, entityID, "", "",
			map[string]any{"purpose": purpose, "failed_count": failed})
		ce := codedErr(http.StatusTooManyRequests, CodePinLocked, "too many wrong PINs; try again later")
		ce.Details = map[string]any{"retry_after_s": int(pinCooldown.Seconds())}
		return ce
	}
	ce := codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "PIN does not match")
	ce.Details = map[string]any{"attempts_before_cooldown": pinCooldownEvery - failed%pinCooldownEvery}
	return ce
}

// derefStr is "" for a nil PIN (no PIN on file never matches).
func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// PinAttemptsResetRequest is POST /admin/transport/pin-attempts/reset.
type PinAttemptsResetRequest struct {
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
	Purpose    string `json:"purpose"`
	Reason     string `json:"reason"`
}

var (
	pinEntityTypes = map[string]bool{"trip": true, "parcel": true, "business_delivery": true, "towing_job": true}
	pinPurposes    = map[string]bool{"start": true, "pickup": true, "dropoff": true}
)

// ResetPinAttempts is the support action for a PIN_LOCKED hand-off: it clears
// the wrong-PIN record (a cooldown or a hard lock) and audits the cleared
// record with the reason, in one transaction. It never reveals or changes the
// PIN itself.
func (a *AdminService) ResetPinAttempts(ctx context.Context, adminID string, req PinAttemptsResetRequest) error {
	req.Reason = strings.TrimSpace(req.Reason)
	switch {
	case !pinEntityTypes[req.EntityType] || !pinPurposes[req.Purpose] || strings.TrimSpace(req.EntityID) == "":
		return codedErr(http.StatusBadRequest, "INVALID_PIN_ATTEMPT_KEY", "entity_type, entity_id and purpose must name a hand-off")
	case req.Reason == "" || len(req.Reason) > 500:
		return codedErr(http.StatusBadRequest, "REASON_REQUIRED", "a reason (at most 500 characters) is required")
	}
	tx, err := a.svc.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var failed int
	var hard bool
	err = tx.QueryRow(ctx, `
		DELETE FROM public.transport_pin_attempts
		WHERE entity_type=$1 AND entity_id=$2 AND purpose=$3
		RETURNING failed_count, hard_locked`, req.EntityType, req.EntityID, req.Purpose).Scan(&failed, &hard)
	if errors.Is(err, pgx.ErrNoRows) {
		return codedErr(http.StatusNotFound, CodeNotFound, "no wrong-PIN record for that hand-off")
	}
	if err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, adminID, "pin_attempts.reset", "pin_attempts",
		req.EntityType+":"+req.EntityID+":"+req.Purpose,
		map[string]any{"failedCount": failed, "hardLocked": hard}, nil, req.Reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
