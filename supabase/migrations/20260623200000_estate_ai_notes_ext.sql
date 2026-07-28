-- Block 33: AI note-taking.
--
-- Extends estate_ai_notes from a flat notes row into a processing session:
-- raw transcript, extracted decisions, processing status, optional audio
-- reference, and an approval workflow. Additive-only.

ALTER TABLE estate_ai_notes
    ADD COLUMN IF NOT EXISTS transcript   TEXT,
    ADD COLUMN IF NOT EXISTS decisions    JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'complete'
        CHECK (status IN ('processing','complete','failed')),
    ADD COLUMN IF NOT EXISTS model        TEXT,
    ADD COLUMN IF NOT EXISTS audio_url    TEXT,
    ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
