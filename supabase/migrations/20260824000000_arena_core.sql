-- Arena competition engine (ADR-014). ADDITIVE ONLY. Naija Driver is instance #1.
-- Reuses: user_profiles KYC, finance ledger (Support pot), placement (Sponsor),
-- connect/live (finale), RBAC. The MERIT ledger is a PHYSICALLY SEPARATE store
-- with NO write path from money/engagement rails (NDC-1), append-only + signed
-- (NDC-2), and hash-chained (NDC-6). No DROP / RENAME / type-narrowing.

-- ── Competition + immutable versioned config ─────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_competition (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','OPEN','SCREENING','RUNNING','FINALE','CLOSED')),
  timezone       TEXT NOT NULL DEFAULT 'Africa/Lagos',
  config_version INTEGER NOT NULL DEFAULT 0,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each publish writes a new immutable config version (rails, awards, schemas).
CREATE TABLE IF NOT EXISTS arena_competition_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id            UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  version                   INTEGER NOT NULL,
  rails                     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- typed rail params
  awards                    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- award→rail bindings
  eligibility_schema_version TEXT,
  screening_schema_version  TEXT,
  rubric_versions           JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_by              UUID,
  published_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, version)
);

-- ── Authorized scoring adapters (ONLY these may write signed merit) NDC-2 ────
CREATE TABLE IF NOT EXISTS arena_authorized_adapter (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  adapter_id     TEXT NOT NULL,   -- e.g. "theory-exam", "practical-judge", "first-aid"
  source_type    TEXT NOT NULL CHECK (source_type IN ('THEORY_EXAM','PRACTICAL','FIRST_AID','TELEMATICS')),
  public_key     TEXT NOT NULL,   -- base64 Ed25519 public key for verification
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, adapter_id)
);

-- ── Contestant + guarded lifecycle (NDC-3 one entry per human) ───────────────
CREATE TABLE IF NOT EXISTS arena_contestant (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  state          TEXT NOT NULL DEFAULT 'APPLIED'
                 CHECK (state IN ('APPLIED','SCREENED','TRAINED','THEORY_ASSIGNED','THEORY_TAKEN',
                                  'QUALIFIED','FINALIST','CROWNED','ELIMINATED','REJECTED','WITHDRAWN')),
  kyc_tier       SMALLINT,
  home_state     TEXT,            -- 36 states + FCT
  theory_batch   TEXT CHECK (theory_batch IN ('B1','B2','B3')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, user_id)     -- NDC-3: one human → one entry
);
CREATE INDEX IF NOT EXISTS arena_contestant_comp_state_idx ON arena_contestant (competition_id, state);
CREATE INDEX IF NOT EXISTS arena_contestant_user_idx ON arena_contestant (user_id);

CREATE TABLE IF NOT EXISTS arena_application (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id            UUID NOT NULL REFERENCES arena_contestant(id) ON DELETE CASCADE,
  review_state             TEXT NOT NULL DEFAULT 'SUBMITTED'
                           CHECK (review_state IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO','APPROVED','REJECTED')),
  submitted_schema_version TEXT,
  payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id              UUID,
  decided_at               TIMESTAMPTZ,
  decision_reason          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arena_application_review_idx ON arena_application (review_state);

-- ── MERIT LEDGER — append-only, signed, chained (NDC-1,2,6) ──────────────────
-- Physically separate store. No FK to any money/engagement table. Writes only
-- through the signed ScoringGateway path; UPDATE/DELETE blocked by trigger below.
CREATE TABLE IF NOT EXISTS arena_merit_entry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id    UUID NOT NULL,
  contestant_id     UUID NOT NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN ('THEORY_EXAM','PRACTICAL','FIRST_AID','TELEMATICS')),
  source_adapter_id TEXT NOT NULL,
  stage             TEXT NOT NULL CHECK (stage IN ('SCREENING','THEORY_B1','THEORY_B2','THEORY_B3','FINALE_PRACTICAL','FINALE_FIRSTAID')),
  rubric_version    TEXT NOT NULL,
  raw_score         NUMERIC NOT NULL,
  normalized_score  NUMERIC NOT NULL,
  reason            TEXT,                         -- set on compensating corrections
  canonical_payload TEXT NOT NULL,                -- exact bytes that were signed
  signature         TEXT NOT NULL,                -- base64 Ed25519 signature (NDC-2)
  prev_hash         TEXT NOT NULL DEFAULT '',     -- per-contestant chain link
  entry_hash        TEXT NOT NULL,                -- ChainHash(prev_hash, canonical) (NDC-6)
  signed_at         TIMESTAMPTZ NOT NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT arena_merit_no_replay UNIQUE (source_adapter_id, competition_id, contestant_id, stage, signed_at)
);
CREATE INDEX IF NOT EXISTS arena_merit_leaderboard_idx ON arena_merit_entry (competition_id, stage, normalized_score DESC, signed_at);
CREATE INDEX IF NOT EXISTS arena_merit_contestant_idx ON arena_merit_entry (contestant_id, recorded_at);

-- ── Engagement ledger (Play-Along / Predict) — NEVER merit ───────────────────
CREATE TABLE IF NOT EXISTS arena_engagement_event (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  spectator_id   UUID NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('QUIZ_PASS','QUIZ_ATTEMPT','PREDICTION','PREDICTION_HIT')),
  subject_id     UUID,            -- contestant/state predicted, when relevant
  points         INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS arena_engagement_comp_idx ON arena_engagement_event (competition_id, spectator_id);

