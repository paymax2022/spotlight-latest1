-- Association elections — integrity-critical governance (TS-13 / §4 invariants).
-- Additive-only: new tables, no DROP / rename / type-narrowing.
--
-- BALLOT SECRECY BY CONSTRUCTION: the "who voted" record (assoc_election_ballots_cast)
-- and the "what was chosen" record (assoc_election_votes) are separate tables with
-- NO column or FK linking a voter to a choice. Turnout + one-member-one-vote stay
-- enforceable/auditable (ballots_cast), while individual choices are anonymous
-- (votes has no voter reference and no timestamp), so not even a DB admin can join
-- a member to their vote.

create table if not exists assoc_elections (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references assoc_organisations(id),
  title                 text not null,
  description           text,
  status                text not null default 'DRAFT'
                          check (status in ('DRAFT','NOMINATION','VOTING','CLOSED','PUBLISHED','CANCELLED')),
  voting_opens_at       timestamptz,
  voting_closes_at      timestamptz,
  require_good_standing boolean not null default true,   -- eligibility excludes arrears (OVERDUE)
  sealed_results        boolean not null default true,    -- tallies hidden until PUBLISHED
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  published_at          timestamptz
);
create index if not exists idx_assoc_elections_org on assoc_elections (organisation_id);

create table if not exists assoc_election_positions (
  id          uuid primary key default gen_random_uuid(),
  election_id uuid not null references assoc_elections(id) on delete cascade,
  title       text not null,
  seats       int  not null default 1 check (seats >= 1),
  sort_order  int  not null default 0
);
create index if not exists idx_assoc_election_positions_election on assoc_election_positions (election_id);

create table if not exists assoc_election_candidates (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references assoc_elections(id) on delete cascade,
  position_id   uuid not null references assoc_election_positions(id) on delete cascade,
  membership_id uuid not null references assoc_memberships(id),
  manifesto     text,
  status        text not null default 'APPROVED'
                  check (status in ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  created_at    timestamptz not null default now(),
  unique (position_id, membership_id)   -- one candidacy per member per position
);
create index if not exists idx_assoc_election_candidates_position on assoc_election_candidates (position_id);

-- WHO voted — turnout + one-member-one-vote enforcement. Holds the voter, NOT the choice.
create table if not exists assoc_election_ballots_cast (
  id                  uuid primary key default gen_random_uuid(),
  election_id         uuid not null references assoc_elections(id) on delete cascade,
  position_id         uuid not null references assoc_election_positions(id) on delete cascade,
  voter_membership_id uuid not null references assoc_memberships(id),
  receipt             text not null,          -- confirmation code; encodes NO choice
  cast_at             timestamptz not null default now(),
  unique (election_id, position_id, voter_membership_id)   -- one member, one vote per position
);

-- WHAT was chosen — anonymous. No voter reference, no timestamp: a choice cannot be
-- linked back to a voter even by a DB admin (ballot secrecy, §4.3 / EL-008 / EC-004).
create table if not exists assoc_election_votes (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null references assoc_elections(id) on delete cascade,
  position_id  uuid not null references assoc_election_positions(id) on delete cascade,
  candidate_id uuid not null references assoc_election_candidates(id)
);
create index if not exists idx_assoc_election_votes_tally on assoc_election_votes (position_id, candidate_id);

-- Published, immutable results snapshot. Append-only (unique key blocks re-publish),
-- with a per-position checksum over the ordered tally for tamper-evidence.
create table if not exists assoc_election_results (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null references assoc_elections(id),
  position_id  uuid not null references assoc_election_positions(id),
  candidate_id uuid not null references assoc_election_candidates(id),
  votes        int  not null,
  is_winner    boolean not null default false,
  checksum     text not null,
  published_at timestamptz not null default now(),
  unique (election_id, position_id, candidate_id)
);
