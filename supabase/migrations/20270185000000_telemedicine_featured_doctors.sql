-- Telemedicine: featured doctors.
--
-- The app's telemedicine landing screen shows a "Featured Doctors" section, and
-- that section must render ONLY when a doctor is actually featured — an empty
-- carousel with a heading above it reads as a broken screen, not an empty state.
-- So "featured" needs to be a fact the server can answer, not something the app
-- infers from rating or ordering: inferring it would mean the section can never
-- be empty and the heading would always show.
--
-- doctor_specialties already carries is_featured; doctors did not. Same column
-- name and shape, so the two read consistently.
--
-- Additive only: new nullable-by-default column with a DEFAULT, no backfill of
-- existing rows to TRUE. Every existing doctor stays unfeatured, so the section
-- stays hidden until someone deliberately features a doctor. Curation is an
-- editorial act — defaulting anyone in would put unvetted profiles on the
-- landing screen.
ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN doctors.is_featured IS
    'Editorially curated: surfaces the doctor in the app''s Featured Doctors section. '
    'Not derived from rating — the section hides entirely when no doctor is featured.';

-- Partial index: every read of this column filters `is_featured = TRUE`, and the
-- featured set is small by design, so indexing only the TRUE rows keeps the index
-- proportional to what is actually queried rather than to the doctors table.
CREATE INDEX IF NOT EXISTS idx_doctors_featured
    ON doctors (is_featured)
    WHERE is_featured = TRUE;
