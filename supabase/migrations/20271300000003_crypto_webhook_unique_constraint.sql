-- Blocker 6: Event deduplication via unique constraint
-- Add event_id column and unique constraint on (provider, event_id) to prevent replay of same webhook event

alter table crypto_webhook_events
add column if not exists event_id text;

alter table crypto_webhook_events
add constraint crypto_webhook_events_provider_event_id_key
unique (provider, event_id);

-- Index for efficient deduplication lookups
create index if not exists crypto_webhook_events_provider_event_id_idx
on crypto_webhook_events(provider, event_id);

comment on constraint crypto_webhook_events_provider_event_id_key on crypto_webhook_events
is 'Blocker 6: Prevents replay of same webhook event by provider. Duplicate events return early (idempotent).';
