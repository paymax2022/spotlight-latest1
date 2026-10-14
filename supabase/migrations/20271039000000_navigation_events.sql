-- Navigation telemetry: privacy-preserving log of which screens/pages users visit.
-- Stores ONLY user_id / surface / route / occurred_at / created_at (no PII, no
-- query strings, no params). Additive-only: new table + indexes.
-- user_id is a plain uuid with no FK to auth.users/platform_users (project convention).
CREATE TABLE IF NOT EXISTS public.navigation_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL,
  surface     text        NOT NULL CHECK (surface IN ('mobile','web')),
  route       text        NOT NULL CHECK (char_length(route) <= 256),
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_navigation_events_user_occurred
  ON public.navigation_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_navigation_events_route_occurred
  ON public.navigation_events (route, occurred_at);
CREATE INDEX IF NOT EXISTS idx_navigation_events_occurred
  ON public.navigation_events (occurred_at);

-- Backend-only table: service_role (pgx) writes; no client policies.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.navigation_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS navigation_events_service ON public.navigation_events';
  EXECUTE 'CREATE POLICY navigation_events_service ON public.navigation_events FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;
