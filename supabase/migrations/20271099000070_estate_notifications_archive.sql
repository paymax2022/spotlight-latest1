-- Estate inbox archive + retention (UAT lane estate-d, module M18) — close-out Phase 2.5a.
-- Additive only — no DROP, no RENAME, no type narrowing, no backfill that can lose data.
--
-- This file promotes docs/qa/estate-uat-443/migrations-estate-d/estate_notifications_archive.pending.sql
-- (the `archived_at` column and its partial index, verbatim) and finishes the case that draft was written
-- for — EST-UAT-0359 "Inbox retention: read, archive, search older notifications; critical notices never
-- lost", recorded as ESTD-D008.
--
-- What the case found, in the words of the workplan gap column: "Read state exists; archive, search, and
-- retention policy endpoints don't — and both channels silently cap at 50/100 newest rows, so older
-- (incl. critical) items fall off the inbox". Two different failures live in that sentence and they need
-- different fixes:
--
--   * the cap is a *read* bug — the feed truncated rather than paged, so a notice could become
--     unreachable while still existing; fixed by offset paging + a total count + pinned-first ordering,
--     which are read-side changes (no schema), plus the archive index below so the archived half is
--     reachable at all;
--   * "critical notices never lost" is a *write/deletion* bug — nothing recorded the difference between
--     "out of sight" and "gone". That is what this migration exists for: `archived_at` makes leaving the
--     inbox reversible, and the purge guard below makes it impossible for a retention sweep — or any
--     other DELETE — to erase a notice the estate has pinned, a notice in a critical category, or any
--     notice belonging to an estate under legal hold.
--
-- Product decisions taken here (they were not implied by the case, so they are stated rather than
-- assumed):
--   1. Archive is per recipient, not per estate. `estate_notifications` is already one row per
--      (recipient, event), so `archived_at` sits on the row and archiving one person's copy cannot hide
--      it from another.
--   2. A retention sweep only ever archives *read* items. An unread notice is by definition one nobody
--      has seen yet; moving it out of the inbox on a schedule is how a notice gets lost while looking
--      retained.
--   3. Purge is opt-in per estate. `purge_after_days` defaults to NULL, and NULL means "archive forever"
--      — no estate loses history because a column got created.
--   4. Default protected categories are `security` and `system`: the guard post and the estate's own
--      administrative verdicts. Everything else is the estate's to retain as it wishes.

-- ─── the promoted draft: archive flag + the active-inbox index ─────────────────

ALTER TABLE estate_notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_user_active
    ON estate_notifications (user_id, created_at DESC) WHERE archived_at IS NULL;

COMMENT ON COLUMN estate_notifications.archived_at IS
    'EST-UAT-0359: when this recipient took the notice out of their inbox. NOT NULL means archived, and it is reversible — it is never a deletion.';

-- The other half of the same question ("what did I archive?") had no index either.
CREATE INDEX IF NOT EXISTS idx_notifications_user_archived
    ON estate_notifications (user_id, archived_at DESC) WHERE archived_at IS NOT NULL;

-- Pinned = "this one must not fall off the inbox or be swept". Row-level, because a category is too
-- blunt: the estate knows which single notice a dispute is about.
ALTER TABLE estate_notifications ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN estate_notifications.pinned IS
    'EST-UAT-0359: recipient/estate-admin pin. Never auto-archived, never purgeable, and sorted first so a paging read cannot walk past it.';

-- ─── search ────────────────────────────────────────────────────────────────────
--
-- "search older notifications" is a title/body substring query. Trigrams make it indexable; where
-- pg_trgm is unavailable the query still works, it just seq-scans the inbox (same fallback posture as
-- 20261016000000_restaurant_search.sql, which established the pattern in this repo).
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_trgm unavailable — skipping trigram index on estate_notifications (ILIKE search still works)';
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        CREATE INDEX IF NOT EXISTS idx_notifications_search_trgm
            ON estate_notifications USING gin ((COALESCE(title, '') || ' ' || COALESCE(body, '')) gin_trgm_ops);
    END IF;
END $$;

