-- Stays — hotelier KYB (Know Your Business) / go-live verification (Phase 2 extranet).
--
-- The hotelier extranet onboarding UI (frontend-admin/app/extranet/onboarding/{verification,
-- go-live}) has always expected a verification/business-KYC backend, but no such model
-- existed anywhere in the Stays schema — only stays_property (content) and
-- stays_hotelier_profile (property access grants). This adds the business-identity /
-- KYC record the go-live checklist reads and the admin approve/reject workflow writes.
-- Additive-only — no DROP / RENAME / type narrowing; existing properties with no KYB row
-- are unaffected (reads default to a 'pending' record).
--
-- Mirrors the restaurant module's restaurant_kyb precedent (20261018000000_restaurant_kyb.sql):
-- a per-object business-verification row + a status snapshot on the parent for fast
-- go-live gate reads. No third-party document store table is added here — document
-- upload is a separate, not-yet-built increment; business_doc_status exists as a status
-- field the future upload flow will drive.

-- Snapshot of the KYB verdict on the property row (fast reads / future go-live gating).
-- NULL for properties that predate KYB or have never had a KYB row created.
ALTER TABLE public.stays_property ADD COLUMN IF NOT EXISTS kyb_status TEXT
    CHECK (kyb_status IS NULL OR kyb_status IN
        ('pending','in_progress','submitted','approved','rejected','needs_changes'));

-- ─── stays_hotelier_kyb ────────────────────────────────────────────────────────
-- One row per property (1:1, like restaurant_kyb). Status vocabulary matches the
-- frontend's VerificationItemStatus contract (frontend-admin/src/types/staysExtranet.ts)
-- exactly, rather than the restaurant module's own draft/under_review/... vocabulary,
-- so the Go layer needs no translation mapping.
CREATE TABLE IF NOT EXISTS public.stays_hotelier_kyb (
    property_id             UUID PRIMARY KEY REFERENCES public.stays_property(id) ON DELETE CASCADE,
    legal_name               TEXT,
    business_type            TEXT CHECK (business_type IS NULL OR business_type IN
                                  ('sole_proprietor','limited_company','partnership','ngo')),
    rc_number                TEXT,   -- CAC RC/BN registration number
    tin                      TEXT,   -- tax identification number
    director_name             TEXT,
    director_bvn              TEXT CHECK (director_bvn IS NULL OR director_bvn ~ '^[0-9]{11}$'),
    contact_email             TEXT,
    contact_phone             TEXT,
    kyc_status                TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (kyc_status IN ('pending','in_progress','submitted','approved','rejected','needs_changes')),
    business_doc_status       TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (business_doc_status IN ('pending','in_progress','submitted','approved','rejected','needs_changes')),
    status                    TEXT NOT NULL DEFAULT 'pending'  -- overall verification verdict
                                  CHECK (status IN ('pending','in_progress','submitted','approved','rejected','needs_changes')),
    submitted_for_review_at   TIMESTAMPTZ,
    reviewed_at               TIMESTAMPTZ,
    reviewed_by               UUID,
    reviewer_note             TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stays_hotelier_kyb_status_idx ON public.stays_hotelier_kyb(status);

-- ─── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stays_hotelier_kyb ENABLE ROW LEVEL SECURITY;
-- Holds sensitive business/PII data (director BVN, TIN, CAC number): no client policy
-- is granted, same as restaurant_kyb. The Go service (object-scoped owner reads/writes
-- via stays_hotelier_profile; stays.admin.hotelier-gated reviewer decisions) is the
-- only path — both go through the service_role connection (pgx pool), never PostgREST.
