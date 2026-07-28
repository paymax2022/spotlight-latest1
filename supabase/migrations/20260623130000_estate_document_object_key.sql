-- Block 39: estate document download presign.
--
-- Adds a server-controlled R2 object key to estate_documents so the API can mint
-- short-lived presigned GET URLs (60-min TTL) instead of exposing/storing raw
-- public URLs. Additive-only: a nullable column with no default, no drop, no
-- rename, no type change. Legacy rows (object_key IS NULL) keep working — the
-- download endpoint passes their stored file_url through unchanged.

ALTER TABLE estate_documents
    ADD COLUMN IF NOT EXISTS object_key TEXT;
