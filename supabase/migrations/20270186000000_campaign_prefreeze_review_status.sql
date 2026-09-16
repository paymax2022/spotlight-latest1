-- Freezing a campaign remembers what it was, so unfreezing can put it back.
--
-- Both freeze paths wrote FROZEN and both unfreeze paths wrote ACTIVE
-- unconditionally:
--   • adminext SetCampaignFreeze — the console's Freeze/Unfreeze buttons
--   • reviewTransition UNFREEZE  — the decision endpoint
-- So freezing a campaign that was awaiting review and then unfreezing it
-- APPROVED it. An operator freezing a suspicious submission to investigate, then
-- releasing the freeze, pushed it live without any review decision ever being
-- recorded — and nothing in the audit trail says "approved", because nobody
-- approved it.
--
-- The prior status has to be stored: it cannot be derived. cf_audit_logs records
-- that a freeze happened, not what the campaign was before it, and by the time
-- unfreeze runs the old value has been overwritten.
--
-- Additive and nullable: existing rows have no prior status, and unfreeze falls
-- back to ACTIVE for them — exactly today's behaviour, so nothing already frozen
-- changes meaning when this lands.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS pre_freeze_review_status text;

COMMENT ON COLUMN public.campaigns.pre_freeze_review_status IS
  'review_status captured at freeze time so unfreeze can restore it. NULL when '
  'the campaign is not frozen, or was frozen before this column existed (unfreeze '
  'then falls back to ACTIVE). Cleared on unfreeze.';

-- Backfill what can be known: a campaign frozen right now has no record of its
-- prior state, so this deliberately sets NOTHING. Guessing PENDING_REVIEW or
-- ACTIVE for already-frozen campaigns would invent a review decision, which is
-- the exact failure being fixed. Those keep the ACTIVE fallback until they are
-- unfrozen and frozen again.
