-- Seed staging + production module state to match what those tiers ALREADY serve,
-- so mounting the registry routes changes nothing for users (additive-only, data-only).
--
-- WHY THIS IS NEEDED FIRST: the registry's routes were never mounted
-- (modules.Register was called nowhere), so GET /api/v1/modules/visibility answered
-- 404, every client fell back to its documented "unknown ⇒ show everything", and
-- publication state had no effect anywhere. Meanwhile every staging and production row
-- in platform_module_environments sits at 'hidden' — the table's default, never
-- curated, because nothing read it.
--
-- Mounting the routes with that data intact would flip both tiers from "shows
-- everything" to "shows nothing" in one deploy. This aligns the recorded state with
-- observed behaviour BEFORE the wiring lands, so the mount is a no-op and hiding a
-- module afterwards becomes a deliberate, auditable act in the admin console.
--
-- Development is left alone: it is already all-'visible'.
--
-- NOT a blanket "publish everything" — it publishes exactly the set that is reachable
-- today. The FEATURE_* env flag still gates each module independently (VisibleIn
-- requires EnvFlagEnabled), so a module whose flag is off in a tier stays dark there
-- regardless of this row.

UPDATE public.platform_module_environments
   SET status = 'visible',
       note = COALESCE(note, 'seeded to match pre-registry behaviour'),
       updated_at = NOW()
 WHERE environment IN ('staging', 'production')
   AND status = 'hidden';
