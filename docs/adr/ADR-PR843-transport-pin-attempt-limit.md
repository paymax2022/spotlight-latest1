# ADR-PR843: Attempt limit for transport hand-off PINs

**Status:** Accepted · **Date:** 2026-10-18 · **Area:** transport security

## Context
Five hand-offs are confirmed with a 4-digit PIN:
- parcel pickup and drop-off;
- ride start;
- towing start;
- business-delivery drop-off.

The PIN is held by the party who is NOT being verified (sender, receiver or rider), and the courier or driver types it in. None of the verify endpoints limited attempts. 10,000 values can be scripted in seconds, so the party being verified could complete the hand-off alone. For a parcel, that also releases the fare escrow to the courier.

## Decision
A single guard, `checkPin`, sits in front of all five checks. It counts wrong PINs per (entity, purpose) in `transport_pin_attempts`:
- **Cooldown:** every **5** wrong PINs triggers a **15-minute cooldown**. During it, even the correct PIN is refused (`429 PIN_LOCKED`). An honest user who mistypes a few times loses nothing. Brute force needs about 2,000 cooldowns, roughly three weeks for the full space and about ten days to the expected hit.
- **Hard lock:** **15** wrong PINs in total hard-locks the hand-off (`423 PIN_LOCKED`) until support clears it. That's far more misses than a real receiver makes, and it's logged as a security event.
- **Reset:** a correct PIN resets the count.
- **Comparison:** constant-time.
- **Fail closed:** a hand-off is never verified without its attempt record.

## Consequences
- A hard lock stops that hand-off until support acts. There is no admin unlock UI yet, so for now the fix is deleting the row. Adding the unlock action is a follow-up.
- The counter only blocks this attack while the PIN stays secret. A party that holds the PIN, such as a colluding receiver, is out of scope.
- **Concurrent guesses are serialised.** Each check runs in a transaction holding a `pg_advisory_xact_lock` on (entity, purpose). A parallel burst therefore cannot slip past the cooldown: the 6th guess always sees the lock the 5th one set. The security review found this race in the first version, where a single burst of N parallel guesses was compared in full; a regression test now pins it.
- Lock and counter writes happen inside that transaction, and the check fails closed if any of them fails.
