-- CM-002: committee/executive chat isolation.
--
-- Links a COMMITTEE-scoped chat thread to its committee so access can be gated to
-- that committee's members (see assoc_committee_members). Additive and nullable —
-- existing threads are GENERAL and remain organisation-scoped; a COMMITTEE thread
-- with a NULL committee_id keeps the legacy org-scoped fallback until linked.
-- No DROP, no backfill, no type narrowing (additive-only migration policy).

alter table assoc_chat_threads
  add column if not exists committee_id uuid references assoc_committees(id);

create index if not exists idx_assoc_chat_threads_committee
  on assoc_chat_threads (committee_id);
