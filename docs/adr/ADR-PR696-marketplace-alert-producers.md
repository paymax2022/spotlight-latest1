# ADR-PR696: Marketplace alert producers (new listing, saved-price drop)

- **Status:** Accepted
- **Date:** 2026-10-11
- **Module:** marketplace (notifications; no money path)

## Context

The Account hub promised follow alerts and price-drop alerts, but nothing wrote
the corresponding inbox rows. The one existing price-drop emitter notified every
saver on any decrease, ignoring `saved_price_kobo`, blocks and notification prefs.
Fan-out to followers is unbounded in principle (a popular seller), and listing
writes must never be slowed or failed by it.

## Decision

1. **Producers run after commit, detached.** `notifyFollowersOfListing` /
   `notifySaversOfPriceDrop` start a goroutine with `context.WithoutCancel` and a
   60 s timeout, recovering panics. The listing write cannot fail or wait on them.
2. **Bounded fan-out.** One SQL statement per page (500 recipients, keyset on the
   recipient uuid), at most 5,000 recipients per event. Block, prefs and
   idempotency filtering happen in that statement, not per-row in Go.
3. **Idempotency via a dedupe key, not a read-then-write.** `mkt_notifications`
   gains nullable `dedupe_key` with a partial unique index `(user_id, dedupe_key)`;
   inserts are `ON CONFLICT DO NOTHING`. Keys: `new_listing:<listing>` and
   `price_drop:<listing>:<old>:<new>` — so a retry is silent while a further drop
   ("once per drop") notifies again. Existing producers leave it NULL and are
   unaffected.
4. **Suppression.** A `mkt_blocks` row in either direction between recipient and
   seller drops the alert. Absent prefs row = all-on defaults.
5. **New pref `new_listing`** (default true) rather than overloading `price_drop`
   or the opt-in `promotional`; plus enum value `new_listing`.
6. **Flag** `FEATURE_MARKETPLACE_ALERTS_ENABLED`, default off. Off keeps the legacy
   price-drop broadcast exactly as before (no behaviour change until enabled).

## Consequences

- Alerts are best-effort: a crash mid-fan-out loses the rest of that event's
  recipients (no outbox/retry). Accepted for inbox notifications; an outbox is the
  upgrade path if delivery guarantees are needed.
- Events over 5,000 followers are truncated, logged as a cap hit.
- Re-activating a listing (renew, un-pause) does not re-alert; only create/approve.
- Migration is additive (`20271025000000_mkt_alert_producers.sql`).
