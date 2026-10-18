package transport

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
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
func (s *Service) checkPin(ctx context.Context, entityType, entityID, purpose, expected, given, actorUserID string) error {
	var failed int
	var lockedUntil *time.Time
	var hard bool
	err := s.db.QueryRow(ctx, `
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
			_, _ = s.db.Exec(ctx, `DELETE FROM public.transport_pin_attempts
				WHERE entity_type=$1 AND entity_id=$2 AND purpose=$3`, entityType, entityID, purpose)
		}
		return nil
	}

	// Wrong PIN: count it atomically, then lock if this one crossed a line.
	err = s.db.QueryRow(ctx, `
		INSERT INTO public.transport_pin_attempts (entity_type, entity_id, purpose, failed_count, last_actor_id, updated_at)
		VALUES ($1, $2, $3, 1, NULLIF($4,'')::uuid, now())
		ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE
		  SET failed_count = transport_pin_attempts.failed_count + 1,
		      last_actor_id = EXCLUDED.last_actor_id, updated_at = now()
		RETURNING failed_count`, entityType, entityID, purpose, actorUserID).Scan(&failed)
	if err != nil {
		return err
	}
	switch {
	case failed >= pinHardLockAt:
		_, _ = s.db.Exec(ctx, `UPDATE public.transport_pin_attempts SET hard_locked=true, updated_at=now()
			WHERE entity_type=$1 AND entity_id=$2 AND purpose=$3`, entityType, entityID, purpose)
		log.Printf("[transport] SECURITY %s %s %s PIN hard-locked after %d wrong attempts (actor %s)", entityType, entityID, purpose, failed, actorUserID)
		s.recordModeEvent(ctx, actorUserID, "pin.hard_locked", entityType, entityID, "", "",
			map[string]any{"purpose": purpose, "failed_count": failed})
		return codedErr(http.StatusLocked, CodePinLocked, "too many wrong PINs; contact support to continue")
	case failed%pinCooldownEvery == 0:
		_, _ = s.db.Exec(ctx, `UPDATE public.transport_pin_attempts SET locked_until=now() + make_interval(secs => $4), updated_at=now()
			WHERE entity_type=$1 AND entity_id=$2 AND purpose=$3`, entityType, entityID, purpose, pinCooldown.Seconds())
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
