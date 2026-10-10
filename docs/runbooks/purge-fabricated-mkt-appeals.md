# Runbook — Purge the 3 fabricated w9-probe rows from the appeals admin queue

> Audience: a database owner with write access to the **production** Supabase
> Postgres. These are HUMAN steps — nothing here is automated, there is no
> migration for this (data cleanup, not schema), and nothing in this file has
> been run by the agent that wrote it.

## 0. What you are deleting and why it is safe

During the wave-9 ("w9-marketplace") production probe, `POST /v1/marketplace/appeals`
accepted **three fabricated appeals** and returned 201. They now sit in
`public.mkt_appeals` — the table the admin console's appeals queue reads
(`GET /v1/marketplace/admin/appeals`).

The three fabricated shapes (locked in by
`backend/internal/marketplace/appeal_validation_live_db_test.go`,
`TestLiveDB_FileAppeal_StandingActionGate`):

1. **Nonexistent target** — `target_id` references no real row
   (a random uuid).
2. **Foreign target** — the appeal was filed against ANOTHER member's
   listing (`target_id`'s `seller_id` ≠ `appellant_id`).
3. **Never-moderated target** — a real, own listing that never carried the
   moderation action being appealed (e.g. `original_action='removed_policy'`
   on an `active` listing).

Since the standing-action gate shipped (`Service.FileAppeal` in
`backend/internal/marketplace/service_admin.go`), **no legitimate appeal can
exist in any of those three states** — a real appeal is only ever filed when
the appellant owns the target AND the target currently carries the action.
That is what makes the invariant-violation query below a safe selector: any
open row matching it is, by construction, a probe artifact.

> No literal row UUIDs exist in the repo — the probe rows were created by an
> HTTP probe against prod, not seeded from code. The procedure below therefore
> works in two passes: **discover** the candidate ids, eyeball them, then
> **delete by explicit id list** inside a transaction.

Do **not** delete anything from `mkt_admin_audit_log` (if the probe's file
events were audited). The audit trail is append-only by design; leave it.

## 1. Connect

Use the production project's pooled DSN with a write-capable role (service
role / postgres). The `mkt_appeals` table has RLS enabled with **no policies**
— it is backend-service-role-only — so connect as the `postgres` user or a
service-role credential, never `anon`/`authenticated`.

```bash
psql "postgresql://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres"
```

> Prefer `supabase projects list` / the dashboard's connect panel to get the
> exact host. Do NOT point this at `DATABASE_URL` in local env files — that is
> the same prod pooler, but confirm the project ref is the **production**
> project before continuing.

## 2. Discover the candidate rows

Run this read-only query first. It encodes exactly the three fabricated
shapes, restricted to queue states a still-pending probe artifact can be in:

```sql
SELECT id, market_id, appellant_id, target_type, target_id,
       original_action, original_reason_code, appellant_note,
       status, decision, decided_by, created_at
  FROM public.mkt_appeals
 WHERE status IN ('opened','under_review')
   AND (
        -- shape 1: target does not exist at all
        (target_type = 'listing' AND NOT EXISTS
            (SELECT 1 FROM public.mkt_listings l WHERE l.id = mkt_appeals.target_id))
        OR (target_type = 'boost' AND NOT EXISTS
            (SELECT 1 FROM public.mkt_boosts b WHERE b.id = mkt_appeals.target_id))
        OR (target_type = 'user' AND NOT EXISTS
            (SELECT 1 FROM public.platform_users u WHERE u.id = mkt_appeals.target_id))
        -- shape 2: filed against a target the appellant does not own
        -- (FileAppeal forbids it; a 'user' appeal may only ever target the
        -- appellant themself)
        OR (target_type = 'listing' AND EXISTS
            (SELECT 1 FROM public.mkt_listings l
              WHERE l.id = mkt_appeals.target_id AND l.seller_id <> mkt_appeals.appellant_id))
        OR (target_type = 'boost' AND EXISTS
            (SELECT 1 FROM public.mkt_boosts b
              WHERE b.id = mkt_appeals.target_id AND b.seller_id <> mkt_appeals.appellant_id))
        OR (target_type = 'user' AND target_id <> appellant_id)
        -- shape 3: the claimed action was never standing on the target
        -- (listing must be removed_policy; user must be suspended/banned;
        --  boost must be rejected_with_reason, or auto_refunded by an admin
        --  rejection — 'seller_cancelled' is NOT a moderation action, it is
        --  the constant boostSellerCancelReason in service_boost.go)
        OR (target_type = 'listing' AND original_action = 'removed_policy' AND EXISTS
            (SELECT 1 FROM public.mkt_listings l
              WHERE l.id = mkt_appeals.target_id
                AND l.seller_id = mkt_appeals.appellant_id
                AND l.status <> 'removed_policy'))
        OR (target_type = 'user' AND original_action IN ('suspended','banned') AND NOT EXISTS
            (SELECT 1 FROM public.mkt_user_moderation m
              WHERE m.user_id = mkt_appeals.appellant_id
                AND m.status IN ('suspended','banned')))
        OR (target_type = 'boost' AND original_action IN ('rejected_with_reason','auto_refunded') AND NOT EXISTS
            (SELECT 1 FROM public.mkt_boosts b
              WHERE b.id = mkt_appeals.target_id
                AND b.seller_id = mkt_appeals.appellant_id
                AND (b.status = 'rejected_with_reason'
                     OR (b.status = 'auto_refunded'
                         AND b.rejection_reason_code IS NOT NULL
                         AND b.rejection_reason_code <> 'seller_cancelled'))))
   )
 ORDER BY created_at;
```

