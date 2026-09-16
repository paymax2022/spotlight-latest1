-- ─────────────────────────────────────────────────────────────────────────────
-- Member-proposed meetings, approved by an organisation admin.
--
-- WHY THIS EXISTS
-- ---------------
-- Only an admin could put a meeting on the calendar: POST
-- /admin/organisations/:id/meetings is gated on requireOrgAdmin, and the
-- member-facing routes were read/RSVP/check-in only. An ordinary member had no
-- way to propose one at all.
--
-- Approval is a SEPARATE COLUMN from `state`, not another value in it. The two
-- answer different questions and both are needed at once: `state` is where the
-- meeting is in its lifecycle (UPCOMING / LIVE / PAST / CANCELLED) and approval
-- is whether it may be seen by the organisation. A meeting awaiting approval is
-- still UPCOMING, and folding the two together would make "pending" and
-- "cancelled" mutually exclusive with a start time — which they are not.
--
-- DEFAULT 'APPROVED' is deliberate and load-bearing. Every meeting that already
-- exists was created by an admin through the admin route, so it is approved by
-- construction; defaulting to PENDING would hide the entire existing calendar
-- from every member the moment this migration ran.
--
-- Additive: new nullable columns, one new column with a safe default, and a
-- CHECK constraint that every existing row already satisfies. Nothing dropped,
-- renamed or narrowed.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.assoc_meetings
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS decided_by      uuid,
  ADD COLUMN IF NOT EXISTS decided_at      timestamptz,
  ADD COLUMN IF NOT EXISTS decision_note   text;

-- Guarded so the migration stays replayable: ADD CONSTRAINT has no IF NOT
-- EXISTS, and a second run would otherwise abort the whole chain.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assoc_meetings_approval_status_check'
      AND conrelid = 'public.assoc_meetings'::regclass
  ) THEN
    ALTER TABLE public.assoc_meetings
      ADD CONSTRAINT assoc_meetings_approval_status_check
      CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
  END IF;
END $$;

-- The admin approval queue reads pending meetings for one organisation, and the
-- member calendar filters on approval for every listing. Partial index: PENDING
-- is the small, frequently scanned slice, and the approved majority is already
-- covered by the organisation scan.
CREATE INDEX IF NOT EXISTS idx_assoc_meetings_pending
  ON public.assoc_meetings (organisation_id, starts_at)
  WHERE approval_status = 'PENDING';

COMMENT ON COLUMN public.assoc_meetings.approval_status IS
  'PENDING until an org admin decides. Admin-created meetings are APPROVED on '
  'insert; a member proposal starts PENDING and is invisible to the rest of the '
  'organisation until approved. Distinct from `state`, which is lifecycle.';