-- ── Support tagging (projection over the wallet ledger; money, NEVER merit) ──
-- The actual money movement is a finance ledger entry; this row tags the gift to
-- a competition/contestant/rail for the pot + People's Champion (display-only).
CREATE TABLE IF NOT EXISTS arena_support_txn (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  contestant_id  UUID REFERENCES arena_contestant(id),
  home_state     TEXT,                       -- for State Pride aggregate
  backer_id      UUID NOT NULL,
  amount_kobo    BIGINT NOT NULL CHECK (amount_kobo > 0),
  rail           TEXT NOT NULL DEFAULT 'SUPPORT' CHECK (rail = 'SUPPORT'),
  ledger_ref     TEXT NOT NULL,              -- finance ledger reference (source of truth)
  idempotency_key TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS arena_support_comp_idx ON arena_support_txn (competition_id, contestant_id);
CREATE INDEX IF NOT EXISTS arena_support_state_idx ON arena_support_txn (competition_id, home_state);

-- ── Award results (finalized + signed) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_award_result (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  award_type      TEXT NOT NULL,             -- NAIJA_DRIVER_CROWN, PEOPLES_CHAMPION, STATE_PRIDE_WINNER, ...
  subject_id      UUID NOT NULL,             -- contestant | state proxy | spectator
  computed_from   TEXT[] NOT NULL,           -- rails this award read (crown = {MERIT} only)
  value           NUMERIC,
  signature       TEXT,                      -- signed finalization
  finalized_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, award_type, subject_id)
);

-- ── Credentials (verifiable, revocable) NDC-7 ────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_credential (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL,
  competition_id     UUID REFERENCES arena_competition(id),
  type               TEXT NOT NULL CHECK (type IN ('CERTIFIED_SAFE_DRIVER','NAIJA_DRIVER')),
  tier               TEXT,
  issued_from_merit_ref UUID,               -- merit entry / award reference
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  verifiable_hash    TEXT NOT NULL UNIQUE,   -- public verification handle
  revoke_reason      TEXT,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS arena_credential_user_idx ON arena_credential (user_id, status);

-- ── Immutable audit log (NDC-5,6) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID,
  actor_id    UUID,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  action      TEXT NOT NULL,
  reason      TEXT,
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arena_audit_entity_idx ON arena_audit_log (entity_type, entity_id);

-- ── Append-only enforcement: block UPDATE/DELETE on merit, award, audit ──────
CREATE OR REPLACE FUNCTION arena_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: UPDATE/DELETE forbidden (corrections are new signed entries)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='arena_merit_entry_immutable') THEN
    CREATE TRIGGER arena_merit_entry_immutable BEFORE UPDATE OR DELETE ON arena_merit_entry
      FOR EACH ROW EXECUTE FUNCTION arena_block_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='arena_audit_log_immutable') THEN
    CREATE TRIGGER arena_audit_log_immutable BEFORE UPDATE OR DELETE ON arena_audit_log
      FOR EACH ROW EXECUTE FUNCTION arena_block_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='arena_award_result_immutable') THEN
    CREATE TRIGGER arena_award_result_immutable BEFORE UPDATE OR DELETE ON arena_award_result
      FOR EACH ROW EXECUTE FUNCTION arena_block_mutation();
  END IF;
END $$;

-- ── Derived merit leaderboard (materialized) ─────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS arena_merit_leaderboard AS
  SELECT competition_id, contestant_id, stage,
         SUM(normalized_score) AS total_score,
         MIN(signed_at)        AS first_signed_at
  FROM arena_merit_entry
  GROUP BY competition_id, contestant_id, stage;
CREATE UNIQUE INDEX IF NOT EXISTS arena_merit_leaderboard_key
  ON arena_merit_leaderboard (competition_id, contestant_id, stage);

-- ── RLS: public reads on public data; all writes via service-role backend ────
ALTER TABLE arena_competition        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_contestant         ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_application         ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_merit_entry        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_engagement_event   ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_support_txn        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_award_result       ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_credential         ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_audit_log          ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_competition' AND policyname='comp_public_read') THEN
    CREATE POLICY comp_public_read ON arena_competition FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_merit_entry' AND policyname='merit_public_read') THEN
    CREATE POLICY merit_public_read ON arena_merit_entry FOR SELECT USING (true); -- publicly verifiable (NDC-6)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_award_result' AND policyname='award_public_read') THEN
    CREATE POLICY award_public_read ON arena_award_result FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_credential' AND policyname='cred_public_read') THEN
    CREATE POLICY cred_public_read ON arena_credential FOR SELECT USING (true); -- verify-by-hash is public (NDC-7)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_contestant' AND policyname='contestant_owner_read') THEN
    CREATE POLICY contestant_owner_read ON arena_contestant FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_application' AND policyname='application_owner_read') THEN
    CREATE POLICY application_owner_read ON arena_application FOR SELECT
      USING (EXISTS (SELECT 1 FROM arena_contestant c WHERE c.id = arena_application.contestant_id AND c.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arena_support_txn' AND policyname='support_backer_read') THEN
    CREATE POLICY support_backer_read ON arena_support_txn FOR SELECT USING (auth.uid() = backer_id);
  END IF;
  -- arena_engagement_event, arena_audit_log: no anon/authenticated policy → service-role only.
END $$;
