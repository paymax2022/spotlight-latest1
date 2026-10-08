-- Add description + created_by to stem_contests (F-1 code–schema drift).
--
-- src/server/stem/persistence.ts selects and inserts
-- stem_contests.description and stem_contests.created_by (listContests,
-- getContest, createContest), but the base table was created without them
-- (20260513203000_stem_contest_engine_foundation.sql) — only the stem_contest_*
-- SUB-tables carry those columns. PostgREST rejected the missing columns and
-- the public GET /api/stem/contests endpoint 500'd for every caller.
--
-- Additive-only: both columns are nullable, no backfill. description is
-- optional (the service falls back to the config objective); created_by matches
-- the sub-tables' FK convention (auth.users, set null on delete).
alter table if exists public.stem_contests
  add column if not exists description text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
