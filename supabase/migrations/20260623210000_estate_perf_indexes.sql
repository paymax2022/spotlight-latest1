-- Block 47: production hardening — hot-path performance indexes.
--
-- Covers the maintenance jobs and the high-traffic read paths added in blocks
-- 26/27/30/33/37/43. Additive-only (CREATE INDEX IF NOT EXISTS).

-- Maintenance jobs: overdue sweep + access-code expiry filter on status/time.
CREATE INDEX IF NOT EXISTS idx_dues_invoices_status_due ON estate_dues_invoices (status, due_date);
CREATE INDEX IF NOT EXISTS idx_access_codes_status_valid ON visitor_access_codes (status, valid_until);

-- Gate lookups by numeric code (guard scan path).
CREATE INDEX IF NOT EXISTS idx_access_codes_numeric ON visitor_access_codes (estate_id, numeric_code);

-- Resident dues lookups (dashboard pending-payment, payment-gated voting).
CREATE INDEX IF NOT EXISTS idx_dues_invoices_resident ON estate_dues_invoices (estate_id, resident_id, status);

-- In-app notification feed (per-user, newest first).
CREATE INDEX IF NOT EXISTS idx_estate_notifications_user ON estate_notifications (estate_id, user_id, created_at DESC);

-- AI-note sessions by meeting.
CREATE INDEX IF NOT EXISTS idx_ai_notes_meeting ON estate_ai_notes (estate_id, meeting_id);

-- Immutable audit log reads (admin audit-log view, newest first).
CREATE INDEX IF NOT EXISTS idx_estate_audit_log_estate ON estate_audit_log (estate_id, created_at DESC);
