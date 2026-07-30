-- Winner -> role handover (EL-015 / EC-011). Additive-only.
--
-- A position may confer an admin role on its winner. On handover (an explicit,
-- officer-triggered step after results are PUBLISHED) the winning member is granted
-- that role and the outgoing holders of the role in the org are revoked, so no
-- outgoing exec keeps lingering access. handover_at makes it exactly-once.

alter table assoc_election_positions
  add column if not exists role text
    check (role is null or role in ('CHAPTER_ADMIN','FINANCE_ADMIN','SECRETARY','NATIONAL_ADMIN'));
-- NULL role = ceremonial position (no handover). SUPER_ADMIN is intentionally not
-- electable; NONE is not a grantable role.

alter table assoc_elections
  add column if not exists handover_at timestamptz;
