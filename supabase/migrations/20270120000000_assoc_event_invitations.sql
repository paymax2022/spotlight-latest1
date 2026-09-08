-- ─────────────────────────────────────────────────────────────────────────────
-- Event invitations.
--
-- WHY THIS EXISTS
-- ---------------
-- Events could be created (by an admin) and responded to, but nobody could be
-- INVITED to one: the only way a member learned about an event was finding it
-- in the list. There was no way to put an event in front of specific people.
--
-- AN INVITATION IS A REGISTRATION ROW, NOT A NEW TABLE.
-- assoc_event_registrations already holds the (event, membership) relationship
-- and carries the RSVP, the ticket and the check-in. Adding a second table for
-- invitations would create two answers to "is this member associated with this
-- event", and they would drift the moment someone RSVPs to an event they were
-- invited to — the RSVP would land on one row and the invitation on another.
--
-- So an invitation is simply a registration row with invited_at set: the member
-- RSVPs onto the SAME row, and the invitation, the response and the attendance
-- stay one record.
--
-- Additive: two nullable columns and one partial index. Existing rows are
-- untouched and read as "not invited, they found it themselves", which is
-- exactly what they were.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.assoc_event_registrations
  ADD COLUMN IF NOT EXISTS invited_by uuid,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

-- "What am I invited to" is the member-facing read, and invitations are the
-- small slice of the table, so the index is partial.
CREATE INDEX IF NOT EXISTS idx_assoc_event_regs_invited
  ON public.assoc_event_registrations (membership_id, event_id)
  WHERE invited_at IS NOT NULL;

COMMENT ON COLUMN public.assoc_event_registrations.invited_at IS
  'Set when a member was explicitly invited. NULL means they were not invited — '
  'either they found the event themselves or the row predates invitations. The '
  'RSVP lands on this same row, so invitation and response never diverge.';
