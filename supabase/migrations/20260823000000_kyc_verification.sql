-- Multi-provider KYC verification gateway (ADR-013). ADDITIVE ONLY.
-- Reuses: user_profiles.kyc_tier/kyc_status, kyc_events (audit), webhook_event
-- (provider,event_id dedupe). Adds the normalized verification entities, consent
-- records, admin-editable routing rules, and an encrypted PII blob store.
--
-- No DROP / RENAME / type-narrowing. Safe to run behind FEATURE_KYC_VERIFY_ENABLED.

-- ── Verification session: one per user tier-upgrade attempt ──────────────────
CREATE TABLE IF NOT EXISTS verification_session (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  target_tier  SMALLINT NOT NULL CHECK (target_tier BETWEEN 1 AND 3),
  status       TEXT NOT NULL DEFAULT 'UNVERIFIED'
               CHECK (status IN ('UNVERIFIED','TIER_PENDING','TIER_VERIFIED','TIER_FAILED','NEEDS_REVIEW','APPROVED','REJECTED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_session_user_idx   ON verification_session (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_session_status_idx ON verification_session (status, created_at DESC);

-- ── Verification check: normalized result of one provider check (§2) ─────────
CREATE TABLE IF NOT EXISTS verification_check (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES verification_session(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('ID_NUMBER','ID_FACIAL','LIVENESS','DOCUMENT','AML')),
  provider         TEXT,                                  -- provider that answered
  provider_ref     TEXT,                                  -- provider job/reference id
  client_ref       TEXT NOT NULL,                         -- idempotency key
  status           TEXT NOT NULL DEFAULT 'INITIATED'
                   CHECK (status IN ('INITIATED','PENDING','PASSED','FAILED','REVIEW')),
  match            BOOLEAN,
  confidence       NUMERIC(6,2),
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason           TEXT,
  raw_payload_ref  UUID,                                  -- FK to kyc_pii_blob
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotency: a retried call with the same client_ref never double-runs.
CREATE UNIQUE INDEX IF NOT EXISTS verification_check_client_ref_key ON verification_check (client_ref);
CREATE INDEX IF NOT EXISTS verification_check_session_idx ON verification_check (session_id);
CREATE INDEX IF NOT EXISTS verification_check_review_idx  ON verification_check (status) WHERE status = 'REVIEW';
CREATE INDEX IF NOT EXISTS verification_check_provref_idx ON verification_check (provider, provider_ref);

-- ── Consent records (NDPA / CBN) — captured before any check ─────────────────
CREATE TABLE IF NOT EXISTS kyc_consent (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  scope      TEXT NOT NULL,           -- e.g. 'kyc.identity','kyc.biometric','kyc.document'
  version    TEXT NOT NULL,           -- consent template version accepted
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS kyc_consent_user_idx ON kyc_consent (user_id, granted_at DESC);

-- ── Admin-editable capability routing (seeded from env; edit in admin) ───────
CREATE TABLE IF NOT EXISTS kyc_routing_rule (
  check_type        TEXT PRIMARY KEY CHECK (check_type IN ('ID_NUMBER','ID_FACIAL','LIVENESS','DOCUMENT','AML')),
  ordered_providers TEXT[] NOT NULL,          -- e.g. {'youverify','dojah'}
  threshold         INTEGER NOT NULL DEFAULT 70,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults (ADR-013 §1). ON CONFLICT keeps admin edits on re-run.
INSERT INTO kyc_routing_rule (check_type, ordered_providers, threshold) VALUES
  ('ID_NUMBER', ARRAY['dojah','youverify'], 70),
  ('ID_FACIAL', ARRAY['dojah','smileid'],   70),
  ('LIVENESS',  ARRAY['dojah','smileid'],   70),
  ('DOCUMENT',  ARRAY['dojah','smileid'],   70),
  ('AML',       ARRAY['dojah','youverify'], 70)
ON CONFLICT (check_type) DO NOTHING;

-- ── Encrypted PII blob store (AES-256-GCM ciphertext) ────────────────────────
-- Raw provider payloads (photos, full bio-data) are encrypted app-side and stored
-- here, referenced by verification_check.raw_payload_ref. Access is service-role
-- only; every read by a reviewer is logged in the app audit trail.
CREATE TABLE IF NOT EXISTS kyc_pii_blob (
  ref        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id   UUID,
  user_id    UUID,
  provider   TEXT,
  ciphertext TEXT NOT NULL,          -- base64(nonce ‖ ciphertext ‖ tag)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_pii_blob_check_idx ON kyc_pii_blob (check_id);

-- ── Row-level security ───────────────────────────────────────────────────────
ALTER TABLE verification_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_check   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_consent          ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_routing_rule     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_pii_blob         ENABLE ROW LEVEL SECURITY;

-- Users may read their own sessions/checks/consent; the backend uses the
-- service-role key for all writes and for privileged (admin) reads.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='verification_session' AND policyname='vs_owner_read') THEN
    CREATE POLICY vs_owner_read ON verification_session FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='verification_check' AND policyname='vc_owner_read') THEN
    CREATE POLICY vc_owner_read ON verification_check FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kyc_consent' AND policyname='kc_owner_read') THEN
    CREATE POLICY kc_owner_read ON kyc_consent FOR SELECT USING (auth.uid() = user_id);
  END IF;
  -- routing rules are readable by authenticated users (thresholds are not secret);
  -- writes are service-role only (no write policy → denied for anon/authenticated).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kyc_routing_rule' AND policyname='kr_read') THEN
    CREATE POLICY kr_read ON kyc_routing_rule FOR SELECT USING (true);
  END IF;
  -- kyc_pii_blob: NO policy for authenticated/anon → only the service-role key
  -- (which bypasses RLS) can read/write the encrypted PII store.
END $$;
