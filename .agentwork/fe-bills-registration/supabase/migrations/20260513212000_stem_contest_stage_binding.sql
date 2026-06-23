-- Add stage lifecycle and transitions to stem contests

alter table if exists public.stem_contests
  add column if not exists stage_lifecycle text[] not null default '{}',
  add column if not exists stage_transitions jsonb not null default '{}'::jsonb;