-- ─── per-estate retention policy ───────────────────────────────────────────────
--
-- Absent row = defaults (enabled, 90-day archive, never purge, {security,system} protected). The policy
-- deliberately has no history table: it is a forward-looking schedule, and `estate_config` already
-- version-revs the rules an estate rewrites by hand. Retention is not a rule anyone litigates over.
CREATE TABLE IF NOT EXISTS estate_notification_retention_policies (
    estate_id           UUID PRIMARY KEY REFERENCES estates(id) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    archive_after_days  INTEGER NOT NULL DEFAULT 90,
    purge_after_days    INTEGER,
    keep_categories     TEXT[]  NOT NULL DEFAULT ARRAY['security','system']::text[],
    updated_by          UUID,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT estate_nrp_archive_positive CHECK (archive_after_days > 0),
    CONSTRAINT estate_nrp_purge_positive   CHECK (purge_after_days IS NULL OR purge_after_days > 0),
    -- Purging inside the archive window is incoherent: a row would have to be archived and eligible for
    -- deletion in the same sweep. Refuse the configuration rather than silently archive-then-keep.
    CONSTRAINT estate_nrp_purge_after_archive
        CHECK (purge_after_days IS NULL OR purge_after_days >= archive_after_days),
    -- The protected list has to be a subset of the notification taxonomy, or a policy could "protect"
    -- a category that cannot exist and quietly protect nothing.
    CONSTRAINT estate_nrp_keep_categories_valid
        CHECK (keep_categories <@ ARRAY['general','payment','meeting','election','security',
                                        'maintenance','facility','announcement','system']::text[])
);

COMMENT ON TABLE estate_notification_retention_policies IS
    'EST-UAT-0359: how long one estate keeps its inboxes. One row per estate; absence means the defaults above.';

-- ─── the purge guard ───────────────────────────────────────────────────────────
--
-- Retention without a guard is a schedule, not a guarantee. This trigger is what makes "critical notices
-- never lost" true for every DELETE path, including ones written after today (the BFF, an admin console,
-- a future cleanup job) rather than only the sweep that ships with it. Mirrors the legal-hold posture of
-- estates_block_delete_under_legal_hold() in 20271068001000.
--
-- There is deliberately no override. An earlier draft of this file let the sweep raise a transaction-local
-- GUC that the trigger honoured; the live-DB run showed why that cannot work — a GUC set inside one
-- statement stays set for the rest of the transaction, so a DELETE issued later in that transaction
-- walked straight past the guard. The sweep does not need it: it filters pinned and protected rows out of
-- its own DELETE, so it only ever asks the trigger to permit a row the trigger would allow anyway.
CREATE OR REPLACE FUNCTION estate_notifications_block_purge()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_hold BOOLEAN;
    v_keep TEXT[];
BEGIN
    -- The owning estate is already going away: this DELETE is the ON DELETE CASCADE from estates, and
    -- the estate row itself has a legal-hold trigger in front of it. Obstructing the cascade here would
    -- turn "delete an unheld estate" into a failure on a notice nobody can any longer read.
    IF NOT EXISTS (SELECT 1 FROM estates e WHERE e.id = OLD.estate_id) THEN
        RETURN OLD;
    END IF;

    SELECT legal_hold INTO v_hold FROM estates e WHERE e.id = OLD.estate_id;
    IF COALESCE(v_hold, FALSE) THEN
        RAISE EXCEPTION 'estate % is under legal hold — its notification history cannot be purged', OLD.estate_id
            USING ERRCODE = '23514';
    END IF;

    SELECT p.keep_categories INTO v_keep
      FROM estate_notification_retention_policies p
     WHERE p.estate_id = OLD.estate_id;
    IF v_keep IS NULL THEN
        v_keep := ARRAY['security','system']::text[];
    END IF;

    IF OLD.pinned OR OLD.category = ANY (v_keep) THEN
        RAISE EXCEPTION 'this notification is retained beyond the sweep (pinned = %, category % is protected for this estate) — unpin it or change the estate retention policy first',
            OLD.pinned, OLD.category
            USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS estate_notifications_block_purge_on_delete ON estate_notifications;
CREATE TRIGGER estate_notifications_block_purge_on_delete
    BEFORE DELETE ON estate_notifications
    FOR EACH ROW EXECUTE FUNCTION estate_notifications_block_purge();