## 3. Verify before you delete — hard gate

- **Expect exactly 3 rows.** If you get a different count, STOP and escalate
  to the marketplace lane owner — do not delete anything.
- Sanity-check each row:
  - `created_at` should cluster around the w9 probe window (the probe ran in
    one sitting; the three rows should be minutes apart).
  - `appellant_note` / `original_reason_code` will look like probe filler
    (short tokens, e.g. a bare `'X'` reason code — the test fixtures use
    exactly that).
  - `decided_by IS NULL` and `executed_at IS NULL` — a real appeal that was
    legitimately decided is NOT a probe artifact even if it trips a predicate.
- **False-positive caveat for shape 3:** a legitimate appeal can trip the
  "action not currently standing" predicate if the target's state changed
  AFTER filing (listing purged/restored, member reinstated). That is why the
  delete below runs against an explicit id list, not this predicate — the
  query is a discovery aid, the human verification above is the selector.
- Copy the full result rows into the incident/cleanup ticket BEFORE deleting
  (the DELETE below returns the rows too, but keep a record first).

## 4. Delete, in one transaction, keyed on the confirmed ids

Bind the three ids you confirmed as psql variables — quoting them like this
keeps the ids literal-bound (no string concatenation):

```bash
psql "postgresql://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres" \
  -v id1='<uuid-of-candidate-1>' \
  -v id2='<uuid-of-candidate-2>' \
  -v id3='<uuid-of-candidate-3>'
```

```sql
BEGIN;

-- Re-read the exact rows you are about to delete, locked, and confirm they
-- are still the same 3 candidates (status still opened/under_review).
SELECT id, status, target_type, target_id, appellant_id, created_at
  FROM public.mkt_appeals
 WHERE id IN (:'id1'::uuid, :'id2'::uuid, :'id3'::uuid)
   AND status IN ('opened','under_review')
 FOR UPDATE;
--   ^ must return exactly 3 rows. If it does not, ROLLBACK and re-verify.

DELETE FROM public.mkt_appeals
 WHERE id IN (:'id1'::uuid, :'id2'::uuid, :'id3'::uuid)
   AND status IN ('opened','under_review');
--   ^ expect DELETE 3

-- Final check inside the same transaction.
SELECT count(*) AS remaining
  FROM public.mkt_appeals
 WHERE id IN (:'id1'::uuid, :'id2'::uuid, :'id3'::uuid);
--   ^ expect 0

COMMIT;   -- only after DELETE 3 and remaining = 0; otherwise ROLLBACK.
```

`mkt_appeals` has no dependent FKs (nothing references `mkt_appeals.id`), so
the delete cannot cascade — the three rows are the entire blast radius.

## 5. Post-check

```sql
-- The admin queue should show no invariant-violating open rows anymore.
SELECT count(*) FROM public.mkt_appeals WHERE status IN ('opened','under_review');
```

Then load the admin console appeals queue (`/admin` → Appeals) and confirm
the three fabricated entries are gone.

## References

- Gate that made these rows impossible to file legitimately:
  `Service.FileAppeal` — `backend/internal/marketplace/service_admin.go`
  (target existence → 404, foreign target → 403, no standing action → 422).
- Regression spec naming the three shapes:
  `backend/internal/marketplace/appeal_validation_live_db_test.go` —
  `TestLiveDB_FileAppeal_StandingActionGate`.
- Table schema (columns, CHECK vocab, "backend-service-role-only" posture):
  `supabase/migrations/20270225000000_marketplace_admin_users_appeals_fraud.sql`.
