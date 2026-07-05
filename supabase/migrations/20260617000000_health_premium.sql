-- Health Premium Ecosystem: extended doctor profiles, SOAP notes, licence docs,
-- pharmacy products and cart. Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── Extend doctors table ────────────────────────────────────────────────────
-- Widen the specialty CHECK to include the new specialties.
ALTER TABLE doctors DROP CONSTRAINT IF EXISTS doctors_specialty_check;
ALTER TABLE doctors ADD CONSTRAINT doctors_specialty_check CHECK (
    specialty IN (
        'general','cardiology','dermatology','paediatrics','veterinary','pharmacy',
        'mental_health','womens_health','neurology','eye_care','nutrition',
        'dentistry','oncology','orthopedic','radiology','ent','urology','psychiatry'
    )
);

-- Add richer profile columns (nullable — legacy rows remain valid).
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS sub_specialty      TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS experience_years   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS rating             NUMERIC(3,2) NOT NULL DEFAULT 0.00;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS review_count       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS patients_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS success_rate       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_hmo_verified    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_online          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS mdcn_number        TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS phone              TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS about              TEXT;
-- Education stored as JSONB array of {institution, degree, year}.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS education          JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE INDEX IF NOT EXISTS doctors_rating_idx         ON doctors(rating DESC);
CREATE INDEX IF NOT EXISTS doctors_experience_idx     ON doctors(experience_years DESC);
CREATE INDEX IF NOT EXISTS doctors_online_idx         ON doctors(is_online);

-- ─── doctor_specialties ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_specialties (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    icon         TEXT NOT NULL DEFAULT 'medkit-outline',
    is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS doctor_specialties_featured_idx ON doctor_specialties(is_featured);

-- Seed default specialties.
INSERT INTO doctor_specialties (slug, name, description, icon, is_featured, sort_order) VALUES
    ('general',       'General Practice', 'Everyday health needs',         'person-outline',            TRUE,  1),
    ('paediatrics',   'Pediatrics',       'Expert child care',             'happy-outline',             TRUE,  2),
    ('mental_health', 'Mental Health',    'Counselling & support',         'heart-outline',             TRUE,  3),
    ('womens_health', 'Women''s Health',   'OBGYN & specialised care',      'female-outline',            TRUE,  4),
    ('cardiology',    'Cardiology',       'Heart & cardiovascular care',   'pulse-outline',             FALSE, 5),
    ('dermatology',   'Dermatology',      'Skin, hair & nails',            'color-palette-outline',     FALSE, 6),
    ('nutrition',     'Nutrition',        'Diet & wellness coaching',      'nutrition-outline',         FALSE, 7),
    ('eye_care',      'Eye Care',         'Vision & ophthalmology',        'eye-outline',               FALSE, 8),
    ('orthopedic',    'Orthopedic',       'Bones, joints & muscles',       'body-outline',              FALSE, 9),
    ('dentistry',     'Dentistry',        'Dental & oral health',          'medical-outline',           FALSE, 10),
    ('neurology',     'Neurology',        'Brain & nervous system',        'hardware-chip-outline',     FALSE, 11),
    ('oncology',      'Oncology',         'Cancer screening & care',       'shield-outline',            FALSE, 12)
ON CONFLICT (slug) DO NOTHING;

-- ─── appointments: add consultation_type column ──────────────────────────────
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultation_type TEXT NOT NULL DEFAULT 'video'
    CHECK (consultation_type IN ('video','in_person'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_name TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_specialty TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

-- ─── doctor_soap_notes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_soap_notes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES appointments(id),
    doctor_id      UUID NOT NULL REFERENCES doctors(id),
    patient_id     UUID NOT NULL REFERENCES auth.users(id),
    subjective     TEXT NOT NULL DEFAULT '',
    objective      TEXT NOT NULL DEFAULT '',
    assessment     TEXT NOT NULL DEFAULT '',
    plan           TEXT NOT NULL DEFAULT '',
    -- Prescriptions as JSONB array of {drug, dosage, duration}.
    prescriptions  JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS soap_notes_doctor_idx   ON doctor_soap_notes(doctor_id);
CREATE INDEX IF NOT EXISTS soap_notes_patient_idx  ON doctor_soap_notes(patient_id);

ALTER TABLE doctor_soap_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soap_notes_select" ON doctor_soap_notes FOR SELECT TO authenticated
    USING (
        patient_id = auth.uid()
        OR EXISTS (SELECT 1 FROM doctors d WHERE d.id = doctor_soap_notes.doctor_id AND d.user_id = auth.uid())
    );
CREATE POLICY "soap_notes_insert" ON doctor_soap_notes FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM doctors d WHERE d.id = doctor_soap_notes.doctor_id AND d.user_id = auth.uid())
    );
CREATE POLICY "soap_notes_service" ON doctor_soap_notes TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─── doctor_licence_docs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_licence_docs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_user_id  UUID NOT NULL REFERENCES auth.users(id),
    document_type   TEXT NOT NULL
                        CHECK (document_type IN ('mdcn','degree','specialisation','passport','final_submission')),
    filename        TEXT NOT NULL,
    storage_key     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','verified','rejected')),
    idempotency_key TEXT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (doctor_user_id, document_type)
);

