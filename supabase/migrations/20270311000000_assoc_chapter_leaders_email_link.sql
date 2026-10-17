-- =============================================================================
-- assoc_chapter_leaders — email + platform-account link, so a state leader
-- captured during org creation (wizard step "structure") can be:
--   (a) auto-linked to their platform_users account when their email matches
--       one (PublishOrganisation grants them CHAPTER_ADMIN scoped to their
--       state's chapter — see service_ext.go), and
--   (b) sent an onboarding email with next steps (see the new LeaderNotifier
--       seam and the association Brevo welcome template).
--
-- leader_contact (free text: "phone or email") is left untouched — leader_email
-- is the ONLY field the auto-link/notify logic reads, so a phone number typed
-- into the ambiguous legacy field never gets treated as an email address.
-- =============================================================================

ALTER TABLE assoc_chapter_leaders ADD COLUMN IF NOT EXISTS leader_email text;
ALTER TABLE assoc_chapter_leaders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE assoc_chapter_leaders ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_assoc_chapter_leaders_user
  ON assoc_chapter_leaders (user_id) WHERE user_id IS NOT NULL;