-- ─── the sweep ─────────────────────────────────────────────────────────────────
--
-- One estate's policy applied once. Idempotent: the second run in the same window finds nothing to do,
-- because archiving stamps a timestamp rather than moving the row, and purging only takes rows already
-- stamped past the purge horizon.
CREATE OR REPLACE FUNCTION estate_notifications_retention_for_estate(p_estate_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_enabled      BOOLEAN := TRUE;
    v_archive_days INTEGER := 90;
    v_purge_days   INTEGER;
    v_keep         TEXT[]  := ARRAY['security','system']::text[];
    v_archived     BIGINT  := 0;
    v_purged       BIGINT  := 0;
    v_hold         BOOLEAN;
BEGIN
    IF p_estate_id IS NULL THEN
        RAISE EXCEPTION 'estate_notifications_retention_for_estate needs an estate'
            USING ERRCODE = '22023';
    END IF;

    SELECT enabled, archive_after_days, purge_after_days, keep_categories
      INTO v_enabled, v_archive_days, v_purge_days, v_keep
      FROM estate_notification_retention_policies
     WHERE estate_id = p_estate_id;

    -- No row means the defaults, and that has to be spelled out: SELECT ... INTO leaves every target
    -- NULL when the query returns nothing, so without this branch an estate that never wrote a policy
    -- would get a NULL horizon — which is not "archive after 90 days" but "archive nothing, ever", and
    -- the inbox would keep growing while the schedule looked configured.
    IF NOT FOUND THEN
        v_enabled := TRUE;
        v_archive_days := 90;
        v_purge_days := NULL;
        v_keep := ARRAY['security','system']::text[];
    ELSIF v_keep IS NULL THEN
        v_keep := ARRAY['security','system']::text[];
    END IF;

    IF NOT v_enabled THEN
        RETURN jsonb_build_object('estate_id', p_estate_id, 'skipped', 'disabled',
                                  'archived', 0, 'purged', 0);
    END IF;

    -- Held estates keep every row. The trigger would raise on the DELETE and abort the whole sweep, so
    -- the sweep declines here instead: legal hold is a decision to keep evidence, not a bug to route past.
    SELECT legal_hold INTO v_hold FROM estates WHERE id = p_estate_id;
    IF COALESCE(v_hold, FALSE) THEN
        RETURN jsonb_build_object('estate_id', p_estate_id, 'skipped', 'legal_hold',
                                  'archived', 0, 'purged', 0);
    END IF;

    -- Archive first: read, unpinned, outside the protected categories, past the horizon. The same filters
    -- the guard enforces, applied here so the sweep never asks the trigger to permit a protected row.
    UPDATE estate_notifications
       SET archived_at = NOW()
     WHERE estate_id = p_estate_id
       AND archived_at IS NULL
       AND read_at IS NOT NULL
       AND NOT pinned
       AND NOT (category = ANY (v_keep))
       AND created_at < NOW() - make_interval(days => v_archive_days);
    GET DIAGNOSTICS v_archived = ROW_COUNT;

    IF v_purge_days IS NOT NULL THEN
        DELETE FROM estate_notifications
         WHERE estate_id = p_estate_id
           AND archived_at IS NOT NULL
           AND NOT pinned
           AND NOT (category = ANY (v_keep))
           AND archived_at < NOW() - make_interval(days => v_purge_days);
        GET DIAGNOSTICS v_purged = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object('estate_id', p_estate_id, 'archived', v_archived, 'purged', v_purged,
                              'archive_after_days', v_archive_days, 'purge_after_days', v_purge_days,
                              'keep_categories', v_keep);
END $$;

-- The maintenance entry point: NULL sweeps every estate that has an inbox, each under its own policy.
CREATE OR REPLACE FUNCTION estate_notifications_apply_retention(p_estate_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id     UUID;
    v_res    JSONB := '{}'::jsonb;
    v_one    JSONB;
    v_total  BIGINT := 0;
BEGIN
    IF p_estate_id IS NOT NULL THEN
        RETURN estate_notifications_retention_for_estate(p_estate_id);
    END IF;

    FOR v_id IN SELECT DISTINCT estate_id FROM estate_notifications LOOP
        v_one   := estate_notifications_retention_for_estate(v_id);
        v_res   := v_res || jsonb_build_object(v_id, v_one);
        v_total := v_total + COALESCE((v_one ->> 'archived')::BIGINT, 0)
                          + COALESCE((v_one ->> 'purged')::BIGINT, 0);
    END LOOP;

    RETURN jsonb_build_object('estates', (SELECT COUNT(*) FROM jsonb_object_keys(v_res)),
                              'total', v_total, 'by_estate', v_res);
END $$;

COMMENT ON FUNCTION estate_notifications_apply_retention(UUID) IS
    'EST-UAT-0359: apply each estate''s inbox retention policy. NULL = every estate with an inbox. Never touches pinned rows, protected categories, unread items or a held estate.';

-- ─── RLS: service-role only ────────────────────────────────────────────────────

ALTER TABLE estate_notification_retention_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_retention_policy_service ON estate_notification_retention_policies;
CREATE POLICY notification_retention_policy_service ON estate_notification_retention_policies
    TO service_role USING (true) WITH CHECK (true);

-- ─── take the writers off the anon role ───────────────────────────────────────
--
-- Supabase's default privileges grant EXECUTE on a function created in `public` to the named roles
-- `anon`, `authenticated` and `service_role`; REVOKE ... FROM PUBLIC does not remove a named grant, so an
-- unauthenticated REST caller could have executed the sweep (and set its purge GUC) with no identity at
-- all. Established in Phase 2.4 for the occupancy writers; the same rule is applied here as the file is
-- written rather than fixed forward afterwards.
REVOKE ALL ON FUNCTION estate_notifications_apply_retention(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION estate_notifications_apply_retention(UUID) TO service_role;

REVOKE ALL ON FUNCTION estate_notifications_retention_for_estate(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION estate_notifications_retention_for_estate(UUID) TO service_role;
