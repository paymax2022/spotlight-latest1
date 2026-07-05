-- MapService v2 — Nigeria-tuned, cost-aware resolution layer (MAPSERVICE.md).
-- EXTENDS the existing maps schema (20260626000100_maps_core.sql); does NOT replace it.
-- Additive-only: new tables + additive columns. No DROP/rename/narrowing.
BEGIN;

-- PrivateGazetteer: verified internal points (§6/§9). PII-bearing → encrypted,
-- access-logged, NEVER uploaded to OSM (MS-4). H3-keyed for proximity (§8).
CREATE TABLE IF NOT EXISTS public.map_gazetteer (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  h3              text NOT NULL,
  geog            geography(Point, 4326) NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  normalized_addr text NOT NULL,
  components      jsonb NOT NULL DEFAULT '{}'::jsonb,
  plus_code       text,
  source          text NOT NULL,            -- courier_pin | user_saved | property | estate | agent
  verified_by     uuid REFERENCES auth.users(id),
  verified_at     timestamptz NOT NULL DEFAULT now(),
  encrypted_pii   bytea,                     -- encrypted PII payload (NDPA), never plaintext
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_map_gazetteer_h3   ON public.map_gazetteer(h3);
CREATE INDEX IF NOT EXISTS idx_map_gazetteer_norm ON public.map_gazetteer(normalized_addr);
CREATE INDEX IF NOT EXISTS idx_map_gazetteer_geog ON public.map_gazetteer USING GIST(geog);

-- Immutable access log for gazetteer reads (NDPA: every read logged, MS-4).
CREATE TABLE IF NOT EXISTS public.map_gazetteer_access_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid REFERENCES public.map_gazetteer(id) ON DELETE CASCADE,
  accessor_id uuid,
  basis       text NOT NULL,                 -- lookup | reverse | admin
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_map_gaz_access_entry ON public.map_gazetteer_access_log(entry_id, accessed_at);

-- CoverageCell: per-H3 tier driving provider order (§5). Self-improves over time.
CREATE TABLE IF NOT EXISTS public.map_coverage_cell (
  h3             text PRIMARY KEY,
  tier           text NOT NULL DEFAULT 'FAIR' CHECK (tier IN ('GOOD','FAIR','LOW')),
  osm_density    double precision NOT NULL DEFAULT 0,
  escalation_rate double precision NOT NULL DEFAULT 0,
  sample_count   bigint NOT NULL DEFAULT 0,
  pin_count      bigint NOT NULL DEFAULT 0,
  last_eval_at   timestamptz NOT NULL DEFAULT now()
);

-- ResolutionEvent: deterministic, auditable record of every resolution (§9, MS-7).
CREATE TABLE IF NOT EXISTS public.map_resolution_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type  text NOT NULL,
  surface       text,
  h3            text,
  tier          text,
  chosen_source text NOT NULL,               -- gazetteer | cache | prediction | osm | google | here | needs_pin
  provider      text,
  confidence    double precision NOT NULL DEFAULT 0,
  escalated     boolean NOT NULL DEFAULT false,
  cost_unit     integer NOT NULL DEFAULT 0,  -- paid provider calls (0 = deflected)
  outcome_pin   boolean NOT NULL DEFAULT false,
  user_id       uuid,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_map_resolution_ts     ON public.map_resolution_event(ts);
CREATE INDEX IF NOT EXISTS idx_map_resolution_source ON public.map_resolution_event(chosen_source, ts);
CREATE INDEX IF NOT EXISTS idx_map_resolution_h3     ON public.map_resolution_event(h3);

-- ContributionCandidate: non-PII improvements queued for the OSM public pipeline (§7).
CREATE TABLE IF NOT EXISTS public.map_contribution_candidate (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  h3           text NOT NULL,
  geometry     jsonb NOT NULL,               -- GeoJSON, non-PII only
  type         text NOT NULL,                -- road | bus_stop | landmark | poi | building | area_name
  pii_stripped boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','uploaded')),
  reviewer_id  uuid REFERENCES auth.users(id),
  changeset_id text,                          -- OSM changeset once uploaded
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_map_contrib_status ON public.map_contribution_candidate(status, created_at);

-- ProviderHealth: circuit-breaker + budget state per provider (§10, MS-6).
CREATE TABLE IF NOT EXISTS public.map_provider_health (
  name           text PRIMARY KEY,
  up             boolean NOT NULL DEFAULT true,
  p95_latency_ms integer NOT NULL DEFAULT 0,
  error_rate     double precision NOT NULL DEFAULT 0,
  budget_used    bigint NOT NULL DEFAULT 0,
  budget_day     text,                        -- YYYY-MM-DD bucket for daily caps
  circuit_state  text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  opened_at      timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Additive columns on existing cache/locations for the v2 spatial key + scoring.
ALTER TABLE public.geocode_cache
  ADD COLUMN IF NOT EXISTS h3         text,
  ADD COLUMN IF NOT EXISTS source     text,
  ADD COLUMN IF NOT EXISTS confidence double precision NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_geocode_cache_h3 ON public.geocode_cache(h3);

ALTER TABLE public.merchant_locations
  ADD COLUMN IF NOT EXISTS h3 text;
CREATE INDEX IF NOT EXISTS idx_merchant_locations_h3 ON public.merchant_locations(h3);

-- RLS: gazetteer + events are server-side (service_role); admins read for the dashboard.
ALTER TABLE public.map_gazetteer              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_gazetteer_access_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_resolution_event       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_contribution_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_provider_health        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_coverage_cell          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['map_gazetteer','map_gazetteer_access_log','map_resolution_event','map_contribution_candidate','map_provider_health','map_coverage_cell'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_admin_read ON public.%I FOR SELECT USING (public.is_admin())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- RBAC: the maps ops/dashboard + contribution review permission.
INSERT INTO public.permissions (slug, description)
VALUES ('map.admin.review', 'View MapService cost/coverage dashboards and review OSM contribution candidates')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.slug = 'map.admin.review'
  AND r.slug IN ('super-admin', 'system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
