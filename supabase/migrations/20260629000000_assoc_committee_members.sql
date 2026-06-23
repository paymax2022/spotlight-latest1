-- ─────────────────────────────────────────────────────────────────────────────
-- Association module: committee membership table — additive only.
-- Enables RequestJoinCommittee (service_actions.go) to persist PENDING join
-- requests and committee admins to approve/remove them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists assoc_committee_members (
  id             uuid        primary key default gen_random_uuid(),
  committee_id   uuid        not null references assoc_committees(id),
  membership_id  uuid        not null references assoc_memberships(id),
  role           text        not null default 'MEMBER'
                               check (role in ('CHAIR','CO_CHAIR','SECRETARY','TREASURER','MEMBER')),
  status         text        not null default 'PENDING'
                               check (status in ('PENDING','ACTIVE','DECLINED','REMOVED')),
  joined_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (committee_id, membership_id)
);

create index if not exists idx_assoc_committee_members_committee
  on assoc_committee_members(committee_id);
create index if not exists idx_assoc_committee_members_membership
  on assoc_committee_members(membership_id);
create index if not exists idx_assoc_committee_members_status
  on assoc_committee_members(committee_id, status);

-- RLS: members can see their own committee memberships; committee
-- chairs can see all members of their committees.
alter table assoc_committee_members enable row level security;

create policy if not exists "member: own committee memberships"
  on assoc_committee_members for select
  using (
    membership_id in (
      select id from assoc_memberships where user_id = auth.uid()
    )
  );

create policy if not exists "service role: full access"
  on assoc_committee_members for all
  using (auth.role() = 'service_role');
