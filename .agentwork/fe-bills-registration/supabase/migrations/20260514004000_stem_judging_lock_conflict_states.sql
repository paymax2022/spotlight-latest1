-- STEM judging lock/review/conflict state extension

alter table if exists public.stem_review_scores_v2
  add column if not exists review_status text not null default 'submitted',
  add column if not exists is_locked boolean not null default false,
  add column if not exists lock_reason text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists has_conflict boolean not null default false,
  add column if not exists conflict_reason text;

alter table if exists public.stem_judge_assignments
  add column if not exists has_conflict boolean not null default false,
  add column if not exists conflict_reason text;

create index if not exists idx_stem_review_scores_v2_review_status
  on public.stem_review_scores_v2(review_status);

create index if not exists idx_stem_review_scores_v2_is_locked
  on public.stem_review_scores_v2(is_locked);

create index if not exists idx_stem_review_scores_v2_has_conflict
  on public.stem_review_scores_v2(has_conflict);

create index if not exists idx_stem_judge_assignments_has_conflict
  on public.stem_judge_assignments(has_conflict);

