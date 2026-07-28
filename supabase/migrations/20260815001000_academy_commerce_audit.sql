-- Spotlight Academy commerce — audit trail + idempotency-result store.
-- Additive-only (golden rule: brownfield safety). Keyed on auth.users(id) like the
-- rest of the academy schema; the platform-wide public.audit_logs FK-references
-- platform_users(id), which is a DIFFERENT identity space, so commerce keeps its own
-- self-contained, append-only audit table here. No DROP / rename / narrowing.
BEGIN;

-- Immutable audit trail for every guarded commerce transition (purchase SM, refund,
-- access-card activation, subscription). Append-only: no UPDATE/DELETE in app code.
CREATE TABLE IF NOT EXISTS public.academy_commerce_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,                       -- auth.users(id); nullable for system actions
  action      text NOT NULL,              -- e.g. order.paid, order.refunded, access_card.activated
  entity_type text NOT NULL,              -- academy_order | academy_access_card | academy_subscription
  entity_id   uuid,
  from_state  text,
  to_state    text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at  timestamptz NOT NULL DEFAULT now()  -- immutable
);
CREATE INDEX IF NOT EXISTS idx_academy_commerce_audit_entity
  ON public.academy_commerce_audit(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_academy_commerce_audit_actor
  ON public.academy_commerce_audit(actor_id, created_at);

-- Idempotency-result store: persist (idempotency_key, scope) -> result_ref so a
-- replay of the SAME key returns the original effect with no new charge/grant.
-- (conventions.md §Idempotency). Scope namespaces keys per operation so a pay_now
-- key cannot collide with a refund key.
CREATE TABLE IF NOT EXISTS public.academy_idempotency_keys (
  idempotency_key text NOT NULL,
  scope           text NOT NULL,          -- order.pay_now | order.bnpl | order.refund | access_card.activate | subscription.subscribe | sync
  user_id         uuid,
  request_hash    text,                   -- guards against same-key/different-body reuse
  result_ref      text,                   -- order id / entitlement id / activation id
  result          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, scope)
);

-- Sync envelope dedupe: each client event carries a stable client_event_id; we record
-- the server reconciliation so a replayed sync batch is a no-op (deterministic).
CREATE TABLE IF NOT EXISTS public.academy_sync_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_event_id text NOT NULL,          -- client-generated, stable across retries
  kind            text NOT NULL,          -- progress | attempt_queued | reward_eligible
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_ts       timestamptz,            -- client clock (advisory; server is authoritative)
  resolution      text NOT NULL DEFAULT 'accepted', -- accepted | superseded | rejected
  server_ts       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_event_id)       -- idempotent upsert key (replay-safe)
);
CREATE INDEX IF NOT EXISTS idx_academy_sync_events_user
  ON public.academy_sync_events(user_id, server_ts);

-- RLS: owner reads own; service_role full. Audit is service-only (admin reads via API).
ALTER TABLE public.academy_sync_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS academy_sync_events_owner ON public.academy_sync_events;
CREATE POLICY academy_sync_events_owner ON public.academy_sync_events
  FOR SELECT USING (public.is_admin() OR user_id = auth.uid());
DROP POLICY IF EXISTS academy_sync_events_service ON public.academy_sync_events;
CREATE POLICY academy_sync_events_service ON public.academy_sync_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.academy_commerce_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS academy_commerce_audit_service ON public.academy_commerce_audit;
CREATE POLICY academy_commerce_audit_service ON public.academy_commerce_audit
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.academy_idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS academy_idempotency_keys_service ON public.academy_idempotency_keys;
CREATE POLICY academy_idempotency_keys_service ON public.academy_idempotency_keys
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMIT;
