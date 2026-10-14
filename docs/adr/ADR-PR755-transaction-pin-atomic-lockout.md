# ADR-PR755: Transaction-PIN lockout reserves an attempt atomically before the compare

Status: accepted · Closes the "PIN lockout is not race-safe" gap recorded in ADR-PR719.

## Context
`pinStore.Verify` read `failed_attempts`, ran bcrypt, then wrote `read + 1`. Parallel wrong guesses all read the same
count and all passed the lock check, so a burst tested far more than the 5-guess limit and the stored count
under-reported it (40 of 40 guesses were evaluated in a live reproduction). The store is shared by wallet transfers
and by the crypto swap confirm, so both inherited it.

## Decision
Reserve an attempt **before** the slow compare, in one `UPDATE ... WHERE unlocked RETURNING`, which also sets the lock
when the reservation reaches the threshold. Postgres serialises concurrent updates of the row, so at most
`maxPinFailures` guesses are evaluated whatever the concurrency. A correct PIN resets the counter and lock.

Alternatives rejected:
- `SELECT ... FOR UPDATE` around the whole verify: holds a row lock for the full bcrypt (~60 ms) and serialises the
  legitimate user behind an attacker's guesses.
- Atomic increment *after* the compare: fixes the undercount but still lets a burst evaluate unlimited guesses before
  the lock lands, which is the part that matters.

## Consequences
- Public behaviour is unchanged (countdown, lock at the 5th wrong guess, lock holds for the right PIN, expired lock
  accepts the right PIN, unset PIN fails closed); no signature or schema change.
- A successful verify resets the counter, so it also erases other in-flight wrong guesses. An attacker would need the
  right PIN to trigger that.
- After a lock expires `failed_attempts` is still at the threshold, so the first wrong guess relocks immediately.
  This is the previous behaviour, kept on purpose.
- A failed reset after a correct PIN now fails closed (it used to be swallowed): the reservation counted the
  success too, so an unreset counter could leave the user locked while the money step proceeded.
- **Parallel correct PINs each take a reservation.** A client already at 4 failures that fires two correct
  requests at once can see the second refused as locked for about one bcrypt (~60 ms) until the first success
  resets the state; a retry storm of 6+ simultaneous correct requests can trip the lock the same way. Transient
  and self-clearing, and the price of capping guesses by reservation rather than by outcome.

## Not covered
Per-user rate limiting on quote/confirm, and rate limiting by IP or device.
