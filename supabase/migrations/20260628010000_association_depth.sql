-- ─────────────────────────────────────────────────────────────────────────────
-- Association module — backend depth (additive)
-- Per-member chat thread state: persists mute preference and the last-read
-- timestamp so unread counts can be computed from assoc_chat_messages.
-- ADDITIVE ONLY — no DROP / rename / type narrowing.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists assoc_chat_thread_state (
  thread_id     uuid not null references assoc_chat_threads(id),
  membership_id uuid not null references assoc_memberships(id),
  muted         boolean not null default false,
  last_read_at  timestamptz not null default 'epoch',
  updated_at    timestamptz not null default now(),
  primary key (thread_id, membership_id)
);

create index if not exists idx_assoc_chat_thread_state_member
  on assoc_chat_thread_state (membership_id);
