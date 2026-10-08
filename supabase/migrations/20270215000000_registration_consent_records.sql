-- UAT Batch 9 — SEC-010 / RG-003 / EC-006 / G-CON: immutable audit trail for
-- the two photo/likeness-adjacent consent checkboxes captured at registration
-- submission time (media.rightsConfirmed, publicProfile.publicVotingConsent).
--
-- WHY A SEPARATE TABLE, NOT JUST form_data: form_data on public.registrations
-- is a mutable JSONB blob a later saveRegistrationStep call can silently
-- overwrite (e.g. an applicant edits a draft after submission, or an admin
-- rewrites a key during review — see reviewRegistrationApplication's own
-- form_data rewrites for media.photoUrl). It proves what a value IS right
-- now, never what it WAS at the moment consent was actually given. This table
-- is written once per (registration, consent_key) at submission time and never
-- updated or deleted afterwards, so it proves WHEN each consent was captured
-- independent of anything that happens to form_data later.
--
-- SHAPE borrowed from (not reused — see below) contest_registration_consent_records
-- in 20260521193000_reality_tv_registration_engine_foundation.sql: same
-- per-key/accepted/accepted_at/version/ip_address/device_fingerprint columns.
-- That table is unusable here: it foreign-keys to
-- public.contest_registration_applications, a dead table from the same
-- foundation migration that submitRegistrationApplication (supabase-store.ts)
-- has never written to — every real registration lives in public.registrations
-- (see that file's own header comments on the in-memory-store bugs this
-- exact mistake caused elsewhere). This table keys off public.registrations
-- instead, so it actually foreign-keys to something the write path uses.
--
-- Write-once audit log, not a public-facing or admin-editable table — no
-- public read, no UPDATE/DELETE policy for anyone (immutable), matching
-- voting_round_results' posture (20270213000000_contest_prizes_and_results_lock.sql)
-- and contest_admin_approvals' admin-only-manage posture
-- (20270214000000_contest_admin_approvals.sql) for the "no public read"
-- half of that pattern.
--
-- Additive only: no DROP, no renames, no type narrowing.

CREATE TABLE IF NOT EXISTS public.registration_consent_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id   UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  consent_key       TEXT NOT NULL, -- e.g. 'media.rightsConfirmed', 'publicProfile.publicVotingConsent'
  accepted          BOOLEAN NOT NULL,
  accepted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version           TEXT NOT NULL DEFAULT 'v1', -- bump if consent copy/wording changes materially in future
  ip_address        TEXT,
  device_fingerprint TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_consent_records_registration_id
  ON public.registration_consent_records (registration_id);
CREATE INDEX IF NOT EXISTS idx_registration_consent_records_consent_key
  ON public.registration_consent_records (consent_key);

-- ---------------------------------------------------------------------------
-- RLS — admin-only read, no public read, no UPDATE/DELETE policy for anyone
-- (immutable audit log). submitRegistrationApplication writes via the
-- service-role client (supabase-store.ts's getSupabase()), which bypasses RLS
-- entirely, so no INSERT policy is needed for the write path to function;
-- deliberately no INSERT policy is granted to `authenticated` either, so an
-- applicant's own browser session could never forge a consent row directly.
-- ---------------------------------------------------------------------------
ALTER TABLE public.registration_consent_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_registration_consent_records" ON public.registration_consent_records;
CREATE POLICY "admin_read_registration_consent_records"
ON public.registration_consent_records FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);