CREATE INDEX IF NOT EXISTS licence_docs_user_idx   ON doctor_licence_docs(doctor_user_id);
CREATE INDEX IF NOT EXISTS licence_docs_status_idx ON doctor_licence_docs(status);

ALTER TABLE doctor_licence_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "licence_docs_select" ON doctor_licence_docs FOR SELECT TO authenticated
    USING (doctor_user_id = auth.uid());
CREATE POLICY "licence_docs_insert" ON doctor_licence_docs FOR INSERT TO authenticated
    WITH CHECK (doctor_user_id = auth.uid());
CREATE POLICY "licence_docs_service" ON doctor_licence_docs TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─── pharmacy_products ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_products (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT NOT NULL,
    category       TEXT NOT NULL
                       CHECK (category IN ('pain','vitamins','first_aid','baby','skincare','devices','prescription','otc')),
    price_kobo     BIGINT NOT NULL CHECK (price_kobo > 0),
    unit           TEXT NOT NULL DEFAULT '1 unit',
    is_bestseller  BOOLEAN NOT NULL DEFAULT FALSE,
    is_essential   BOOLEAN NOT NULL DEFAULT FALSE,
    in_stock       BOOLEAN NOT NULL DEFAULT TRUE,
    image_url      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_products_category_idx   ON pharmacy_products(category);
CREATE INDEX IF NOT EXISTS pharmacy_products_in_stock_idx   ON pharmacy_products(in_stock);

-- Seed sample products.
INSERT INTO pharmacy_products (name, category, price_kobo, unit, is_bestseller, is_essential) VALUES
    ('Paracetamol 500mg',   'pain',      125000,  '20 tabs',  TRUE,  FALSE),
    ('Multivitamin Complex','vitamins',  240000,  '30 caps',  FALSE, FALSE),
    ('Emergency Kit Pro',   'first_aid', 450000,  '1 kit',    FALSE, TRUE),
    ('Allergy Relief Spray','skincare',  187500,  '50ml',     FALSE, FALSE),
    ('Vitamin C 1000mg',    'vitamins',  180000,  '60 tabs',  FALSE, FALSE),
    ('Ibuprofen 400mg',     'pain',       95000,  '24 tabs',  FALSE, FALSE)
ON CONFLICT DO NOTHING;

ALTER TABLE pharmacy_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_products_select" ON pharmacy_products FOR SELECT TO authenticated USING (in_stock = TRUE);
CREATE POLICY "pharmacy_products_service" ON pharmacy_products TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─── pharmacy_cart_items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_cart_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES auth.users(id),
    product_id     UUID NOT NULL REFERENCES pharmacy_products(id),
    quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    idempotency_key TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS pharmacy_cart_user_idx ON pharmacy_cart_items(user_id);

ALTER TABLE pharmacy_cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cart_select" ON pharmacy_cart_items FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cart_insert" ON pharmacy_cart_items FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cart_update" ON pharmacy_cart_items FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cart_delete" ON pharmacy_cart_items FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cart_service" ON pharmacy_cart_items TO service_role USING (TRUE) WITH CHECK (TRUE);
