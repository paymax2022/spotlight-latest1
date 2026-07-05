-- Association module: chat message reactions.
--
-- ADDITIVE ONLY. Introduces a new table so members can react to chat messages
-- with an emoji (toggle semantics: one row per (message, member, emoji)).
-- No existing table/column is dropped, renamed, or narrowed.
--
-- Backs: POST /api/finance/associations/chat/threads/:id/messages/:messageId/react
-- Service: association.Service.ReactToMessage (backend/internal/association).

create table if not exists assoc_chat_message_reactions (
  message_id    uuid not null references assoc_chat_messages(id) on delete cascade,
  membership_id uuid not null references assoc_memberships(id),
  emoji         text not null,
  created_at    timestamptz not null default now(),
  primary key (message_id, membership_id, emoji)
);

create index if not exists idx_assoc_chat_reactions_message
  on assoc_chat_message_reactions(message_id);

-- RLS: backend-only access (service-role), consistent with the rest of the
-- assoc_* tables locked down in 20260703225152_rls_backend_only_lockdown.sql.
alter table if exists assoc_chat_message_reactions enable row level security;
